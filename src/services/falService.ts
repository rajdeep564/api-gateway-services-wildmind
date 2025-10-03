import {
  FalGenerateRequest,
  FalGenerateResponse,
  FalGeneratedImage,
} from "../types/fal";
import { ApiError } from "../utils/errorHandler";
import { fal } from "@fal-ai/client";
import { generationHistoryRepository } from "../repository/generationHistoryRepository";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import { authRepository } from "../repository/auth/authRepository";
import { GenerationHistoryItem, GenerationType, VideoMedia } from "../types/generate";
import { env } from "../config/env";
import { uploadFromUrlToZata, uploadDataUriToZata } from "../utils/storage/zataUpload";
import { falRepository } from "../repository/falRepository";
import { creditsRepository } from "../repository/creditsRepository";
import { computeFalVeoCostFromModel } from "../utils/pricing/falPricing";

async function generate(
  uid: string,
  payload: FalGenerateRequest
): Promise<FalGenerateResponse & { historyId?: string }> {
  const {
    prompt,
    userPrompt,
    model,
    n = 1,
    uploadedImages = [],
    output_format = "jpeg",
    generationType,
    tags,
    nsfw,
    visibility,
    isPublic,
  } = payload;

  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError("FAL AI API key not configured", 500);
  if (!prompt) throw new ApiError("Prompt is required", 400);

  fal.config({ credentials: falKey });

  // Resolve creator info up-front
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  // Create history first (source of truth)
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt,
    model,
    generationType: (payload as any).generationType || 'text-to-image',
    visibility: (payload as any).visibility || 'private',
    tags: (payload as any).tags,
    nsfw: (payload as any).nsfw,
    isPublic: (payload as any).isPublic === true,
    createdBy,
  });
  // Persist any user-uploaded input images to Zata
  try {
    const username = creator?.username || uid;
    const keyPrefix = `users/${username}/input/${historyId}`;
    const inputPersisted: any[] = [];
    let idx = 0;
    for (const src of (uploadedImages || [])) {
      if (!src || typeof src !== 'string') continue;
      try {
        const stored = /^data:/i.test(src)
          ? await uploadDataUriToZata({ dataUri: src, keyPrefix, fileName: `input-${++idx}` })
          : await uploadFromUrlToZata({ sourceUrl: src, keyPrefix, fileName: `input-${++idx}` });
        inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: src });
      } catch {}
    }
    if (inputPersisted.length > 0) await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
  } catch {}
  // Create public generations record for FAL (like BFL)
  const legacyId = await falRepository.createGenerationRecord({ prompt, model, n, isPublic: (payload as any).isPublic === true }, createdBy);

  // Only gemini-25-flash-image supported for now
  const modelEndpoint =
    uploadedImages.length > 0
      ? "fal-ai/gemini-25-flash-image/edit"
      : "fal-ai/gemini-25-flash-image";

  try {
    const imagePromises = Array.from({ length: n }, async (_, index) => {
      const input: any = { prompt, output_format, num_images: 1 };
      if (modelEndpoint.endsWith("/edit")) {
        input.image_urls = uploadedImages.slice(0, 4);
      }

      const result = await fal.subscribe(modelEndpoint, ({ input, logs: true } as unknown) as any);

      let imageUrl = "";
      if (result?.data?.images?.length > 0) {
        imageUrl = result.data.images[0].url;
      }
      if (!imageUrl)
        throw new ApiError("No image URL returned from FAL API", 502);

      return {
        url: imageUrl,
        originalUrl: imageUrl,
        id: result.requestId || `fal-${Date.now()}-${index}`,
      } as FalGeneratedImage;
    });

    const images = await Promise.all(imagePromises);
    // Upload to Zata and keep both links
    const storedImages = await Promise.all(
      images.map(async (img, index) => {
        try {
          const username = creator?.username || uid;
          const { key, publicUrl } = await uploadFromUrlToZata({
            sourceUrl: img.url,
            keyPrefix: `users/${username}/image/${historyId}`,
            fileName: `image-${index + 1}`,
          });
          return { id: img.id, url: publicUrl, storagePath: key, originalUrl: img.originalUrl || img.url };
        } catch {
          return { id: img.id, url: img.url, originalUrl: img.originalUrl || img.url } as any;
        }
      })
    );
    await falRepository.updateGenerationRecord(legacyId, { status: 'completed', images: storedImages });
    // Update authoritative history and mirror
    await generationHistoryRepository.update(uid, historyId, {
      status: 'completed',
      images: storedImages,
    } as Partial<GenerationHistoryItem>);
    try {
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) {
        await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
          uid,
          username: creator?.username,
          displayName: (creator as any)?.displayName,
          photoURL: creator?.photoURL,
        });
      }
    } catch {}
    // Return Zata URLs to client
    return { images: storedImages as any, historyId, model, status: "completed" };
  } catch (err: any) {
    const message = err?.message || "Failed to generate images with FAL API";
    try {
      await falRepository.updateGenerationRecord(legacyId, { status: 'failed', error: message });
      await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) {
        await generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
      }
    } catch {}
    throw new ApiError(message, 500);
  }
}

