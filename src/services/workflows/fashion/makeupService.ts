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

export interface MakeupRequest {
  image: string;
  focusArea: string;
  style?: string;
  finish?: string;
  intensity?: number;
  additionalPrompt?: string;
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
 * Builds a professional makeup prompt that preserves facial identity
 * while applying specified makeup styles and finishes.
 */
const buildMakeupPrompt = (req: MakeupRequest): string => {
  const { focusArea, style, finish, intensity, additionalPrompt } = req;

  // Use additionalPrompt as override if long/detailed enough, or append to structured prompt
  const hasDetailedPrompt = additionalPrompt && additionalPrompt.trim().length > 20;

  const intensityLabel = intensity !== undefined
    ? (intensity < 33 ? "light/soft" : intensity < 66 ? "moderate/balanced" : "bold/intense")
    : "balanced";

  const styleContext = style ? `Style: ${style}.` : "";
  const finishContext = finish ? `Finish: ${finish}.` : "";
  const focusContext = `Focus Area: ${focusArea}.`;

  const baseInstructions = `You are a professional celebrity makeup artist AI. Your task is to apply a high-end makeup look to the person in the photo.

### STRICT RULES:
1. **Preserve Facial Identity**: The person's face, features, skin tone, and bone structure must remain EXACTLY the same. Do NOT change their identity.
2. **Makeup Application**: Apply professional makeup according to the specifications provided.
3. **Natural Integration**: Ensure the makeup looks like it was actually applied to the skin, with realistic textures, blending, and light interaction.
4. **Consistency**: Maintain the background, lighting, and clothing of the original image.

### MAKEUP SPECIFICATIONS:
- **Focus**: ${focusArea}
- **Style**: ${style || "Professional/Harmonious"}
- **Finish**: ${finish || "Natural"}
- **Intensity**: ${intensityLabel}
${additionalPrompt ? `- **User Special Instructions**: ${additionalPrompt}` : ""}

Apply the makeup seamlessly with photorealistic quality. The result should look like a professional beauty editorial photograph.`;

  return baseInstructions;
};

export const applyMakeup = async (
  uid: string,
  req: MakeupRequest,
) => {
  const key = env.replicateApiKey as string;
  if (!key) throw new ApiError("Replicate API key not configured", 500);

  const replicate = new Replicate({ auth: key });
  const modelBase = req.model || "bytedance/seedream-5-lite";

  const creator = await authRepository.getUserById(uid);
  const prompt = buildMakeupPrompt(req);

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
      keyPrefix: `users/${username}/workflows/fashion/makeup/input/${historyId}`,
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
    size: req.size || "2K",
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
        keyPrefix: `users/${username}/workflows/fashion/makeup/image/${historyId}`,
        fileName: "makeup-result",
      });
      storedUrl = uploaded.publicUrl;
      storagePath = uploaded.key;
    } catch (e) {
      console.warn("[applyMakeup] Failed to upload output to Zata", e);
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
    console.error("[applyMakeup] Error", e);
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
