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

export interface AutomotiveRequest {
  carImage: string;
  background: string;
  lighting: string;
  motionBlur: string;
  isPublic?: boolean;
}

const BACKGROUND_PROMPTS: Record<string, string> = {
  'urban': 'modern city downtown street with skyscrapers and glass buildings',
  'mountain': 'winding mountain pass road with snow-capped peaks and rocky cliffs',
  'coast': 'scenic coastal highway with ocean view and crashing waves',
  'studio': 'professional clean photo studio with white infinity cove and overhead softbox',
  'forest': 'dense pine forest road with morning mist and tall trees',
  'desert': 'open desert highway with sand dunes and clear blue sky'
};

const LIGHTING_PROMPTS: Record<string, string> = {
  'golden-hour': 'warm golden hour sunlight, long soft shadows, backlit silhouette',
  'sunset': 'dramatic deep orange and purple sunset afterglow',
  'noon': 'bright harsh midday sun, clear high contrast lighting',
  'moonlight': 'cool blue moonlight, silver highlights, dark atmospheric shadows',
  'cinematic': 'cinematic teal and orange lighting, anamorphic flares',
  'neon': 'cyberpunk neon nights, vibrant city lights, wet road reflections'
};

const MOTION_PROMPTS: Record<string, string> = {
  'None': 'static studio shot, frozen in time',
  'Low': 'slight wheel rotation, minimal background blur',
  'Medium': 'dynamic panning shot, moderate motion blur on background and wheels',
  'High': 'high speed action shot, heavy background streaking blur, fast motion'
};

export const generateAutomotiveShot = async (uid: string, req: AutomotiveRequest) => {
  const key = env.replicateApiKey as string;
  if (!key) throw new ApiError("Replicate API key not configured", 500);

  const replicate = new Replicate({ auth: key });
  const modelBase = 'qwen/qwen-image-edit-2511';

  const creator = await authRepository.getUserById(uid);

  const bgPrompt = BACKGROUND_PROMPTS[req.background] || req.background;
  const lightPrompt = LIGHTING_PROMPTS[req.lighting] || req.lighting;
  const mtPrompt = MOTION_PROMPTS[req.motionBlur] || req.motionBlur;

  const finalPrompt = `Professional automotive photography of a car. Environment: ${bgPrompt}. Lighting: ${lightPrompt}. Motion: ${mtPrompt}. High-end commercial style, realistic 8k resolution, photorealistic, sharp details, luxury finish. Maintain car identity perfectly.`;

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
  let inputImageUrl = req.carImage;
  let inputImageStoragePath: string | undefined;

  if (inputImageUrl.startsWith('data:')) {
    const username = creator?.username || uid;
    const stored = await uploadDataUriToZata({
      dataUri: inputImageUrl,
      keyPrefix: `users/${username}/input/${historyId}`,
      fileName: "source-car",
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
    output_format: "png"
  };

  try {
    console.log('[automotiveService] Running model', { model: modelBase, input: inputPayload });
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
        fileName: "automotive-1",
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
    console.error('[automotiveService] Error', e);
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