// Veo3 Text-to-Video (standard)
async function veoTextToVideo(uid: string, payload: {
  prompt: string;
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  duration?: '4s' | '6s' | '8s';
  negative_prompt?: string;
  enhance_prompt?: boolean;
  seed?: number;
  auto_fix?: boolean;
  resolution?: '720p' | '1080p';
  generate_audio?: boolean;
  isPublic?: boolean;
}): Promise<{ videos: VideoMedia[]; historyId: string; model: string; status: 'completed' }>{
  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  if (!payload.prompt) throw new ApiError('Prompt is required', 400);
  fal.config({ credentials: falKey });

  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: payload.prompt,
    model: 'fal-ai/veo3',
    generationType: 'text-to-video',
    visibility: payload.isPublic ? 'public' : 'private',
    isPublic: payload.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
  });

  try {
    const result = await fal.subscribe('fal-ai/veo3', ({
      input: {
        prompt: payload.prompt,
        aspect_ratio: payload.aspect_ratio ?? '16:9',
        duration: payload.duration ?? '8s',
        negative_prompt: payload.negative_prompt,
        enhance_prompt: payload.enhance_prompt ?? true,
        seed: payload.seed,
        auto_fix: payload.auto_fix ?? true,
        resolution: payload.resolution ?? '720p',
        generate_audio: payload.generate_audio ?? true,
      },
      logs: true,
    } as unknown) as any);

    const videoUrl: string | undefined = (result as any)?.data?.video?.url;
    if (!videoUrl) throw new ApiError('No video URL returned from FAL API', 502);
    const videos: VideoMedia[] = [
      { id: result.requestId || `fal-${Date.now()}`, url: videoUrl, storagePath: '', thumbUrl: undefined },
    ];
    await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos } as any);
    try {
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
        uid,
        username: creator?.username,
        displayName: (creator as any)?.displayName,
        photoURL: creator?.photoURL,
      });
    } catch {}
    return { videos, historyId, model: 'fal-ai/veo3', status: 'completed' };
  } catch (err: any) {
    const message = err?.message || 'Failed to generate video with FAL API';
    try {
      await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) await generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
    } catch {}
    throw new ApiError(message, 500);
  }
}

