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
    // Support both old (n) and new (num_images)
    n,
    num_images,
    // New schema: aspect_ratio (fallback to frameSize)
    aspect_ratio,
    frameSize,
    uploadedImages = [],
    output_format = "jpeg",
    generationType,
    tags,
    nsfw,
    visibility,
    isPublic,
  } = payload as any;

  const imagesRequested = Number.isFinite(num_images) && (num_images as number) > 0 ? (num_images as number) : (Number.isFinite(n) && (n as number) > 0 ? (n as number) : 1);
  const imagesRequestedClamped = Math.max(1, Math.min(10, imagesRequested));
  const resolvedAspect = (aspect_ratio || frameSize || '1:1') as any;

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
    frameSize: resolvedAspect,
    createdBy,
    
    
  });
  // Persist any user-uploaded input images to Zata and get public URLs
  let publicImageUrls: string[] = [];
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
        publicImageUrls.push(stored.publicUrl);
      } catch {}
    }
    if (inputPersisted.length > 0) await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
  } catch {}
  // Create public generations record for FAL (like BFL)
  const legacyId = await falRepository.createGenerationRecord({ prompt, model, n: imagesRequested, isPublic: (payload as any).isPublic === true }, createdBy);

  // Map our model key to FAL endpoints
  let modelEndpoint: string;
  const modelLower = (model || '').toLowerCase();
  if (modelLower.includes('imagen-4')) {
    // Imagen 4 family
    if (modelLower.includes('ultra')) modelEndpoint = 'fal-ai/imagen4/preview/ultra';
    else if (modelLower.includes('fast')) modelEndpoint = 'fal-ai/imagen4/preview/fast';
    else modelEndpoint = 'fal-ai/imagen4/preview'; // standard
  } else if (modelLower.includes('seedream')) {
    modelEndpoint = 'fal-ai/bytedance/seedream/v4/text-to-image';
  } else {
    // Default to Google Nano Banana (Gemini)
    modelEndpoint = uploadedImages.length > 0
      ? 'fal-ai/gemini-25-flash-image/edit'
      : 'fal-ai/gemini-25-flash-image';
  }

  try {
    const imagePromises = Array.from({ length: imagesRequested }, async (_, index) => {
  const input: any = { prompt, output_format, num_images: 1 };
      // Seedream expects image_size instead of aspect_ratio; allow explicit image_size override
      if (modelEndpoint.includes('seedream')) {
        const explicit = (payload as any).image_size;
        if (explicit) {
          input.image_size = explicit;
        } else {
          // Map common aspect ratios to Seedream enums
          const map: Record<string, string> = {
            '1:1': 'square',
            '4:3': 'landscape_4_3',
            '3:4': 'portrait_4_3',
            '16:9': 'landscape_16_9',
            '9:16': 'portrait_16_9',
          };
          input.image_size = map[String(resolvedAspect)] || 'square';
        }
      } else if (resolvedAspect) {
        input.aspect_ratio = resolvedAspect;
      }
      // Imagen 4 supports resolution and seed/negative_prompt
      if (modelEndpoint.startsWith('fal-ai/imagen4/')) {
        if ((payload as any).resolution) input.resolution = (payload as any).resolution; // '1K' | '2K'
        if ((payload as any).seed != null) input.seed = (payload as any).seed;
        if ((payload as any).negative_prompt) input.negative_prompt = (payload as any).negative_prompt;
      }
      if (modelEndpoint.endsWith("/edit")) {
        // Use public URLs for edit endpoint, fallback to original uploadedImages if no public URLs available
        input.image_urls = publicImageUrls.length > 0 ? publicImageUrls.slice(0, 10) : uploadedImages.slice(0, 10);
      }

      // Debug log for final body
      try { console.log('[falService.generate] request', { modelEndpoint, input }); } catch {}

      const result = await fal.subscribe(modelEndpoint as any, ({ input, logs: true } as unknown) as any);

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
      frameSize: resolvedAspect,
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
    const result = await fal.subscribe('fal-ai/veo3' as any, ({ input: {
      prompt: payload.prompt,
      aspect_ratio: payload.aspect_ratio ?? '16:9',
      duration: payload.duration ?? '8s',
      negative_prompt: payload.negative_prompt,
      enhance_prompt: payload.enhance_prompt ?? true,
      seed: payload.seed,
      auto_fix: payload.auto_fix ?? true,
      resolution: payload.resolution ?? '720p',
      generate_audio: payload.generate_audio ?? true,
    }, logs: true } as unknown) as any);

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
    const result = await fal.subscribe('fal-ai/veo3/fast' as any, ({ input: {
      prompt: payload.prompt,
      aspect_ratio: payload.aspect_ratio ?? '16:9',
      duration: payload.duration ?? '8s',
      negative_prompt: payload.negative_prompt,
      enhance_prompt: payload.enhance_prompt ?? true,
      seed: payload.seed,
      auto_fix: payload.auto_fix ?? true,
      resolution: payload.resolution ?? '720p',
      generate_audio: payload.generate_audio ?? true,
    }, logs: true } as unknown) as any);
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
  duration?: '4s' | '6s' | '8s';
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
    const result = await fal.subscribe('fal-ai/veo3/image-to-video' as any, ({ input: {
      prompt: payload.prompt,
      image_url: payload.image_url,
      aspect_ratio: payload.aspect_ratio ?? 'auto',
      duration: payload.duration ?? '8s',
      generate_audio: payload.generate_audio ?? true,
      resolution: payload.resolution ?? '720p',
    }, logs: true } as unknown) as any);
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
    const result = await fal.subscribe('fal-ai/veo3/fast/image-to-video' as any, ({ input: {
      prompt: payload.prompt,
      image_url: payload.image_url,
      aspect_ratio: payload.aspect_ratio ?? 'auto',
      duration: payload.duration ?? '8s',
      generate_audio: payload.generate_audio ?? true,
      resolution: payload.resolution ?? '720p',
    }, logs: true } as unknown) as any);
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
  async topazUpscaleImage(uid: string, body: any): Promise<{ images: FalGeneratedImage[]; historyId: string; model: string; status: 'completed' }>{
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    if (!body?.image_url && !body?.image) throw new ApiError('image_url or image is required', 400);
    fal.config({ credentials: falKey });

    const model = 'fal-ai/topaz/upscale/image';
    const creator = await authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: 'Upscale Image',
      model,
      generationType: 'image-upscale',
      visibility: body.isPublic ? 'public' : 'private',
      isPublic: body.isPublic === true,
      createdBy,
    });

    try {
      // Resolve input URL: allow direct URL or data URI via temporary upload
      let resolvedUrl: string | undefined = typeof body.image_url === 'string' ? body.image_url : undefined;
      if (!resolvedUrl && typeof body.image === 'string' && /^data:/i.test(body.image)) {
        try {
          const stored = await uploadDataUriToZata({ dataUri: body.image, keyPrefix: `users/${(creator?.username || uid)}/input/${historyId}`, fileName: 'topaz-source' });
          resolvedUrl = stored.publicUrl;
        } catch {}
      }
      if (!resolvedUrl) throw new ApiError('Unable to resolve image_url for Topaz upscale', 400);

      const input: any = {
        image_url: resolvedUrl,
        upscale_factor: body.upscale_factor ?? 2,
        model: body.model || 'Standard V2',
        crop_to_fill: body.crop_to_fill ?? false,
        output_format: body.output_format || 'jpeg',
        subject_detection: body.subject_detection || 'All',
        face_enhancement: body.face_enhancement ?? true,
        face_enhancement_strength: body.face_enhancement_strength ?? 0.8,
        face_enhancement_creativity: body.face_enhancement_creativity,
      };
      const result = await fal.subscribe(model as any, ({ input, logs: true } as unknown) as any);
      const imgUrl: string | undefined = (result as any)?.data?.image?.url;
      if (!imgUrl) throw new ApiError('No image URL returned from FAL API', 502);
      const username = creator?.username || uid;
      const { key, publicUrl } = await uploadFromUrlToZata({ sourceUrl: imgUrl, keyPrefix: `users/${username}/image/${historyId}`, fileName: 'upscaled' });
      const images: FalGeneratedImage[] = [ { id: result.requestId || `fal-${Date.now()}`, url: publicUrl, storagePath: key, originalUrl: imgUrl } as any ];
      await generationHistoryRepository.update(uid, historyId, { status: 'completed', images } as any);
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
      return { images, historyId, model, status: 'completed' };
    } catch (err: any) {
      const message = err?.message || 'Failed to upscale image with FAL API';
      try {
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        const fresh = await generationHistoryRepository.get(uid, historyId);
        if (fresh) await generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
      } catch {}
      throw new ApiError(message, 500);
    }
  },
  async seedvrUpscale(uid: string, body: any): Promise<{ videos: VideoMedia[]; historyId: string; model: string; status: 'completed' }>{
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    if (!body?.video_url) throw new ApiError('video_url is required', 400);
    fal.config({ credentials: falKey });

    const model = 'fal-ai/seedvr/upscale/video';
    const creator = await authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: 'Upscale Video',
      model,
      generationType: 'video-upscale',
      visibility: body.isPublic ? 'public' : 'private',
      isPublic: body.isPublic === true,
      createdBy,
    });

    try {
      const input: any = { video_url: body.video_url };
      if (body.upscale_mode) input.upscale_mode = body.upscale_mode;
      if (body.upscale_factor != null) input.upscale_factor = body.upscale_factor;
      if (body.target_resolution) input.target_resolution = body.target_resolution;
      if (body.noise_scale != null) input.noise_scale = body.noise_scale;
      if (body.output_format) input.output_format = body.output_format;
      if (body.output_quality) input.output_quality = body.output_quality;
      if (body.output_write_mode) input.output_write_mode = body.output_write_mode;
      const result = await fal.subscribe(model as any, ({ input, logs: true } as unknown) as any);
      const videoUrl: string | undefined = (result as any)?.data?.video?.url || (result as any)?.data?.video_url || (result as any)?.data?.output?.video?.url;
      if (!videoUrl) throw new ApiError('No video URL returned from FAL API', 502);
      const username = creator?.username || uid;
      const keyPrefix = `users/${username}/video/${historyId}`;
      let stored: any;
      try {
        stored = await uploadFromUrlToZata({ sourceUrl: videoUrl, keyPrefix, fileName: 'upscaled' });
      } catch {
        stored = { publicUrl: videoUrl, key: '' };
      }
      const videos: VideoMedia[] = [ { id: result.requestId || `fal-${Date.now()}`, url: stored.publicUrl, storagePath: stored.key, originalUrl: videoUrl } as any ];
      await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos } as any);
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
      return { videos, historyId, model, status: 'completed' };
    } catch (err: any) {
      const message = err?.message || 'Failed to upscale video with FAL API';
      try {
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        const fresh = await generationHistoryRepository.get(uid, historyId);
        if (fresh) await generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
      } catch {}
      throw new ApiError(message, 500);
    }
  },
  async image2svg(uid: string, body: any): Promise<{ images: FalGeneratedImage[]; historyId: string; model: string; status: 'completed' }>{
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    if (!(body?.image_url) && !(body?.image)) throw new ApiError('image_url or image is required', 400);
    fal.config({ credentials: falKey });

    const model = 'fal-ai/image2svg';
    const creator = await authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: 'Convert to SVG',
      model,
      generationType: 'image-to-svg',
      visibility: body.isPublic ? 'public' : 'private',
      isPublic: body.isPublic === true,
      createdBy,
    });

    try {
      // Resolve input URL: accept direct URL or upload data URI to Zata
      let inputUrl: string | undefined = typeof body?.image_url === 'string' ? body.image_url : undefined;
      if (!inputUrl && typeof body?.image === 'string') {
        try {
          const username = creator?.username || uid;
          const stored = await uploadDataUriToZata({ dataUri: body.image, keyPrefix: `users/${username}/input/${historyId}`, fileName: 'vectorize-source' });
          inputUrl = stored.publicUrl;
        } catch {
          inputUrl = undefined;
        }
      }
      if (!inputUrl) throw new ApiError('Unable to resolve image_url for image2svg', 400);

      const result = await fal.subscribe(model as any, ({ input: {
        image_url: inputUrl,
        colormode: body.colormode ?? 'color',
        hierarchical: body.hierarchical ?? 'stacked',
        mode: body.mode ?? 'spline',
        filter_speckle: body.filter_speckle ?? 4,
        color_precision: body.color_precision ?? 6,
        layer_difference: body.layer_difference ?? 16,
        corner_threshold: body.corner_threshold ?? 60,
        length_threshold: body.length_threshold ?? 4,
        max_iterations: body.max_iterations ?? 10,
        splice_threshold: body.splice_threshold ?? 45,
        path_precision: body.path_precision ?? 3,
      }, logs: true } as unknown) as any);

      const files: any[] = Array.isArray((result as any)?.data?.images) ? (result as any).data.images : [];
      const svgUrl = files[0]?.url as string | undefined;
      if (!svgUrl) throw new ApiError('No SVG URL returned from FAL API', 502);

      const username = creator?.username || uid;
      let stored: any;
      try {
        stored = await uploadFromUrlToZata({ sourceUrl: svgUrl, keyPrefix: `users/${username}/image/${historyId}`, fileName: 'vectorized' });
      } catch {
        stored = { publicUrl: svgUrl, key: '' };
      }
      const images: FalGeneratedImage[] = [ { id: result.requestId || `fal-${Date.now()}`, url: stored.publicUrl, originalUrl: svgUrl } as any ];
      await generationHistoryRepository.update(uid, historyId, { status: 'completed', images } as any);
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
      return { images, historyId, model, status: 'completed' };
    } catch (err: any) {
      const message = err?.message || 'Failed to convert image to SVG with FAL API';
      try {
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        const fresh = await generationHistoryRepository.get(uid, historyId);
        if (fresh) await generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
      } catch {}
      throw new ApiError(message, 500);
    }
  },
  async recraftVectorize(uid: string, body: any): Promise<{ images: FalGeneratedImage[]; historyId: string; model: string; status: 'completed' }>{
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    if (!(body?.image_url) && !(body?.image)) throw new ApiError('image_url or image is required', 400);
    fal.config({ credentials: falKey });

    const model = 'fal-ai/recraft/vectorize';
    const creator = await authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: 'Vectorize Image',
      model,
      generationType: 'image-to-svg',
      visibility: body.isPublic ? 'public' : 'private',
      isPublic: body.isPublic === true,
      createdBy,
    });

    try {
      // Resolve input URL: accept direct URL, or upload data URI / raw image string to Zata
      let inputUrl: string | undefined = typeof body?.image_url === 'string' ? body.image_url : undefined;
      if (!inputUrl && typeof body?.image === 'string') {
        const imageStr: string = body.image;
        if (/^data:/i.test(imageStr)) {
          try {
            const username = creator?.username || uid;
            const stored = await uploadDataUriToZata({ dataUri: imageStr, keyPrefix: `users/${username}/input/${historyId}` , fileName: 'vectorize-source' });
            inputUrl = stored.publicUrl;
          } catch {
            inputUrl = undefined;
          }
        } else if (/^https?:\/\//i.test(imageStr)) {
          inputUrl = imageStr;
        }
      }
      if (!inputUrl) throw new ApiError('Unable to resolve image_url for vectorize', 400);

      const result = await fal.subscribe(model as any, ({ input: { image_url: inputUrl }, logs: true } as unknown) as any);
      const svgUrl: string | undefined = (result as any)?.data?.image?.url;
      if (!svgUrl) throw new ApiError('No SVG URL returned from FAL API', 502);

      const username = creator?.username || uid;
      let stored: any;
      try { stored = await uploadFromUrlToZata({ sourceUrl: svgUrl, keyPrefix: `users/${username}/image/${historyId}`, fileName: 'vectorized' }); }
      catch { stored = { publicUrl: svgUrl, key: '' }; }
      const images: FalGeneratedImage[] = [ { id: result.requestId || `fal-${Date.now()}`, url: stored.publicUrl, originalUrl: svgUrl } as any ];
      await generationHistoryRepository.update(uid, historyId, { status: 'completed', images } as any);
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
      return { images, historyId, model, status: 'completed' };
    } catch (err: any) {
      const message = err?.message || 'Failed to vectorize image with FAL API';
      try {
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        const fresh = await generationHistoryRepository.get(uid, historyId);
        if (fresh) await generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
      } catch {}
      throw new ApiError(message, 500);
    }
  }
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
    const providerVideoId: string | undefined = (result as any)?.data?.video_id || (result as any)?.data?.videoId;
    let videos: VideoMedia[] = [];
    try {
      const username = (await authRepository.getUserById(uid))?.username || uid;
      const keyPrefix = `users/${username}/video/${located.id}`;
      const uploaded = await uploadFromUrlToZata({
        sourceUrl: providerUrl,
        keyPrefix,
        fileName: 'video-1',
      });
      const videoObj: any = { id: requestId, url: uploaded.publicUrl, storagePath: uploaded.key, originalUrl: providerUrl };
      if (providerVideoId) videoObj.soraVideoId = providerVideoId;
      videos = [ videoObj as any ];
      await generationHistoryRepository.update(uid, located.id, { status: 'completed', videos: [ videoObj ] as any, ...(providerVideoId ? { soraVideoId: providerVideoId } : {}) } as any);
    } catch (e) {
      // Fallback to provider URL if Zata upload fails
      const videoObj: any = { id: requestId, url: providerUrl, storagePath: '', originalUrl: providerUrl };
      if (providerVideoId) videoObj.soraVideoId = providerVideoId;
      videos = [ videoObj as any ];
      await generationHistoryRepository.update(uid, located.id, { status: 'completed', videos: [ videoObj ] as any, ...(providerVideoId ? { soraVideoId: providerVideoId } : {}) } as any);
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
      const { cost, pricingVersion, meta } = computeFalVeoCostFromModel(model, (located as any)?.item);
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
      const { cost, pricingVersion, meta } = computeFalVeoCostFromModel(model, (located as any)?.item);
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
  // Veo 3.1 variants
  async veo31TtvSubmit(uid: string, body: any, fast = false): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    const model = fast ? 'fal-ai/veo3.1/fast' : 'fal-ai/veo3.1';
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
    await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id, generate_audio: body.generate_audio ?? true } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  async veo31I2vSubmit(uid: string, body: any, fast = false): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!body?.image_url) throw new ApiError('image_url is required', 400);
    const model = fast ? 'fal-ai/veo3.1/fast/image-to-video' : 'fal-ai/veo3.1/image-to-video';
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
    await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id, generate_audio: body.generate_audio ?? true } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  async veo31ReferenceToVideoSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!Array.isArray(body?.image_urls) || body.image_urls.length === 0) throw new ApiError('image_urls is required and must contain at least one URL', 400);
    const model = 'fal-ai/veo3.1/reference-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        image_urls: body.image_urls,
        duration: body.duration ?? '8s',
        resolution: body.resolution ?? '720p',
        generate_audio: body.generate_audio ?? true,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id, generate_audio: body.generate_audio ?? true } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  async veo31FirstLastFastSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!body?.start_image_url) throw new ApiError('start_image_url is required', 400);
    if (!body?.last_frame_image_url) throw new ApiError('last_frame_image_url is required', 400);
    const model = 'fal-ai/veo3.1/fast/image-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        image_url: body.start_image_url,
        last_frame_image_url: body.last_frame_image_url,
        aspect_ratio: body.aspect_ratio ?? 'auto',
        duration: body.duration ?? '8s',
        generate_audio: body.generate_audio ?? true,
        resolution: body.resolution ?? '720p',
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id, generate_audio: body.generate_audio ?? true } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  async veo31FirstLastSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    const firstUrl = body.first_frame_url || body.start_image_url;
    const lastUrl = body.last_frame_url || body.last_frame_image_url;
    if (!firstUrl) throw new ApiError('first_frame_url is required', 400);
    if (!lastUrl) throw new ApiError('last_frame_url is required', 400);
    const model = 'fal-ai/veo3.1/first-last-frame-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        first_frame_url: firstUrl,
        last_frame_url: lastUrl,
        aspect_ratio: body.aspect_ratio ?? 'auto',
        duration: body.duration ?? '8s',
        generate_audio: body.generate_audio ?? true,
        resolution: body.resolution ?? '720p',
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id, generate_audio: body.generate_audio ?? true } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // Sora 2 - Image to Video (standard)
  async sora2I2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!body?.image_url) throw new ApiError('image_url is required', 400);
    const model = 'fal-ai/sora-2/image-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        api_key: body.api_key,
        prompt: body.prompt,
        image_url: body.image_url,
        resolution: body.resolution ?? 'auto',
        aspect_ratio: body.aspect_ratio ?? 'auto',
        duration: body.duration ?? 8,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      // persist params for final debit mapping
      duration: body.duration ?? 8,
      resolution: body.resolution ?? 'auto',
      aspect_ratio: body.aspect_ratio ?? 'auto',
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // Sora 2 - Image to Video (Pro)
  async sora2ProI2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!body?.image_url) throw new ApiError('image_url is required', 400);
    const model = 'fal-ai/sora-2/image-to-video/pro';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        api_key: body.api_key,
        prompt: body.prompt,
        image_url: body.image_url,
        resolution: body.resolution ?? 'auto',
        aspect_ratio: body.aspect_ratio ?? 'auto',
        duration: body.duration ?? 8,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      duration: body.duration ?? 8,
      resolution: body.resolution ?? 'auto',
      aspect_ratio: body.aspect_ratio ?? 'auto',
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // Sora 2 - Video to Video Remix
  async sora2RemixV2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    let videoId = body.video_id as string | undefined;
    // If caller passed a source history id, load its stored soraVideoId
    if (!videoId && body?.source_history_id) {
      const src = await generationHistoryRepository.get(uid, String(body.source_history_id));
      const stored = (src as any)?.soraVideoId || (Array.isArray((src as any)?.videos) && (src as any)?.videos[0]?.soraVideoId);
      if (stored) videoId = stored;
    }
    if (!videoId) throw new ApiError('video_id or source_history_id (with stored soraVideoId) is required', 400);
    const model = 'fal-ai/sora-2/video-to-video/remix';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    // Persist source meta used for final debit mapping if available
    if (body?.source_history_id) {
      try {
        const src = await generationHistoryRepository.get(uid, String(body.source_history_id));
        if (src) {
          const source_duration = (src as any)?.duration ?? undefined;
          const source_resolution = (src as any)?.resolution ?? undefined;
          const source_is_pro = String((src as any)?.model || '').toLowerCase().includes('/pro') || String(source_resolution || '').toLowerCase() === '1080p';
          await generationHistoryRepository.update(uid, historyId, { source_history_id: String(body.source_history_id), source_duration, source_resolution, source_is_pro: String(!!source_is_pro) } as any);
        }
      } catch {}
    }
    const { request_id } = await fal.queue.submit(model, {
      input: {
        api_key: body.api_key,
        video_id: videoId,
        prompt: body.prompt,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // Sora 2 - Text to Video (Standard)
  async sora2T2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    const model = 'fal-ai/sora-2/text-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        api_key: body.api_key,
        prompt: body.prompt,
        resolution: body.resolution ?? '720p',
        aspect_ratio: body.aspect_ratio ?? '16:9',
        duration: body.duration ?? 8,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      duration: body.duration ?? 8,
      resolution: body.resolution ?? '720p',
      aspect_ratio: body.aspect_ratio ?? '16:9',
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // Sora 2 - Text to Video (Pro)
  async sora2ProT2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    const model = 'fal-ai/sora-2/text-to-video/pro';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        api_key: body.api_key,
        prompt: body.prompt,
        resolution: body.resolution ?? '1080p',
        aspect_ratio: body.aspect_ratio ?? '16:9',
        duration: body.duration ?? 8,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      duration: body.duration ?? 8,
      resolution: body.resolution ?? '1080p',
      aspect_ratio: body.aspect_ratio ?? '16:9',
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // LTX V2 - Image to Video (shared)
  async ltx2I2vSubmit(uid: string, body: any, fast = false): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!body?.image_url) throw new ApiError('image_url is required', 400);
    const model = fast ? 'fal-ai/ltxv-2/image-to-video/fast' : 'fal-ai/ltxv-2/image-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        image_url: body.image_url,
        resolution: body.resolution ?? '1080p',
        aspect_ratio: body.aspect_ratio ?? 'auto',
        duration: body.duration ?? 8, // seconds
        fps: body.fps ?? 25,
        generate_audio: body.generate_audio ?? true,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      duration: body.duration ?? 8,
      resolution: body.resolution ?? '1080p',
      aspect_ratio: body.aspect_ratio ?? 'auto',
      fps: body.fps ?? 25,
      generate_audio: body.generate_audio ?? true,
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // LTX V2 - Image to Video wrappers
  async ltx2ProI2vSubmit(uid: string, body: any): Promise<SubmitReturn> { return this.ltx2I2vSubmit(uid, body, false); },
  async ltx2FastI2vSubmit(uid: string, body: any): Promise<SubmitReturn> { return this.ltx2I2vSubmit(uid, body, true); },
  // LTX V2 - Text to Video (shared)
  async ltx2T2vSubmit(uid: string, body: any, fast = false): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    const model = fast ? 'fal-ai/ltxv-2/text-to-video/fast' : 'fal-ai/ltxv-2/text-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        duration: body.duration ?? 8,
        resolution: body.resolution ?? '1080p',
        aspect_ratio: body.aspect_ratio ?? '16:9',
        fps: body.fps ?? 25,
        generate_audio: body.generate_audio ?? true,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      duration: body.duration ?? 8,
      resolution: body.resolution ?? '1080p',
      aspect_ratio: body.aspect_ratio ?? '16:9',
      fps: body.fps ?? 25,
      generate_audio: body.generate_audio ?? true,
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // LTX V2 - Text to Video wrappers
  async ltx2ProT2vSubmit(uid: string, body: any): Promise<SubmitReturn> { return this.ltx2T2vSubmit(uid, body, false); },
  async ltx2FastT2vSubmit(uid: string, body: any): Promise<SubmitReturn> { return this.ltx2T2vSubmit(uid, body, true); },
  queueStatus,
  queueResult,
};

