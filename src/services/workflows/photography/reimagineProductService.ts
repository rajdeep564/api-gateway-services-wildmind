import Replicate from "replicate";
import { env } from '../../../config/env';
import { ApiError } from '../../../utils/errorHandler';
import { authRepository } from '../../../repository/auth/authRepository';
import { generationHistoryRepository } from '../../../repository/generationHistoryRepository';
import { replicateRepository } from '../../../repository/replicateRepository';
import { uploadDataUriToZata, uploadFromUrlToZata } from '../../../utils/storage/zataUpload';
import { aestheticScoreService } from '../../aestheticScoreService';
import { syncToMirror } from '../../../utils/mirrorHelper';

// Replicate helper for output resolution
const resolveOutputUrls = async (output: any) => {
  if (!output) return [];
  if (Array.isArray(output)) return output.map(String);
  if (typeof output === 'object' && output.url) return [String(output.url())];
  return [String(output)];
};

export interface ReimagineProductRequest {
  imageUrl: string;
  angle: string;
  additionalDetails?: string;
  isPublic?: boolean;
}

export const reimagineProduct = async (uid: string, req: ReimagineProductRequest) => {
  const key = env.replicateApiKey as string;
  if (!key) throw new ApiError("Replicate API key not configured", 500);

  const replicate = new Replicate({ auth: key });
  const modelBase = 'qwen/qwen-image-edit-2511';

  const creator = await authRepository.getUserById(uid);

  // 1. Construct Prompt
  const anglePromptSnippet = req.angle ? `from a ${req.angle.toLowerCase()} perspective` : "";
  const detailsSnippet = req.additionalDetails ? `with these additional details: ${req.additionalDetails}` : "";
  const finalPrompt = `reimagine this product ${anglePromptSnippet} ${detailsSnippet}, high-end product photography, professional lighting, photorealistic, cinematic atmosphere`;

  // 2. Create History Record
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: finalPrompt,
    model: modelBase,
    generationType: "text-to-image",
    visibility: req.isPublic ? "public" : "private",
    isPublic: req.isPublic ?? true,
    createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
  } as any);

  // 3. Create Legacy Record
  const legacyId = await replicateRepository.createGenerationRecord(
    {
      prompt: finalPrompt,
      model: modelBase,
      isPublic: req.isPublic ?? true
    },
    creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid }
  );

  // 4. Handle Input Image
  let inputImageUrl = req.imageUrl;
  let inputImageStoragePath: string | undefined;

  if (inputImageUrl.startsWith('data:')) {
    const username = creator?.username || uid;
    const stored = await uploadDataUriToZata({
      dataUri: inputImageUrl,
      keyPrefix: `users/${username}/input/${historyId}`,
      fileName: "source",
    });
    inputImageUrl = stored.publicUrl;
    inputImageStoragePath = (stored as any).key;
  } else if (inputImageUrl.includes('/api/proxy/resource/')) {
    const parts = inputImageUrl.split('/api/proxy/resource/');
    if (parts.length > 1) {
      const key = decodeURIComponent(parts[1]);
      const prefix = env.zataPrefix || 'https://idr01.zata.ai/devstoragev1/';
      inputImageUrl = `${prefix}${key}`;
      inputImageStoragePath = key;
    }
  }

  if (inputImageUrl && inputImageStoragePath) {
    await generationHistoryRepository.update(uid, historyId, {
      inputImages: [{ id: "in-1", url: inputImageUrl, storagePath: inputImageStoragePath }]
    } as any);
  }

  // 5. Call Replicate
  const inputPayload = {
    image: [inputImageUrl],
    prompt: finalPrompt,
    frameSize: "match_input_image",
    output_format: "jpg"
  };

  try {
    console.log('[reimagineProduct] Running model', { model: modelBase, input: inputPayload });
    const output: any = await replicate.run(modelBase as any, { input: inputPayload });

    // 6. Process Output
    const urls = await resolveOutputUrls(output);
    const outputUrl = urls[0];
    if (!outputUrl) throw new Error("No output URL from Replicate");

    let storedUrl = outputUrl;
    let storagePath = "";
    try {
      const username = creator?.username || uid;
      const uploaded = await uploadFromUrlToZata({
        sourceUrl: outputUrl,
        keyPrefix: `users/${username}/image/${historyId}`,
        fileName: "reimagined-1",
      });
      storedUrl = uploaded.publicUrl;
      storagePath = uploaded.key;
    } catch (e) {
      console.warn("Failed to upload output to Zata", e);
    }

    const images = [{
      id: `replicate-${Date.now()}`,
      url: storedUrl,
      storagePath,
      originalUrl: outputUrl
    }];

    const scoredImages = await aestheticScoreService.scoreImages(images);
    const highestScore = aestheticScoreService.getHighestScore(scoredImages);

    // 7. Update History
    await generationHistoryRepository.update(uid, historyId, {
      status: "completed",
      images: scoredImages,
      aestheticScore: highestScore,
      updatedAt: new Date().toISOString()
    } as any);

    await replicateRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      images: scoredImages as any
    });

    // 8. Sync Mirror
    await syncToMirror(uid, historyId);

    return {
      images: scoredImages,
      historyId,
      model: modelBase,
      status: "completed"
    };

  } catch (e: any) {
    console.error('[reimagineProduct] Error', e);
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate failed"
    } as any);
    await replicateRepository.updateGenerationRecord(legacyId, {
      status: "failed",
      error: e?.message
    });
    throw new ApiError(e?.message || "Generation failed", 502, e);
  }
};