// Veo3 Text-to-Video (fast)
async function veoTextToVideoFast(uid: string, payload: Parameters<typeof veoTextToVideo>[1]) {
  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  if (!payload.prompt) throw new ApiError('Prompt is required', 400);
  fal.config({ credentials: falKey });

  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: payload.prompt,
    model: 'fal-ai/veo3/fast',
    generationType: 'text-to-video',
    visibility: payload.isPublic ? 'public' : 'private',
    isPublic: payload.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
  });

  try {
    const result = await fal.subscribe('fal-ai/veo3/fast', ({
      input: {
        prompt: payload.prompt,
        aspect_ratio: payload.aspect_ratio ?? '16:9',
        duration: payload.duration ?? '8s',
        negative_prompt: payload.negative_prompt,
        enhance_prompt: payload.enhance_prompt ?? true,
        seed: payload.seed,
        auto_fix: payload.auto_fix ?? true,
        resolution: payload.resolution ?? '720p',
        generate_audio: payload.generate_audio ?? true,
      },
      logs: true,
    } as unknown) as any);
    const videoUrl: string | undefined = (result as any)?.data?.video?.url;
    if (!videoUrl) throw new ApiError('No video URL returned from FAL API', 502);
    const videos: VideoMedia[] = [
      { id: result.requestId || `fal-${Date.now()}`, url: videoUrl, storagePath: '', thumbUrl: undefined },
    ];
    await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos } as any);
    try {
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
        uid,
        username: creator?.username,
        displayName: (creator as any)?.displayName,
        photoURL: creator?.photoURL,
      });
    } catch {}
    return { videos, historyId, model: 'fal-ai/veo3/fast', status: 'completed' };
  } catch (err: any) {
    const message = err?.message || 'Failed to generate video with FAL API';
    try {
      await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) await generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
    } catch {}
    throw new ApiError(message, 500);
  }
}

// Veo3 Image-to-Video (standard)
async function veoImageToVideo(uid: string, payload: {
  prompt: string;
  image_url: string;
  aspect_ratio?: 'auto' | '16:9' | '9:16';
  duration?: '8s';
  generate_audio?: boolean;
  resolution?: '720p' | '1080p';
  isPublic?: boolean;
}): Promise<{ videos: VideoMedia[]; historyId: string; model: string; status: 'completed' }> {
  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  if (!payload.prompt) throw new ApiError('Prompt is required', 400);
  if (!payload.image_url) throw new ApiError('image_url is required', 400);
  fal.config({ credentials: falKey });

  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: payload.prompt,
    model: 'fal-ai/veo3/image-to-video',
    generationType: 'text-to-video',
    visibility: payload.isPublic ? 'public' : 'private',
    isPublic: payload.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
  });

  try {
    const result = await fal.subscribe('fal-ai/veo3/image-to-video', ({
      input: {
        prompt: payload.prompt,
        image_url: payload.image_url,
        aspect_ratio: payload.aspect_ratio ?? 'auto',
        duration: payload.duration ?? '8s',
        generate_audio: payload.generate_audio ?? true,
        resolution: payload.resolution ?? '720p',
      },
      logs: true,
    } as unknown) as any);
    const videoUrl: string | undefined = (result as any)?.data?.video?.url;
    if (!videoUrl) throw new ApiError('No video URL returned from FAL API', 502);
    const videos: VideoMedia[] = [
      { id: result.requestId || `fal-${Date.now()}`, url: videoUrl, storagePath: '', thumbUrl: undefined },
    ];
    await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos } as any);
    try {
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
        uid,
        username: creator?.username,
        displayName: (creator as any)?.displayName,
        photoURL: creator?.photoURL,
      });
    } catch {}
    return { videos, historyId, model: 'fal-ai/veo3/image-to-video', status: 'completed' };
  } catch (err: any) {
    const message = err?.message || 'Failed to generate video with FAL API';
    try {
      await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) await generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
    } catch {}
    throw new ApiError(message, 500);
  }
}

