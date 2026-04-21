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

export interface FashionStylistRequest {
  outfitImage: string;
  userImage: string;
  backgroundDetails: string;
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
 * Builds a professional virtual try-on / fashion styling prompt.
 * Uses two input images: 1. Person/Model, 2. Outfit.
 */
const buildFashionStylingPrompt = (req: FashionStylistRequest): string => {
  const { backgroundDetails } = req;

  return `You are a high-end fashion stylist and virtual try-on AI. Your task is to take the outfit shown in the OUTFIT image and perfectly "dress" the person shown in the PERSON image with it.

### INSTRUCTIONS:
1. **Virtual Try-On**: Transfer the clothing items (outfit) from the outfit image onto the person in the person image.
2. **Perfect Fit**: Ensure the outfit fits the person's body type and pose naturally, with realistic draping, shadows, and folds.
3. **Preserve Identity**: Keep the person's face, facial features, skin tone, hair, and overall identity EXACTLY the same.
4. **Background & Context**: Place the final styled person in this setting: "${backgroundDetails}".
5. **Quality**: The output must be a photorealistic, professional fashion editorial shot.

### CONTENT DETAILS:
- **Outfit**: As shown in the outfit-source image.
- **Model**: As shown in the person-source image.
- **Setting**: ${backgroundDetails}

Ensure the final result looks like a real photograph with seamless integration of the person and the clothing. Avoid any "floating" clothes or unrealistic textures.`;
};

export const fashionStyling = async (
  uid: string,
  req: FashionStylistRequest,
) => {
  const key = env.replicateApiKey as string;
  if (!key) throw new ApiError("Replicate API key not configured", 500);

  const replicate = new Replicate({ auth: key });
  const modelBase = req.model || "bytedance/seedream-5-lite";

  const creator = await authRepository.getUserById(uid);
  const prompt = buildFashionStylingPrompt(req);

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

  // 3. Handle Input Images
  const username = creator?.username || uid;
  
  // We need to store both images. We'll store them in an inputs subfolder.
  const storedOutfit = await processWorkflowsImage(uid, username, req.outfitImage, historyId, "outfit");
  const storedPerson = await processWorkflowsImage(uid, username, req.userImage, historyId, "person");

  const inputImages = [];
  if (storedOutfit.path) inputImages.push({ id: "outfit", url: storedOutfit.url, storagePath: storedOutfit.path });
  if (storedPerson.path) inputImages.push({ id: "person", url: storedPerson.url, storagePath: storedPerson.path });

  if (inputImages.length > 0) {
    await generationHistoryRepository.update(uid, historyId, {
      inputImages: inputImages,
    } as any);
  }

  // 4. Call Replicate (Seedream 5 Lite — multiple images)
  const inputPayload = {
    image_input: [storedPerson.url, storedOutfit.url], // Person first, then Outfit
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
        keyPrefix: `users/${username}/workflows/fashion/fashion-styling/image/${historyId}`,
        fileName: "styled-result",
      });
      storedUrl = uploaded.publicUrl;
      storagePath = uploaded.key;
    } catch (e) {
      console.warn("[fashionStyling] Failed to upload output to Zata", e);
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
    console.error("[fashionStyling] Error", e);
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

/**
 * Utility to process image storage for workflows.
 */
async function processWorkflowsImage(uid: string, username: string, url: string, historyId: string, name: string) {
  let finalUrl = url;
  let finalPath = "";

  if (url.startsWith("data:")) {
    const stored = await uploadDataUriToZata({
      dataUri: url,
      keyPrefix: `users/${username}/workflows/fashion/fashion-styling/input/${historyId}`,
      fileName: name,
    });
    finalUrl = stored.publicUrl;
    finalPath = (stored as any).key;
  } else if (url.includes("/api/proxy/resource/")) {
    const parts = url.split("/api/proxy/resource/");
    if (parts.length > 1) {
      const k = decodeURIComponent(parts[1]);
      const prefix = env.zataPrefix || "https://idr01.zata.ai/devstoragev1/";
      finalUrl = `${prefix}${k}`;
      finalPath = k;
    }
  }

  return { url: finalUrl, path: finalPath };
}
