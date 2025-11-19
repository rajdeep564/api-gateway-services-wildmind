import { ApiError } from "../utils/errorHandler";
import {
  RunwayTextToImageRequest,
  RunwayTextToImageResponse,
} from "../types/runway";
import { runwayRepository } from "../repository/runwayRepository";
import { env } from "../config/env";
import { generationHistoryRepository } from "../repository/generationHistoryRepository";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import { authRepository } from "../repository/auth/authRepository";
import { uploadFromUrlToZata, uploadDataUriToZata } from "../utils/storage/zataUpload";
import { creditsRepository } from "../repository/creditsRepository";
import { computeRunwayCostFromHistoryModel } from "../utils/pricing/runwayPricing";
import { syncToMirror } from "../utils/mirrorHelper";
import { aestheticScoreService } from "./aestheticScoreService";
import { markGenerationCompleted } from "./generationHistoryService";
//

// (SDK handles base/version internally)

let RunwayMLCtor: any | null = null;
function getRunwayClient(): any {
  const apiKey = env.runwayApiKey as string;
  if (!apiKey) throw new ApiError("Runway API key not configured", 500);
  if (!RunwayMLCtor) {
    try {
      // Defer module resolution to runtime so missing SDK doesn't crash boot
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("@runwayml/sdk");
      RunwayMLCtor = mod?.default || mod;
    } catch (_e) {
      throw new ApiError("Runway SDK not installed on server", 500);
    }
  }
  return new RunwayMLCtor({ apiKey });
}

async function textToImage(
  uid: string,
  payload: RunwayTextToImageRequest
): Promise<RunwayTextToImageResponse & { historyId?: string }> {
  const { promptText, ratio, model, seed, uploadedImages, contentModeration } =
    payload;
  if (!promptText || !ratio || !model)
    throw new ApiError(
      "Missing required fields: promptText, ratio, model",
      400
    );
  if (!["gen4_image", "gen4_image_turbo"].includes(model))
    throw new ApiError("Invalid model", 400);
  if (
    model === "gen4_image_turbo" &&
    (!uploadedImages || uploadedImages.length === 0)
  ) {
    throw new ApiError(
      "gen4_image_turbo requires at least one reference image",
      400
    );
  }

  // Prefer SDK
  const client = getRunwayClient();
  // SDK expects referenceImages, not uploadedImages
  const referenceImages = (uploadedImages || []).map(
    (uri: string, i: number) => ({ uri, tag: `ref_${i + 1}` })
  );
  const created = await client.textToImage.create({
    model,
    promptText,
    ratio: ratio as any,
    ...(seed !== undefined ? { seed } : {}),
    ...(referenceImages.length > 0 ? { referenceImages } : {}),
    ...(contentModeration
      ? {
          contentModeration: {
            publicFigureThreshold: contentModeration.publicFigureThreshold as
              | "auto"
              | "low",
          },
        }
      : {}),
  });
  // Create authoritative history first
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: promptText,
    model,
    generationType: payload.generationType || 'text-to-image',
    visibility: (payload as any).visibility || 'private',
    tags: (payload as any).tags,
    nsfw: (payload as any).nsfw,
    isPublic: (payload as any).isPublic === true,
    createdBy,
  });
  try {
    await runwayRepository.createTaskRecord({
      mode: "text_to_image",
      model,
      ratio,
      promptText,
      seed,
      taskId: created.id,
      isPublic: (payload as any).isPublic === true,
      createdBy,
    });
  } catch {}
  // Store provider identifiers on history
  await generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id } as any);
  
  // Persist user uploaded input images (if any)
  if (uploadedImages && uploadedImages.length > 0) {
    try {
      const username = creator?.username || uid;
      const keyPrefix = `users/${username}/input/${historyId}`;
      const inputPersisted: any[] = [];
      let idx = 0;
      for (const src of uploadedImages) {
        if (!src || typeof src !== 'string') continue;
        try {
          const stored = /^data:/i.test(src)
            ? await uploadDataUriToZata({ dataUri: src, keyPrefix, fileName: `input-${++idx}` })
            : await uploadFromUrlToZata({ sourceUrl: src, keyPrefix, fileName: `input-${++idx}` });
          inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: src });
        } catch {}
      }
      if (inputPersisted.length > 0) {
        await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
        console.log('[runwayService.textToImage] Saved inputImages to database', { historyId, count: inputPersisted.length });
      }
    } catch (e) {
      console.warn('[runwayService.textToImage] Failed to save inputImages:', e);
    }
  }
  
  return { taskId: created.id, status: "pending", historyId };
}

