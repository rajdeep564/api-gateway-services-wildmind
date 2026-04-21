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

export interface DeconstructOutfitRequest {
  image: string;
  additionalNotes?: string;
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
 * Builds a prompt to deconstruct an outfit into individual items (knolling style).
 */
const buildDeconstructPrompt = (req: DeconstructOutfitRequest): string => {
  const { additionalNotes } = req;

  const baseInstructions = `You are a fashion product photographer and stylist. Your task is to "deconstruct" the outfit shown in the photo.

### TASK:
Take all the clothing items, accessories, and footwear worn by the person in the original photo and display them as individual, neatly arranged product shots on a clean, neutral background.

### STYLE:
- **Knolling style**: Arrange items in a clean, professional grid or layout.
- **Background**: Neutral, minimalist studio background (e.g., light grey or beige) that complements the clothing.
- **Quality**: High-end fashion catalog quality with professional lighting and sharp textures.
- **Items to include**: All visible articles of clothing, shoes, bags, and significant accessories (glasses, scarves, etc.) from the original image.

### RULES:
1. **Consistency**: The individual items displayed must look EXACTLY like the ones in the original photo (color, texture, material, details).
2. **No Human**: The deconstructed view should NOT show a person; only the items themselves.
${additionalPromptLogic(additionalNotes)}

The final result should be a single image showcasing the deconstructed outfit components arranged professionally.`;

  return baseInstructions;
};

const additionalPromptLogic = (notes?: string) => {
  if (!notes || notes.trim().length === 0) return "";
  return `3. **User Special Instructions**: ${notes.trim()}. Please prioritize these details when deconstructing.`;
};

export const deconstructOutfit = async (
  uid: string,
  req: DeconstructOutfitRequest,
) => {
  const key = env.replicateApiKey as string;
  if (!key) throw new ApiError("Replicate API key not configured", 500);

  const replicate = new Replicate({ auth: key });
  const modelBase = req.model || "bytedance/seedream-5-lite";

  const creator = await authRepository.getUserById(uid);
  const prompt = buildDeconstructPrompt(req);

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
      keyPrefix: `users/${username}/workflows/fashion/deconstruct-outfit/input/${historyId}`,
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
        keyPrefix: `users/${username}/workflows/fashion/deconstruct-outfit/image/${historyId}`,
        fileName: "deconstruct-result",
      });
      storedUrl = uploaded.publicUrl;
      storagePath = uploaded.key;
    } catch (e) {
      console.warn("[deconstructOutfit] Failed to upload output to Zata", e);
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
    console.error("[deconstructOutfit] Error", e);
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
