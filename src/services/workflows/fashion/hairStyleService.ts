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

export interface HairStyleRequest {
  image: string;
  hairStyle: string;
  hairColor?: string;
  customPrompt?: string;
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
 * Builds a focused hairstyle prompt that strictly preserves facial features,
 * expression and all other aspects of the photo — only the hair changes.
 * If no style or custom prompt is provided, a hardcoded beautiful default is used.
 */
const buildHairStylePrompt = (req: HairStyleRequest): string => {
  const {
    hairStyle,
    hairColor = "red blonde",
    customPrompt,
  } = req;

  // If user provided a custom prompt, use it directly (no hard-coding)
  if (customPrompt && customPrompt.trim().length > 0) {
    return customPrompt.trim();
  }

  const colorPart = hairColor && hairColor.trim() ? hairColor.trim() : "red blonde";

  // Default hardcoded style when user leaves the prompt empty
  const stylePart =
    hairStyle && hairStyle.trim().length > 0
      ? hairStyle.trim()
      : "natural, elegant and beautiful — keep the same length but make it look more polished, voluminous and professionally styled";

  return `You are a hyper-precise hair restyling AI. Your only task is to change the hairstyle of the person in the photo.

STRICT RULES — YOU MUST FOLLOW ALL OF THESE:
1. Change ONLY the hairstyle and hair color. Nothing else.
2. Preserve EXACTLY: facial features, skin tone, facial expression, eye color, makeup, body, clothing, background, lighting, shadows, and overall photo composition.
3. Do NOT alter facial structure, pose, or any part of the image outside the hair region.
4. Do NOT change the person's age, gender presentation, or any physical attribute other than hair.
5. Maintain natural hair-to-scalp integration — the new hairstyle must look like it genuinely belongs to the person.
6. Do NOT add artifacts, halos, or blending errors around the hairline.

TARGET HAIRSTYLE: ${stylePart}
TARGET HAIR COLOR: ${colorPart}

Apply the new hairstyle seamlessly, maintaining photorealistic quality, proper hair texture, shine, and volume consistent with the stated style. The output must look like a professional beauty/fashion photograph with only the hair changed.`;
};

export const hairStyle = async (
  uid: string,
  req: HairStyleRequest,
) => {
  const key = env.replicateApiKey as string;
  if (!key) throw new ApiError("Replicate API key not configured", 500);

  const replicate = new Replicate({ auth: key });

  const modelBase = req.model || "bytedance/seedream-5-lite";

  const creator = await authRepository.getUserById(uid);
  const prompt = buildHairStylePrompt(req);

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
      keyPrefix: `users/${username}/workflows/fashion/hairstyle/input/${historyId}`,
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

  // 4. Call Replicate (Seedream 5 Lite — image-guided generation)
  const inputPayload = {
    image_input: [inputImageUrl],
    prompt: prompt,
    size: req.size || "2K",
    aspect_ratio: "match_input_image",
    output_format: normalizeSeedreamOutputFormat(req.output_format),
  };

  try {
    console.log("[hairStyle] Running model", {
      model: modelBase,
      input: inputPayload,
    });
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
        keyPrefix: `users/${username}/workflows/fashion/hairstyle/image/${historyId}`,
        fileName: "result-1",
      });
      storedUrl = uploaded.publicUrl;
      storagePath = uploaded.key;
    } catch (e) {
      console.warn("[hairStyle] Failed to upload output to Zata", e);
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
    console.error("[hairStyle] Error", e);
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