async function getStatus(uid: string, id: string): Promise<any> {
  if (!id) throw new ApiError("Task ID is required", 400);
  const client = getRunwayClient();
  try {
    const task = await client.tasks.retrieve(id);
    // Optionally persist status progression
    try {
      await runwayRepository.updateTaskRecord(id, {
        status: task.status as any,
        outputs: Array.isArray((task as any).output)
          ? (task as any).output
          : undefined,
      });
    } catch {}
    // When completed, attach outputs into history and mirror
    if (task.status === 'SUCCEEDED') {
      // Find history by providerTaskId (requires uid-scoped search)
      const found = await generationHistoryRepository.findByProviderTaskId(uid, 'runway', id);
      if (found) {
        const outputs = (task as any).output || [];
        const creator = await authRepository.getUserById(uid);
        const username = creator?.username || uid;
        // Upload each output to Zata (assume images for text_to_image; videos for others)
        const isImage = (task as any)?.type === 'text_to_image' || (found.item?.generationType === 'text-to-image');
        if (isImage) {
          const storedImages = await Promise.all((outputs as any[]).map(async (u: string, i: number) => {
            try {
              const { key, publicUrl } = await uploadFromUrlToZata({
                sourceUrl: u,
                keyPrefix: `users/${username}/image/${found.id}`,
                fileName: `image-${i + 1}`,
              });
              return { id: `${id}-${i}`, url: publicUrl, storagePath: key, originalUrl: u };
            } catch {
              return { id: `${id}-${i}`, url: u, originalUrl: u } as any;
            }
          }));

          // Score the images
          const scoredImages = await aestheticScoreService.scoreImages(storedImages);
          const highestScore = aestheticScoreService.getHighestScore(scoredImages);

          await generationHistoryRepository.update(uid, found.id, { status: 'completed', images: scoredImages, aestheticScore: highestScore } as any);
          try { console.log('[Runway] History updated with scores', { historyId: found.id, imageCount: scoredImages.length, highestScore }); } catch {}
          
          // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
          markGenerationCompleted(uid, found.id, {
            status: "completed",
            images: scoredImages,
          }).catch(err => console.error('[Runway] Image optimization failed:', err));
          
          try {
            const { cost, pricingVersion, meta } = computeRunwayCostFromHistoryModel(found.item.model);
            await creditsRepository.writeDebitIfAbsent(uid, found.id, cost, 'runway.generate', { ...meta, historyId: found.id, provider: 'runway', pricingVersion });
          } catch {}
        } else {
          const storedVideos = await Promise.all((outputs as any[]).map(async (u: string, i: number) => {
            try {
              const { key, publicUrl } = await uploadFromUrlToZata({
                sourceUrl: u,
                keyPrefix: `users/${username}/video/${found.id}`,
                fileName: `video-${i + 1}`,
              });
              return { id: `${id}-${i}`, url: publicUrl, storagePath: key, originalUrl: u };
            } catch {
              return { id: `${id}-${i}`, url: u, originalUrl: u } as any;
            }
          }));

          // Score the videos
          const scoredVideos = await aestheticScoreService.scoreVideos(storedVideos);
          const highestScore = aestheticScoreService.getHighestScore(scoredVideos);

          await generationHistoryRepository.update(uid, found.id, { status: 'completed', videos: scoredVideos, aestheticScore: highestScore } as any);
          try { console.log('[Runway] Video history updated with scores', { historyId: found.id, videoCount: scoredVideos.length, highestScore }); } catch {}
          try {
            const { cost, pricingVersion, meta } = computeRunwayCostFromHistoryModel(found.item.model);
            await creditsRepository.writeDebitIfAbsent(uid, found.id, cost, 'runway.video', { ...meta, historyId: found.id, provider: 'runway', pricingVersion });
          } catch {}
        }
        // Robust mirror sync with retry logic
        await syncToMirror(uid, found.id);
      }
    }
    return task;
  } catch (e: any) {
    if (e?.status === 404)
      throw new ApiError("Task not found or was deleted/canceled", 404);
    throw new ApiError("Runway API request failed", 500, e);
  }
}