// Veo3 Image-to-Video (fast)
async function veoImageToVideoFast(uid: string, payload: Parameters<typeof veoImageToVideo>[1]) {
  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  if (!payload.prompt) throw new ApiError('Prompt is required', 400);
  if (!payload.image_url) throw new ApiError('image_url is required', 400);
  fal.config({ credentials: falKey });

  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: payload.prompt,
    model: 'fal-ai/veo3/fast/image-to-video',
    generationType: 'text-to-video',
    visibility: payload.isPublic ? 'public' : 'private',
    isPublic: payload.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
  });

  try {
    const result = await fal.subscribe('fal-ai/veo3/fast/image-to-video', ({
      input: {
        prompt: payload.prompt,
        image_url: payload.image_url,
        aspect_ratio: payload.aspect_ratio ?? 'auto',
        duration: payload.duration ?? '8s',
        generate_audio: payload.generate_audio ?? true,
        resolution: payload.resolution ?? '720p',
      },
      logs: true,
    } as unknown) as any);
    const videoUrl: string | undefined = (result as any)?.data?.video?.url;
    if (!videoUrl) throw new ApiError('No video URL returned from FAL API', 502);
    const videos: VideoMedia[] = [
      { id: result.requestId || `fal-${Date.now()}`, url: videoUrl, storagePath: '', thumbUrl: undefined },
    ];
    await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos } as any);
    try {
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
        uid,
        username: creator?.username,
        displayName: (creator as any)?.displayName,
        photoURL: creator?.photoURL,
      });
    } catch {}
    return { videos, historyId, model: 'fal-ai/veo3/fast/image-to-video', status: 'completed' };
  } catch (err: any) {
    const message = err?.message || 'Failed to generate video with FAL API';
    try {
      await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) await generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
    } catch {}
    throw new ApiError(message, 500);
  }
}

export const falService = {
  generate,
};

// Queue-oriented API
type SubmitReturn = { requestId: string; historyId: string; model: string; status: 'submitted' };

async function queueCreateHistory(uid: string, data: { prompt: string; model: string; isPublic?: boolean }) {
  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: data.prompt,
    model: data.model,
    generationType: 'text-to-video',
    visibility: data.isPublic ? 'public' : 'private',
    isPublic: data.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
  });
  return { historyId, creator };
}

async function veoTtvSubmit(uid: string, body: any, fast = false): Promise<SubmitReturn> {
  const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  fal.config({ credentials: falKey });
  if (!body?.prompt) throw new ApiError('Prompt is required', 400);
  const model = fast ? 'fal-ai/veo3/fast' : 'fal-ai/veo3';
  const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
  const { request_id } = await fal.queue.submit(model, {
    input: {
      prompt: body.prompt,
      aspect_ratio: body.aspect_ratio ?? '16:9',
      duration: body.duration ?? '8s',
      negative_prompt: body.negative_prompt,
      enhance_prompt: body.enhance_prompt ?? true,
      seed: body.seed,
      auto_fix: body.auto_fix ?? true,
      resolution: body.resolution ?? '720p',
      generate_audio: body.generate_audio ?? true,
    },
  } as any);
  await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id } as any);
  return { requestId: request_id, historyId, model, status: 'submitted' };
}

async function veoI2vSubmit(uid: string, body: any, fast = false): Promise<SubmitReturn> {
  const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  fal.config({ credentials: falKey });
  if (!body?.prompt) throw new ApiError('Prompt is required', 400);
  if (!body?.image_url) throw new ApiError('image_url is required', 400);
  const model = fast ? 'fal-ai/veo3/fast/image-to-video' : 'fal-ai/veo3/image-to-video';
  const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
  const { request_id } = await fal.queue.submit(model, {
    input: {
      prompt: body.prompt,
      image_url: body.image_url,
      aspect_ratio: body.aspect_ratio ?? 'auto',
      duration: body.duration ?? '8s',
      generate_audio: body.generate_audio ?? true,
      resolution: body.resolution ?? '720p',
    },
  } as any);
  await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id } as any);
  return { requestId: request_id, historyId, model, status: 'submitted' };
}

async function queueStatus(_uid: string, model: string, requestId: string): Promise<any> {
  const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  fal.config({ credentials: falKey });
  const status = await fal.queue.status(model, { requestId, logs: true } as any);
  return status;
}

