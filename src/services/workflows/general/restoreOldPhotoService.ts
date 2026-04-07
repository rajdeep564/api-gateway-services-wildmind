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

// Basic version resolver if needed, or assume model name is sufficient
const composeModelSpec = (model: string) => model;
// Replicate helper for output resolution
const resolveOutputUrls = async (output: any) => {
  if (!output) return [];
  if (Array.isArray(output)) return output.map(String);
  if (typeof output === "object" && output.url) return [String(output.url())];
  return [String(output)];
};

const normalizeSeedreamOutputFormat = (format?: string) => {
  const value = (format || "jpeg").toLowerCase();
  if (value === "jpg") return "jpeg";
  if (value === "png" || value === "jpeg") return value;
  return "jpeg";
};

export interface RestoreOldPhotoRequest {
  imageUrl: string;
  image_input?: string[];
  uploadedImages?: string[];
  prompt?: string;
  frameSize?: string;
  aspect_ratio?: string;
  size?: string;
  model?: string;
  output_format?: string;
  isPublic?: boolean;
  style?: string;
}

const normalizeSeedreamModel = (model?: string) => {
  const m = String(model || "").toLowerCase();
  if (m.includes("seedream-5-lite")) return "bytedance/seedream-5-lite";
  return "bytedance/seedream-5-lite";
};

export const restoreOldPhoto = async (
  uid: string,
  req: RestoreOldPhotoRequest,
) => {
  const key = env.replicateApiKey as string;
  if (!key) throw new ApiError("Replicate API key not configured", 500);

  const replicate = new Replicate({ auth: key });

  // Resolve model from request, keeping Seedream 5 Lite as canonical backend model id.
  const modelBase = normalizeSeedreamModel(req.model);

  const creator = await authRepository.getUserById(uid);

  // 1. Create History Record
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt:
      req.prompt ||
      "Restore and colorize this image, remove any scratches or imperfections. [Style: none]",
    model: modelBase,
    generationType: "text-to-image",
    visibility: req.isPublic ? "public" : "private",
    isPublic: req.isPublic ?? true,
    createdBy: creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid },
  } as any);

  // 2. Create Legacy Record (if referenced elsewhere, keep consistent)
  const legacyId = await replicateRepository.createGenerationRecord(
    {
      prompt: req.prompt || "Restore and colorize...",
      model: modelBase,
      isPublic: req.isPublic ?? true,
    },
    creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid },
  );

  // 3. Handle Input Image (Upload to Zata if needed)
  const sourceImages =
    Array.isArray(req.image_input) && req.image_input.length > 0
      ? req.image_input
      : Array.isArray(req.uploadedImages) && req.uploadedImages.length > 0
        ? req.uploadedImages
        : [req.imageUrl];

  let inputImageUrl = sourceImages[0];
  let inputImageStoragePath: string | undefined;

  if (inputImageUrl.startsWith("data:")) {
    const username = creator?.username || uid;
    const stored = await uploadDataUriToZata({
      dataUri: inputImageUrl,
      keyPrefix: `users/${username}/input/${historyId}`,
      fileName: "source",
    });
    inputImageUrl = stored.publicUrl;
    inputImageStoragePath = (stored as any).key;
  } else if (inputImageUrl.includes("/api/proxy/resource/")) {
    // Handle proxy URL: /api/proxy/resource/users%2F...
    // Extract the part after /resource/ and decode it
    const parts = inputImageUrl.split("/api/proxy/resource/");
    if (parts.length > 1) {
      const key = decodeURIComponent(parts[1]);
      // env.zataPrefix usually ends with / e.g. https://idr01.zata.ai/devstoragev1/
      // The key usually starts with users/...
      // So full URL = zataPrefix + key
      const prefix = env.zataPrefix || "https://idr01.zata.ai/devstoragev1/";
      inputImageUrl = `${prefix}${key}`;
      inputImageStoragePath = key;
    }
  } else {
    // Optional: Upload external URLs to Zata for persistence
    // For now, use as is or implement if critical
  }

  if (inputImageUrl && inputImageStoragePath) {
    await generationHistoryRepository.update(uid, historyId, {
      inputImages: [
        { id: "in-1", url: inputImageUrl, storagePath: inputImageStoragePath },
      ],
    } as any);
  }

  const aspectRatio = "match_input_image";

  // 4. Call Replicate (match Seedream image generation payload schema)
  const inputPayload = {
    image_input: [inputImageUrl],
    prompt:
      req.prompt ||
      "Restore and colorize the image with accurate, natural-looking colors based on realistic lighting and materials. Carefully remove scratches, dust, noise, compression artifacts, and surface imperfections without losing original details. Improve sharpness, texture, and edge clarity while maintaining a natural appearance. Enhance lighting, contrast, and tonal balance to create depth and realism. Preserve the original composition, identity, and proportions, delivering a clean, high-resolution, photorealistic final image.[Style: none]",
    size: req.size || "2K",
    aspect_ratio: aspectRatio,
    style: req.style || "none",
    output_format: normalizeSeedreamOutputFormat(req.output_format),
  };

  try {
    console.log("[restoreOldPhoto] Running model", {
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

    // Upload output to Zata
    let storedUrl = outputUrl;
    let storagePath = "";
    try {
      const username = creator?.username || uid;
      const uploaded = await uploadFromUrlToZata({
        sourceUrl: outputUrl,
        keyPrefix: `users/${username}/image/${historyId}`,
        fileName: "restored-1",
      });
      storedUrl = uploaded.publicUrl;
      storagePath = uploaded.key;
    } catch (e) {
      console.warn("Failed to upload output to Zata", e);
    }

    const images = [
      {
        id: `replicate-${Date.now()}`,
        url: storedUrl,
        storagePath,
        originalUrl: outputUrl,
      },
    ];

    // Score (Optional but good for consistency)
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

    // 7. Sync Mirror
    await syncToMirror(uid, historyId);

    return {
      images: scoredImages,
      historyId,
      model: modelBase,
      status: "completed",
    };
  } catch (e: any) {
    console.error("[restoreOldPhoto] Error", e);
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
