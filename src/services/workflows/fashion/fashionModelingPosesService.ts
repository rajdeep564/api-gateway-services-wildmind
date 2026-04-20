import Replicate from "replicate";
import { env } from "../../../config/env";
import { ApiError } from "../../../utils/errorHandler";
import { authRepository } from "../../../repository/auth/authRepository";
import { generationHistoryRepository } from "../../../repository/generationHistoryRepository";
import { replicateRepository } from "../../../repository/replicateRepository";
import {
  uploadDataUriToZata,
  uploadFromUrlToZata,
} from "../../../utils/storage/zataUpload";
import { aestheticScoreService } from "../../aestheticScoreService";
import { syncToMirror } from "../../../utils/mirrorHelper";

// Replicate helper for output resolution
const resolveOutputUrls = async (output: any) => {
  if (!output) return [];
  if (Array.isArray(output)) return output.map(String);
  if (typeof output === "object" && output.url) return [String(output.url())];
  return [String(output)];
};

export interface FashionModelingPosesRequest {
  image: string;
  poseDescription: string;
  isPublic?: boolean;
  output_format?: string;
  size?: string;
  model?: string;
}

const normalizeSeedreamOutputFormat = (format?: string) => {
  const value = (format || "jpeg").toLowerCase();
  if (value === "jpg") return "jpeg";
  if (value === "png" || value === "jpeg") return value;
  return "jpeg";
};

/**
 * Builds a focused fashion modeling pose prompt that strictly preserves facial features,
 * and only changes the pose (and costume if mentioned).
 */
const buildFashionPosePrompt = (req: FashionModelingPosesRequest): string => {
  const { poseDescription } = req;

  return `You are a professional fashion photography AI. Your task is to change the modeling pose of the person in the photo based on the description provided.

### STRICT RULES:
1. **Preserve Facial Features**: The face must remain EXACTLY the same as in the original photo (facial features, skin tone, eye color, makeup). Do NOT change the person's identity.
2. **Pose Transformation**: Change the person's pose to match this description: "${poseDescription}".
3. **Costume Preservation**: 
    - If the pose description specifically mentions changing the clothing, costume, or outfit, then do so accordingly.
    - If NOT mentioned, you MUST preserve the original clothing/costume as accurately as possible.
4. **Environment**: Maintain the background and lighting style of the original image unless the pose requires a perspective shift.
5. **Realism**: Ensure the body proportions are natural and the new pose looks photorealistic. Avoid any distortion or "AI artifacts".

### TARGET POSE & STYLE: 
"${poseDescription}"

The final result should look like a high-end fashion magazine shot with professional lighting and composition.`;
};

export const fashionModelingPoses = async (
  uid: string,
  req: FashionModelingPosesRequest,
) => {
  const key = env.replicateApiKey as string;
  if (!key) throw new ApiError("Replicate API key not configured", 500);

  const replicate = new Replicate({ auth: key });
  const modelBase = req.model || "bytedance/seedream-5-lite";

  const creator = await authRepository.getUserById(uid);
  const prompt = buildFashionPosePrompt(req);

  // 1. Create History Record
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: prompt,
    model: modelBase,
    generationType: "text-to-image",
    visibility: req.isPublic ? "public" : "private",
    isPublic: req.isPublic ?? true,
    createdBy: creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid },
  } as any);

  // 2. Create Legacy Record
  const legacyId = await replicateRepository.createGenerationRecord(
    {
      prompt: prompt,
      model: modelBase,
      isPublic: req.isPublic ?? true,
    },
    creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid },
  );

  // 3. Handle Input Image
  let inputImageUrl = req.image;
  let inputImageStoragePath: string | undefined;
  const username = creator?.username || uid;

  if (inputImageUrl.startsWith("data:")) {
    const stored = await uploadDataUriToZata({
      dataUri: inputImageUrl,
      keyPrefix: `users/${username}/workflows/fashion/fashion-modeling-poses/input/${historyId}`,
      fileName: "source",
    });
    inputImageUrl = stored.publicUrl;
    inputImageStoragePath = (stored as any).key;
  } else if (inputImageUrl.includes("/api/proxy/resource/")) {
    const parts = inputImageUrl.split("/api/proxy/resource/");
    if (parts.length > 1) {
      const k = decodeURIComponent(parts[1]);
      const prefix = env.zataPrefix || "https://idr01.zata.ai/devstoragev1/";
      inputImageUrl = `${prefix}${k}`;
      inputImageStoragePath = k;
    }
  }

  if (inputImageUrl && inputImageStoragePath) {
    await generationHistoryRepository.update(uid, historyId, {
      inputImages: [
        { id: "in-1", url: inputImageUrl, storagePath: inputImageStoragePath },
      ],
    } as any);
  }

  // 4. Call Replicate (Seedream 5 Lite)
  const inputPayload = {
    image_input: [inputImageUrl],
    prompt: prompt,
    size: req.size || "2K", // Seedream 5 Lite accepts 2K/3K
    aspect_ratio: "match_input_image",
    output_format: normalizeSeedreamOutputFormat(req.output_format),
  };

  try {
    const output: any = await replicate.run(modelBase as any, {
      input: inputPayload,
    });

    // 5. Process Output
    const urls = await resolveOutputUrls(output);
    const outputUrl = urls[0];
    if (!outputUrl) throw new Error("No output URL from Replicate");

    let storedUrl = outputUrl;
    let storagePath = "";
    try {
      const uploaded = await uploadFromUrlToZata({
        sourceUrl: outputUrl,
        keyPrefix: `users/${username}/workflows/fashion/fashion-modeling-poses/image/${historyId}`,
        fileName: "pose-result",
      });
      storedUrl = uploaded.publicUrl;
      storagePath = uploaded.key;
    } catch (e) {
      console.warn("[fashionModelingPoses] Failed to upload output to Zata", e);
    }

    const images = [
      {
        id: `replicate-${Date.now()}`,
        url: storedUrl,
        storagePath,
        originalUrl: outputUrl,
      },
    ];

    const scoredImages = await aestheticScoreService.scoreImages(images);
    const highestScore = aestheticScoreService.getHighestScore(scoredImages);

    // 6. Update History
    await generationHistoryRepository.update(uid, historyId, {
      status: "completed",
      images: scoredImages,
      aestheticScore: highestScore,
      updatedAt: new Date().toISOString(),
    } as any);

    await replicateRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      images: scoredImages as any,
    });

    await syncToMirror(uid, historyId);

    return {
      images: scoredImages,
      historyId,
      model: modelBase,
      status: "completed",
    };
  } catch (e: any) {
    console.error("[fashionModelingPoses] Error", e);
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate failed",
    } as any);
    await replicateRepository.updateGenerationRecord(legacyId, {
      status: "failed",
      error: e?.message,
    });
    throw new ApiError(e?.message || "Generation failed", 502, e);
  }
};