async function queueResult(uid: string, model: string, requestId: string): Promise<any> {
  const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  fal.config({ credentials: falKey });
  const result = await fal.queue.result(model, { requestId } as any);
  const located = await generationHistoryRepository.findByProviderTaskId(uid, 'fal', requestId);
  if (result?.data?.video?.url && located) {
    const providerUrl: string = result.data.video.url as string;
    let videos: VideoMedia[] = [];
    try {
      const username = (await authRepository.getUserById(uid))?.username || uid;
      const keyPrefix = `users/${username}/video/${located.id}`;
      const uploaded = await uploadFromUrlToZata({
        sourceUrl: providerUrl,
        keyPrefix,
        fileName: 'video-1',
      });
      videos = [ { id: requestId, url: uploaded.publicUrl, storagePath: uploaded.key } as any ];
      await generationHistoryRepository.update(uid, located.id, { status: 'completed', videos: [ { id: requestId, url: uploaded.publicUrl, storagePath: uploaded.key, originalUrl: providerUrl } ] as any } as any);
    } catch (e) {
      // Fallback to provider URL if Zata upload fails
      videos = [ { id: requestId, url: providerUrl, storagePath: '' } as any ];
      await generationHistoryRepository.update(uid, located.id, { status: 'completed', videos: [ { id: requestId, url: providerUrl, storagePath: '', originalUrl: providerUrl } ] as any } as any);
    }
    const fresh = await generationHistoryRepository.get(uid, located.id);
    if (fresh) {
      const creator = await authRepository.getUserById(uid);
      await generationsMirrorRepository.upsertFromHistory(uid, located.id, fresh, {
        uid,
        username: creator?.username,
        displayName: (creator as any)?.displayName,
        photoURL: creator?.photoURL,
      });
    }
    // Build enriched response with Zata and original URLs
    const enrichedVideos = (fresh?.videos && Array.isArray(fresh.videos) ? fresh.videos : videos).map((v: any) => ({
      id: v.id,
      url: v.url,
      storagePath: v.storagePath,
      originalUrl: v.originalUrl || providerUrl,
    }));
    try {
      const { cost, pricingVersion, meta } = computeFalVeoCostFromModel(model);
      await creditsRepository.writeDebitIfAbsent(uid, located.id, cost, 'fal.queue.veo', { ...meta, historyId: located.id, provider: 'fal', pricingVersion });
    } catch {}
    return { videos: enrichedVideos, historyId: located.id, model, requestId, status: 'completed' } as any;
  }
  // Handle image outputs (T2I/I2I)
  if (located && (result?.data?.images?.length || result?.data?.image?.url)) {
    const username = (await authRepository.getUserById(uid))?.username || uid;
    const keyPrefix = `users/${username}/image/${located.id}`;
    const providerImages: { url: string }[] = Array.isArray(result?.data?.images)
      ? (result.data.images as any[])
      : result?.data?.image?.url
        ? [{ url: result.data.image.url as string }]
        : [];
    const stored = await Promise.all(providerImages.map(async (img, index) => {
      try {
        const up = await uploadFromUrlToZata({ sourceUrl: img.url, keyPrefix, fileName: `image-${index+1}` });
        return { id: `${requestId}-${index+1}`, url: up.publicUrl, storagePath: up.key, originalUrl: img.url } as any;
      } catch {
        return { id: `${requestId}-${index+1}`, url: img.url, originalUrl: img.url } as any;
      }
    }));
    await generationHistoryRepository.update(uid, located.id, { status: 'completed', images: stored } as any);
    try {
      const { cost, pricingVersion, meta } = computeFalVeoCostFromModel(model);
      await creditsRepository.writeDebitIfAbsent(uid, located.id, cost, 'fal.queue.image', { ...meta, historyId: located.id, provider: 'fal', pricingVersion });
    } catch {}
    const fresh = await generationHistoryRepository.get(uid, located.id);
    if (fresh) {
      const creator = await authRepository.getUserById(uid);
      await generationsMirrorRepository.upsertFromHistory(uid, located.id, fresh, {
        uid,
        username: creator?.username,
        displayName: (creator as any)?.displayName,
        photoURL: creator?.photoURL,
      });
    }
    return { images: stored, historyId: located.id, model, requestId, status: 'completed' } as any;
  }
  return result;
}

export const falQueueService = {
  veoTtvSubmit,
  veoI2vSubmit,
  queueStatus,
  queueResult,
};