async function videoGenerate(
  uid: string,
  body: any
): Promise<{
  success: boolean;
  taskId: string;
  mode: string;
  endpoint: string;
  historyId?: string;
}> {
  const client = getRunwayClient();
  const { mode, imageToVideo, videoToVideo, textToVideo, videoUpscale } =
    body || {};
  if (mode === "image_to_video") {
    const created = await client.imageToVideo.create(imageToVideo);
    const prompt = imageToVideo?.promptText || (imageToVideo && imageToVideo.prompts && imageToVideo.prompts[0]?.text) || '';
    const historyModel = imageToVideo?.model || body?.model || 'runway_video';
    const generationType = body?.generationType || 'image-to-video';
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt,
      model: historyModel,
      generationType,
      visibility: (body as any)?.visibility || (((body as any)?.isPublic === true) ? 'public' : 'private'),
      tags: (body as any)?.tags,
      nsfw: (body as any)?.nsfw,
      isPublic: (body as any)?.isPublic === true,
      ...(imageToVideo?.duration !== undefined ? { duration: imageToVideo.duration } : {}),
      ...(imageToVideo?.ratio !== undefined ? { ratio: imageToVideo.ratio } : {}),
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id } as any);

    // Persist input images
    try {
      const creator = await authRepository.getUserById(uid);
      const username = (creator?.username || uid) as string;
      const keyPrefix = `users/${username}/input/${historyId}`;
      const srcs: string[] = [];
      if (imageToVideo && (imageToVideo as any).promptImage) {
        const p = (imageToVideo as any).promptImage;
        if (typeof p === 'string') srcs.push(p);
        else if (Array.isArray(p)) {
          for (const obj of p) {
            if (obj && typeof obj.uri === 'string') srcs.push(obj.uri);
          }
        }
      }
      const imgs: any[] = [];
      let i = 0;
      for (const src of srcs) {
        try {
          const stored = /^data:/i.test(src)
            ? await uploadDataUriToZata({ dataUri: src, keyPrefix, fileName: `input-${++i}` })
            : await uploadFromUrlToZata({ sourceUrl: src, keyPrefix, fileName: `input-${++i}` });
          imgs.push({ id: `${created.id}-in-${i}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: src });
        } catch {}
      }
      if (imgs.length > 0) await generationHistoryRepository.update(uid, historyId, { inputImages: imgs } as any);
    } catch {}

    return {
      success: true,
      taskId: created.id,
      mode,
      endpoint: "/v1/image_to_video",
      historyId,
    };
  }
  if (mode === "text_to_video") {
    const created = await client.textToVideo.create(textToVideo);
    const prompt = textToVideo?.promptText || '';
    const historyModel = textToVideo?.model || body?.model || 'runway_video';
    const generationType = body?.generationType || 'text-to-video';
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt,
      model: historyModel,
      generationType,
      visibility: (body as any)?.visibility || (((body as any)?.isPublic === true) ? 'public' : 'private'),
      tags: (body as any)?.tags,
      nsfw: (body as any)?.nsfw,
      isPublic: (body as any)?.isPublic === true,
      ...(textToVideo?.duration !== undefined ? { duration: textToVideo.duration } : {}),
      ...(textToVideo?.ratio !== undefined ? { ratio: textToVideo.ratio } : {}),
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id } as any);
    return {
      success: true,
      taskId: created.id,
      mode,
      endpoint: "/v1/text_to_video",
      historyId,
    };
  }
  if (mode === "video_to_video") {
    const created = await client.videoToVideo.create(videoToVideo);
    const prompt = videoToVideo?.promptText || (videoToVideo && videoToVideo.prompts && videoToVideo.prompts[0]?.text) || '';
    const historyModel = videoToVideo?.model || body?.model || 'runway_video';
    const generationType = body?.generationType || 'video-to-video';
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt,
      model: historyModel,
      generationType,
      visibility: (body as any)?.visibility || (((body as any)?.isPublic === true) ? 'public' : 'private'),
      tags: (body as any)?.tags,
      nsfw: (body as any)?.nsfw,
      isPublic: (body as any)?.isPublic === true,
      ...(videoToVideo?.duration !== undefined ? { duration: videoToVideo.duration } : {}),
      ...(videoToVideo?.ratio !== undefined ? { ratio: videoToVideo.ratio } : {}),
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id } as any);

    // Persist input video and references
    try {
      const creator = await authRepository.getUserById(uid);
      const username = (creator?.username || uid) as string;
      const base = `users/${username}/input/${historyId}`;
      const videos: any[] = [];
      const refs: any[] = [];
      if (videoToVideo && (videoToVideo as any).videoUri) {
        const v = (videoToVideo as any).videoUri;
        try {
          const stored = /^data:/i.test(v)
            ? await uploadDataUriToZata({ dataUri: v, keyPrefix: base, fileName: 'input-video-1' })
            : await uploadFromUrlToZata({ sourceUrl: v, keyPrefix: base, fileName: 'input-video-1' });
          videos.push({ id: `${created.id}-vin-1`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: v });
        } catch {}
      }
      if (videoToVideo && Array.isArray((videoToVideo as any).references)) {
        let i = 0;
        for (const r of (videoToVideo as any).references) {
          const uri = r?.uri;
          if (!uri || typeof uri !== 'string') continue;
          try {
            const stored = /^data:/i.test(uri)
              ? await uploadDataUriToZata({ dataUri: uri, keyPrefix: base, fileName: `input-ref-${++i}` })
              : await uploadFromUrlToZata({ sourceUrl: uri, keyPrefix: base, fileName: `input-ref-${++i}` });
            refs.push({ id: `${created.id}-iin-${i}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: uri });
          } catch {}
        }
      }
      const updates: any = {};
      if (videos.length > 0) updates.inputVideos = videos;
      if (refs.length > 0) updates.inputImages = refs;
      if (Object.keys(updates).length > 0) await generationHistoryRepository.update(uid, historyId, updates);
    } catch {}

    return {
      success: true,
      taskId: created.id,
      mode,
      endpoint: "/v1/video_to_video",
      historyId,
    };
  }
  if (mode === "video_upscale") {
    const created = await client.videoUpscale.create(videoUpscale);
    const prompt = '';
    const historyModel = videoUpscale?.model || body?.model || 'runway_video_upscale';
    const generationType = body?.generationType || 'text-to-video';
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt,
      model: historyModel,
      generationType,
      visibility: (body as any)?.visibility || (((body as any)?.isPublic === true) ? 'public' : 'private'),
      tags: (body as any)?.tags,
      nsfw: (body as any)?.nsfw,
      isPublic: (body as any)?.isPublic === true,
      ...(videoUpscale?.duration !== undefined ? { duration: videoUpscale.duration } : {}),
      ...(videoUpscale?.ratio !== undefined ? { ratio: videoUpscale.ratio } : {}),
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id } as any);
    return {
      success: true,
      taskId: created.id,
      mode,
      endpoint: "/v1/video_upscale",
      historyId,
    };
  }
  throw new ApiError(
    "Invalid mode. Must be one of image_to_video, text_to_video, video_to_video, video_upscale",
    400
  );
}

