import Replicate from "replicate";
import { env } from '../../../config/env';
import { ApiError } from '../../../utils/errorHandler';
import { authRepository } from '../../../repository/auth/authRepository';
import { generationHistoryRepository } from '../../../repository/generationHistoryRepository';
import { replicateRepository } from '../../../repository/replicateRepository';
import { uploadDataUriToZata, uploadFromUrlToZata } from '../../../utils/storage/zataUpload';
import { aestheticScoreService } from '../../aestheticScoreService';
import { syncToMirror } from '../../../utils/mirrorHelper';

const resolveOutputUrls = async (output: any) => {
  if (!output) return [];
  if (Array.isArray(output)) return output.map(String);
  if (typeof output === 'object' && output.url) return [String(output.url())];
  return [String(output)];
};

export interface FamousPhotographerRequest {
  sourceImage: string;
  style: string;
  isPublic?: boolean;
}

const STYLE_PROMPTS: Record<string, string> = {
  'steve-mccurry': 'in the signature style of Steve McCurry, vibrant colors, humanistic portraiture, high-end National Geographic photography, sharp details, warm natural lighting',
  'annie-leibovitz': 'in the signature style of Annie Leibovitz, dramatic lighting, painterly texture, high-end celebrity editorial portrait, professional studio lighting, cinematic atmosphere',
  'ansel-adams': 'in the signature style of Ansel Adams, classic black and white photography, extremely high contrast, majestic fine art photography, deep shadows, bright highlights, intense texture',
  'peter-lindbergh': 'in the signature style of Peter Lindbergh, raw and emotional black and white fashion photography, cinematic lighting, natural beauty, grain texture, dramatic mood',
  'cartier-bresson': 'in the signature style of Henri Cartier-Bresson, candid black and white photography, the decisive moment, realistic grain, street photography masterpiece, high contrast'
};

export const generateFamousPhotographer = async (uid: string, req: FamousPhotographerRequest) => {
  const key = env.replicateApiKey as string;
  if (!key) throw new ApiError("Replicate API key not configured", 500);

  const replicate = new Replicate({ auth: key });
  const modelBase = 'qwen/qwen-image-edit-2511';

  const creator = await authRepository.getUserById(uid);
  const stylePrompt = STYLE_PROMPTS[req.style] || STYLE_PROMPTS['steve-mccurry'];
  const finalPrompt = `Professional photograph ${stylePrompt}, maintaining the exact identity and features of the subject in the reference image, hyper-realistic, 8k resolution.`;

  // 1. Create History Record
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: finalPrompt,
    model: modelBase,
    generationType: "image-to-image",
    visibility: req.isPublic ? "public" : "private",
    isPublic: req.isPublic ?? true,
    createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
  } as any);

  // 2. Create Legacy Record
  const legacyId = await replicateRepository.createGenerationRecord(
    {
      prompt: finalPrompt,
      model: modelBase,
      isPublic: req.isPublic ?? true
    },
    creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid }
  );

  // 3. Handle Input Image
  let inputImageUrl = req.sourceImage;
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

  // 4. Call Replicate
  const inputPayload = {
    image: [inputImageUrl],
    prompt: finalPrompt,
    frameSize: "match_input_image",
    style: "none",
    output_format: "jpg"
  };

  try {
    console.log('[famousPhotographerService] Running model', { model: modelBase, input: inputPayload });
    const output: any = await replicate.run(modelBase as any, { input: inputPayload });

    // 5. Process Output
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
        fileName: "famous-photographer-1",
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

    // 6. Update History
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

    // 7. Sync Mirror
    await syncToMirror(uid, historyId);

    return {
      images: scoredImages,
      historyId,
      model: modelBase,
      status: "completed"
    };

  } catch (e: any) {
    console.error('[famousPhotographerService] Error', e);
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