async function characterPerformance(
  uid: string,
  body: any
): Promise<{
  success: boolean;
  taskId: string;
  historyId?: string;
}> {
  const client = getRunwayClient();
  const { model, character, reference, ratio, seed, bodyControl, expressionIntensity, contentModeration } = body || {};
  
  if (model !== 'act_two') {
    throw new ApiError("Model must be 'act_two' for Runway Act-Two", 400);
  }
  
  if (!character || !character.type || !character.uri) {
    throw new ApiError("Character is required with type and uri", 400);
  }
  
  if (!reference || !reference.type || reference.type !== 'video' || !reference.uri) {
    throw new ApiError("Reference video is required with type 'video' and uri", 400);
  }
  
  // Build the request payload
  const payload: any = {
    model: 'act_two',
    character: {
      type: character.type,
      uri: character.uri,
    },
    reference: {
      type: 'video',
      uri: reference.uri,
    },
    ratio: ratio || '1280:720',
  };
  
  if (seed !== undefined) payload.seed = seed;
  if (bodyControl !== undefined) payload.bodyControl = bodyControl;
  if (expressionIntensity !== undefined) payload.expressionIntensity = expressionIntensity;
  if (contentModeration) {
    payload.contentModeration = {
      publicFigureThreshold: contentModeration.publicFigureThreshold || 'auto',
    };
  }
  
  console.log('[Runway Act-Two] Calling SDK with payload:', JSON.stringify(payload, null, 2));
  console.log('[Runway Act-Two] Client methods available:', Object.keys(client || {}));
  console.log('[Runway Act-Two] Client.characterPerformance exists:', !!client.characterPerformance);
  
  let created;
  try {
    // Check if characterPerformance method exists on the client
    if (!client.characterPerformance) {
      console.error('[Runway Act-Two] characterPerformance method not found on client. Available methods:', Object.keys(client));
      // Try using tasks.create as fallback if characterPerformance doesn't exist
      if (client.tasks && typeof client.tasks.create === 'function') {
        console.log('[Runway Act-Two] Attempting to use tasks.create as fallback');
        created = await client.tasks.create({
          type: 'character_performance',
          ...payload
        });
      } else {
        throw new ApiError("Runway SDK does not support characterPerformance. Please update @runwayml/sdk to the latest version that supports Act-Two API (act_two model).", 500);
      }
    } else if (typeof client.characterPerformance.create !== 'function') {
      throw new ApiError("Runway SDK characterPerformance.create is not a function. Please update @runwayml/sdk to the latest version.", 500);
    } else {
      created = await client.characterPerformance.create(payload);
    }
    
    console.log('[Runway Act-Two] SDK response:', JSON.stringify(created, null, 2));
    console.log('[Runway Act-Two] Response type:', typeof created);
    console.log('[Runway Act-Two] Response has id:', !!created?.id);
    
    // Check if the response is just the payload (error case)
    if (created && JSON.stringify(created) === JSON.stringify(payload)) {
      throw new ApiError("Runway SDK returned the payload unchanged. This usually means the method doesn't exist or the SDK version doesn't support Act-Two. Please update @runwayml/sdk.", 500);
    }
    
    if (!created || !created.id) {
      console.error('[Runway Act-Two] Invalid response - missing task ID. Response:', created);
      throw new ApiError(`Invalid response from Runway SDK: missing task ID. Response: ${JSON.stringify(created)}`, 500);
    }
  } catch (error: any) {
    console.error('[Runway Act-Two] SDK error details:', {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
      status: error?.status,
      response: error?.response
    });
    if (error instanceof ApiError) {
      throw error;
    }
    // Check if it's a method not found error
    if (error?.message?.includes('characterPerformance') || 
        error?.message?.includes('not a function') ||
        error?.code === 'ERR_METHOD_NOT_FOUND' ||
        error?.name === 'TypeError') {
      throw new ApiError(`Runway SDK method 'characterPerformance' not found or not supported. Error: ${error?.message}. Please ensure @runwayml/sdk is updated to the latest version that supports Act-Two API (act_two model).`, 500);
    }
    // Check for API errors
    if (error?.status || error?.response) {
      const status = error.status || error.response?.status;
      const message = error.response?.data?.message || error.message || 'Unknown error';
      throw new ApiError(`Runway Act-Two API error (${status}): ${message}`, status || 500, error);
    }
    throw new ApiError(`Runway Act-Two API error: ${error?.message || 'Unknown error'}`, 500, error);
  }
  
  const prompt = body?.promptText || 'Act-Two generation';
  const historyModel = body?.model || 'runway_act_two';
  const generationType = body?.generationType || 'video-to-video';
  
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt,
    model: historyModel,
    generationType,
    visibility: (body as any)?.visibility || (((body as any)?.isPublic === true) ? 'public' : 'private'),
    tags: (body as any)?.tags,
    nsfw: (body as any)?.nsfw,
    isPublic: (body as any)?.isPublic === true,
    ...(ratio ? { ratio } : {}),
  } as any);
  
  await generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id } as any);
  
  // Persist input character and reference
  try {
    const creator = await authRepository.getUserById(uid);
    const username = (creator?.username || uid) as string;
    const base = `users/${username}/input/${historyId}`;
    const updates: any = {};
    
    // Store character (image or video)
    if (character && character.uri) {
      try {
        const stored = /^data:/i.test(character.uri)
          ? (character.type === 'image' 
              ? await uploadDataUriToZata({ dataUri: character.uri, keyPrefix: base, fileName: 'character-1' })
              : await uploadDataUriToZata({ dataUri: character.uri, keyPrefix: base, fileName: 'character-video-1' }))
          : await uploadFromUrlToZata({ sourceUrl: character.uri, keyPrefix: base, fileName: character.type === 'image' ? 'character-1' : 'character-video-1' });
        
        if (character.type === 'image') {
          updates.inputImages = [{ id: `${created.id}-char-1`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: character.uri }];
        } else {
          updates.inputVideos = [{ id: `${created.id}-char-video-1`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: character.uri }];
        }
      } catch {}
    }
    
    // Store reference video
    if (reference && reference.uri) {
      try {
        const stored = /^data:/i.test(reference.uri)
          ? await uploadDataUriToZata({ dataUri: reference.uri, keyPrefix: base, fileName: 'reference-video-1' })
          : await uploadFromUrlToZata({ sourceUrl: reference.uri, keyPrefix: base, fileName: 'reference-video-1' });
        
        if (!updates.inputVideos) updates.inputVideos = [];
        updates.inputVideos.push({ id: `${created.id}-ref-video-1`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: reference.uri });
      } catch {}
    }
    
    if (Object.keys(updates).length > 0) {
      await generationHistoryRepository.update(uid, historyId, updates);
    }
  } catch {}
  
  return {
    success: true,
    taskId: created.id,
    historyId,
  };
}

export const runwayService = {
  textToImage,
  getStatus,
  videoGenerate,
  characterPerformance,
};
