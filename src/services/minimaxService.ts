import axios from "axios";
import { env } from "../config/env";
import {
  MinimaxGenerateRequest,
  MinimaxGenerateResponse,
  MinimaxGeneratedImage,
} from "../types/minimax";
import {
  MinimaxMusicRequest,
  MinimaxMusicResponse,
} from "../types/minimaxMusic";
import { ApiError } from "../utils/errorHandler";
import { minimaxRepository } from "../repository/minimaxRepository";
import { generationHistoryRepository } from "../repository/generationHistoryRepository";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import { authRepository } from "../repository/auth/authRepository";
import { GenerationHistoryItem } from "../types/generate";
import { uploadFromUrlToZata, uploadBufferToZata } from "../utils/storage/zataUpload";
import { creditsRepository } from "../repository/creditsRepository";
import { computeMinimaxVideoCostFromParams } from "../utils/pricing/minimaxPricing";
import { syncToMirror, updateMirror } from "../utils/mirrorHelper";
import { aestheticScoreService } from "./aestheticScoreService";
import { markGenerationCompleted } from "./generationHistoryService";

const MINIMAX_API_BASE = "https://api.minimax.io/v1";
const MINIMAX_MODEL = "image-01";

function mapMiniMaxCodeToHttp(statusCode: number): number {
  switch (statusCode) {
    case 0:
      return 200;
    case 1002:
      return 429; // rate limit triggered
    case 1004:
      return 401; // authentication failed
    case 1008:
      return 402; // insufficient balance
    case 1026:
      return 400; // sensitive input content
    case 1027:
      return 400; // sensitive output content
    case 2013:
      return 400; // invalid/abnormal params
    case 2049:
      return 401; // invalid API key
    case 1000:
    case 1013:
    case 1039:
      return 500; // unknown/internal/TPM
    default:
      return 400;
  }
}

function assertMiniMaxOk(baseResp?: {
  status_code?: number;
  status_msg?: string;
}) {
  if (!baseResp) return;
  const code = Number(baseResp.status_code);
  if (!isNaN(code) && code !== 0) {
    const http = mapMiniMaxCodeToHttp(code);
    throw new ApiError(
      baseResp.status_msg || `MiniMax error ${code}`,
      http,
      baseResp
    );
  }
}

async function generate(
  uid: string,
  payload: MinimaxGenerateRequest
): Promise<MinimaxGenerateResponse & { historyId?: string }> {
  const {
    prompt,
    aspect_ratio,
    width,
    height,
    response_format = "url",
    seed,
    n = 1,
    prompt_optimizer = false,
    subject_reference,
    style,
    generationType,
  } = payload;

  if (!prompt)
    throw new ApiError("Missing required field: prompt is required", 400);
  if (prompt.length > 1500)
    throw new ApiError("Prompt exceeds 1500 characters limit", 400);
  if (n < 1 || n > 9) throw new ApiError("n must be between 1 and 9", 400);

  const apiKey = env.minimaxApiKey as string;
  if (!apiKey) throw new ApiError("MiniMax API key not configured", 500);

  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };

  // Debug log incoming payload flags (visibility/isPublic) to help trace public generation flow
  console.log('[MiniMax] generate() payload flags:', { uid, isPublic: (payload as any).isPublic, visibility: (payload as any).visibility, generationType: payload.generationType });

  const legacyId = await minimaxRepository.createGenerationRecord(
    { ...payload, isPublic: (payload as any).isPublic === true },
    createdBy
  );
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt,
    model: MINIMAX_MODEL,
    generationType: payload.generationType || 'text-to-image',
    visibility: (payload as any).visibility || 'private',
    tags: (payload as any).tags,
    nsfw: (payload as any).nsfw,
    isPublic: (payload as any).isPublic === true,
    createdBy,
  });

  // Persist subject_reference (if provided) as inputImages
  try {
    const keyPrefix = `users/${creator?.username || uid}/input/${historyId}`;
    const inputPersisted: any[] = [];
    let idx = 0;
    if (Array.isArray(subject_reference)) {
      for (const ref of subject_reference as any[]) {
        const file = ref?.image_file || (Array.isArray(ref?.image) ? ref.image[0] : undefined);
        if (!file || typeof file !== 'string') continue;
        try {
          if (/^data:/i.test(file)) {
            // Inline data URIs need to be converted to Buffer; uploadBufferToZata requires content-type
            const match = /^data:([^;]+);base64,(.*)$/.exec(file);
            if (match) {
              const contentType = match[1];
              const base64 = match[2];
              const buffer = Buffer.from(base64, 'base64');
              const name = `input-${++idx}.${contentType.includes('png') ? 'png' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'bin'}`;
              const { key, publicUrl } = await uploadBufferToZata(`${keyPrefix}/${name}`, buffer, contentType);
              inputPersisted.push({ id: `in-${idx}`, url: publicUrl, storagePath: key, originalUrl: file });
            }
          } else {
            const stored = await uploadFromUrlToZata({ sourceUrl: file, keyPrefix, fileName: `input-${++idx}` });
            inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: stored.key, originalUrl: file });
          }
        } catch {}
      }
    }
    if (inputPersisted.length > 0) await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
  } catch {}

  const requestPayload: any = {
    model: MINIMAX_MODEL,
    prompt,
    response_format,
    n,
    prompt_optimizer,
  };

  if (aspect_ratio) requestPayload.aspect_ratio = aspect_ratio;
  if (width !== undefined && height !== undefined) {
    requestPayload.width = width;
    requestPayload.height = height;
  }
  if (seed !== undefined) requestPayload.seed = seed;
  if (subject_reference) requestPayload.subject_reference = subject_reference;

  try {
    const response = await axios.post(
      `${MINIMAX_API_BASE}/image_generation`,
      requestPayload,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        validateStatus: () => true,
      }
    );

    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(
        "MiniMax API request failed",
        response.status,
        response.data
      );
    }

    const data = response.data;
    assertMiniMaxOk(data.base_resp);
    if (!data.data)
      throw new ApiError("MiniMax API response missing data field", 400, data);

    let imageUrls: string[] = [];
    if (Array.isArray(data.data.image_urls)) imageUrls = data.data.image_urls;
    else if (Array.isArray(data.data.images)) imageUrls = data.data.images;
    else if (Array.isArray(data.data.urls)) imageUrls = data.data.urls;
    else if (Array.isArray(data.data)) imageUrls = data.data;
    if (imageUrls.length === 0)
      throw new ApiError(
        "No image URLs returned from MiniMax API",
        400,
        data.data
      );

    const images: MinimaxGeneratedImage[] = imageUrls.map(
      (url: string, index: number) => ({
        id: `${data.id || Date.now()}-${index}`,
        url,
        originalUrl: url,
      })
    );

    // Upload to Zata and preserve originalUrl
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
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.warn('[MiniMax] Zata upload failed, using provider URL:', e?.message || e);
          return { id: img.id, url: img.url, originalUrl: img.originalUrl || img.url } as any;
        }
      })
    );

      // Log what was stored (useful to ensure storagePath/publicUrl exist and will be optimized)
      try { console.log('[MiniMax] storedImages:', storedImages.map(s => ({ id: s.id, url: s.url, storagePath: (s as any).storagePath }))); } catch {}

    // Score the images for aesthetic quality
    const scoredImages = await aestheticScoreService.scoreImages(storedImages);
    const highestScore = aestheticScoreService.getHighestScore(scoredImages);

    await minimaxRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      images: scoredImages as any,
    });
    await generationHistoryRepository.update(uid, historyId, {
      status: 'completed',
      images: scoredImages,
      aestheticScore: highestScore,
      provider: 'minimax',
    } as Partial<GenerationHistoryItem>);
    try { console.log('[MiniMax] History updated with scores', { historyId, imageCount: scoredImages.length, highestScore }); } catch {}
    
    // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
    console.log('[MiniMax] Triggering markGenerationCompleted for optimization and mirror sync', { uid, historyId, isPublic: (payload as any).isPublic });
    markGenerationCompleted(uid, historyId, {
      status: "completed",
      images: scoredImages,
      isPublic: (payload as any).isPublic === true,
    }).catch(err => console.error('[MiniMax] Image optimization failed:', err));
    
    // Robust mirror sync with retry logic
    await syncToMirror(uid, historyId);
    return { images: scoredImages, aestheticScore: highestScore, historyId, id: data.id } as any;
  } catch (err: any) {
    const message = err?.message || "Failed to generate images with MiniMax";
    await minimaxRepository.updateGenerationRecord(legacyId, {
      status: "failed",
      error: message,
    });
    // Update history and mirror with error state
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
    await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
    throw err;
  }
}

// Video
async function generateVideo(
  apiKey: string,
  _groupId: string,
  body: any
): Promise<{ taskId: string }> {
  if (!apiKey) throw new ApiError("MiniMax API not configured", 500);
  // The video_generation POST does not require GroupId; only file retrieval does
  const res = await axios.post(`${MINIMAX_API_BASE}/video_generation`, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300)
    throw new ApiError("MiniMax video request failed", res.status, res.data);
  const data = res.data || {};
  assertMiniMaxOk(data.base_resp);
  const taskId = data?.result?.task_id || data?.task_id || data?.id;
  if (!taskId)
    throw new ApiError("MiniMax service returned undefined taskId", 502, data);
  return { taskId };
}

async function getVideoStatus(apiKey: string, taskId: string): Promise<any> {
  const res = await axios.get(
    `${MINIMAX_API_BASE}/query/video_generation?task_id=${taskId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      validateStatus: () => true,
    }
  );
  if (res.status < 200 || res.status >= 300)
    throw new ApiError(
      `MiniMax API error: ${res.status}`,
      res.status,
      res.data
    );
  const data = res.data || {};
  // Some responses embed base_resp at root
  assertMiniMaxOk(data.base_resp || (data.result && data.result.base_resp));
  return data;
}

async function getFile(
  apiKey: string,
  groupId: string,
  fileId: string
): Promise<any> {
  const res = await axios.get(
    `${MINIMAX_API_BASE}/files/retrieve?GroupId=${groupId}&file_id=${fileId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      validateStatus: () => true,
    }
  );
  if (res.status < 200 || res.status >= 300)
    throw new ApiError(
      `MiniMax API error: ${res.status}`,
      res.status,
      res.data
    );
  const data = res.data || {};
  // Surface group mismatch case clearly
  if (
    data.base_resp &&
    Number(data.base_resp.status_code) === 1004 &&
    /token not match group/i.test(String(data.base_resp.status_msg))
  ) {
    throw new ApiError(
      "MiniMax 1004: token not match group. Ensure MINIMAX_GROUP_ID matches API key account group.",
      401,
      data.base_resp
    );
  }
  assertMiniMaxOk(data.base_resp);
  return data;
}

function extractDownloadUrl(data: any): string | undefined {
  if (!data) return undefined;
  const candidates = [
    data?.data?.url,
    data?.data?.download_url,
    data?.file?.url,
    data?.file?.download_url,
    data?.url,
    data?.download_url,
    data?.audio_url,
    data?.music_url,
  ];
  for (const c of candidates) if (typeof c === 'string' && /^https?:\/\//.test(c)) return c;
  try {
    const stack: any[] = [data];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object') continue;
      for (const v of Object.values(cur)) {
        if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
        if (v && typeof v === 'object') stack.push(v as any);
      }
    }
  } catch {}
  return undefined;
}

// Music
async function generateMusic(
  apiKey: string,
  body: MinimaxMusicRequest
): Promise<MinimaxMusicResponse> {
  if (!apiKey) throw new ApiError("MiniMax API not configured", 500);
  
  // Build request payload according to new API schema - only include allowed fields
  const requestPayload: any = {
    model: body.model || 'music-2.0',
    prompt: body.prompt,
    lyrics: body.lyrics,
  };
  
  // Only add optional fields if they exist
  if (body.output_format) {
    requestPayload.output_format = body.output_format;
  } else {
    requestPayload.output_format = 'hex'; // Default
  }
  
  if (body.stream !== undefined) {
    requestPayload.stream = body.stream;
  } else {
    requestPayload.stream = false; // Default
  }
  
  // Audio settings - only include if provided, ensure numbers are integers
  if (body.audio_setting) {
    requestPayload.audio_setting = {};
    if (body.audio_setting.sample_rate !== undefined) {
      requestPayload.audio_setting.sample_rate = parseInt(String(body.audio_setting.sample_rate), 10);
    } else {
      requestPayload.audio_setting.sample_rate = 44100; // Default
    }
    if (body.audio_setting.bitrate !== undefined) {
      requestPayload.audio_setting.bitrate = parseInt(String(body.audio_setting.bitrate), 10);
    } else {
      requestPayload.audio_setting.bitrate = 256000; // Default
    }
    if (body.audio_setting.format) {
      requestPayload.audio_setting.format = String(body.audio_setting.format);
    } else {
      requestPayload.audio_setting.format = 'mp3'; // Default
    }
  } else {
    // Default audio settings if not provided
    requestPayload.audio_setting = {
      sample_rate: 44100,
      bitrate: 256000,
      format: 'mp3',
    };
  }
  
  // Log the payload being sent (for debugging)
  console.log('[MiniMax] Music generation request payload:', JSON.stringify({
    ...requestPayload,
    prompt: requestPayload.prompt?.substring(0, 50) + '...',
    lyrics: requestPayload.lyrics?.substring(0, 50) + '...'
  }, null, 2));
  
  const res = await axios.post(`${MINIMAX_API_BASE}/music_generation`, requestPayload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  
  if (res.status < 200 || res.status >= 300) {
    console.error('[MiniMax] Music API error response:', JSON.stringify(res.data, null, 2));
    const errorMsg = res.data?.base_resp?.status_msg || res.data?.status_msg || `MiniMax music error: ${res.status}`;
    throw new ApiError(
      errorMsg,
      res.status,
      res.data
    );
  }
  
  const data = res.data;
  // Check base_resp before asserting
  if (data.base_resp && data.base_resp.status_code !== 0) {
    const errorMsg = data.base_resp.status_msg || `MiniMax API error: status_code ${data.base_resp.status_code}`;
    console.error('[MiniMax] Music API base_resp error:', JSON.stringify(data.base_resp, null, 2));
    throw new ApiError(
      errorMsg,
      mapMiniMaxCodeToHttp(data.base_resp.status_code),
      data
    );
  }
  
  return data as MinimaxMusicResponse;
}

// Post-processing helpers to store provider files into Zata and update history/mirror
async function processVideoFile(
  uid: string,
  fileId: string,
  historyId?: string,
): Promise<any> {
  const apiKey = env.minimaxApiKey as string;
  const groupId = env.minimaxGroupId as string;
  const data = await getFile(apiKey, groupId, fileId);
  const providerUrl = extractDownloadUrl(data);
  if (!providerUrl) return { file: data };

  if (!historyId) {
    return { videos: [{ id: fileId, url: providerUrl, originalUrl: providerUrl }], status: 'completed' };
  }

  try {
    const creator = await authRepository.getUserById(uid);
    const username = creator?.username || uid;
    const { key, publicUrl } = await uploadFromUrlToZata({
      sourceUrl: providerUrl,
      keyPrefix: `users/${username}/video/${historyId}`,
      fileName: 'video-1',
    });
    const videoItem: any = { id: fileId, url: publicUrl, storagePath: key, originalUrl: providerUrl };
    
    // Score the video for aesthetic quality
    const videos = [videoItem];
    const scoredVideos = await aestheticScoreService.scoreVideos(videos);
    const highestScore = aestheticScoreService.getHighestScore(scoredVideos);
    
    // Update existing history entry
    await generationHistoryRepository.update(uid, historyId, {
      status: 'completed',
      videos: scoredVideos,
      aestheticScore: highestScore,
      provider: 'minimax',
    } as any);
    try { console.log('[MiniMax] Video history updated with scores', { historyId, videoCount: scoredVideos.length, highestScore }); } catch {}
    // Attempt debit using stored params on history (model/duration/resolution)
    try {
      const freshForCost = await generationHistoryRepository.get(uid, historyId);
      const model = (freshForCost as any)?.model || 'MiniMax-Hailuo-02';
      const duration = (freshForCost as any)?.duration;
      const resolution = (freshForCost as any)?.resolution;
      const { cost, pricingVersion, meta } = await computeMinimaxVideoCostFromParams(model, duration, resolution);
      await creditsRepository.writeDebitIfAbsent(uid, historyId, cost, 'minimax.video', { ...meta, historyId, provider: 'minimax', pricingVersion });
    } catch {}
    // Robust mirror sync with retry logic
    await syncToMirror(uid, historyId);
    return { videos: scoredVideos, aestheticScore: highestScore, historyId, status: 'completed' };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[MiniMax] Video Zata upload failed; using provider URL');
    const creator = await authRepository.getUserById(uid);
    const videoItem: any = { id: fileId, url: providerUrl, originalUrl: providerUrl };
    
    // Score the video even with provider URL
    const videos = [videoItem];
    const scoredVideos = await aestheticScoreService.scoreVideos(videos);
    const highestScore = aestheticScoreService.getHighestScore(scoredVideos);
    
    // Update existing history entry
    await generationHistoryRepository.update(uid, historyId, {
      status: 'completed',
      videos: scoredVideos,
      aestheticScore: highestScore,
      provider: 'minimax',
    } as any);
    try { console.log('[MiniMax] Video history updated (provider URL) with scores', { historyId, videoCount: scoredVideos.length, highestScore }); } catch {}
    // Attempt debit even if we used provider URL
    try {
      const freshForCost = await generationHistoryRepository.get(uid, historyId);
      const model = (freshForCost as any)?.model || 'MiniMax-Hailuo-02';
      const { cost, pricingVersion, meta } = await computeMinimaxVideoCostFromParams(model, (freshForCost as any)?.duration, (freshForCost as any)?.resolution);
      await creditsRepository.writeDebitIfAbsent(uid, historyId, cost, 'minimax.video', { ...meta, historyId, provider: 'minimax', pricingVersion });
    } catch {}
    // Robust mirror sync with retry logic
    await syncToMirror(uid, historyId);
    return { videos: scoredVideos, aestheticScore: highestScore, historyId, status: 'completed' };
  }
}

async function musicGenerateAndStore(
  uid: string,
  body: MinimaxMusicRequest & { prompt?: string; isPublic?: boolean; visibility?: string }
): Promise<any> {
  const apiKey = env.minimaxApiKey as string;
  if (!apiKey) throw new ApiError('MiniMax API not configured', 500);
  
  // Validate required fields
  if (!body.prompt || body.prompt.length < 10 || body.prompt.length > 2000) {
    throw new ApiError('prompt is required and must be 10-2000 characters', 400);
  }
  if (!body.lyrics || body.lyrics.length < 10 || body.lyrics.length > 3000) {
    throw new ApiError('lyrics is required and must be 10-3000 characters', 400);
  }
  
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt || body.lyrics || '',
    model: 'music-2.0',
    generationType: body?.generationType || 'text-to-music',
    visibility: (body as any)?.visibility || 'private',
    isPublic: (body as any)?.isPublic === true,
    createdBy,
  } as any);
  
  try {
    // Clean the body to only include fields that the MiniMax API expects
    const cleanBody: MinimaxMusicRequest = {
      model: body.model || 'music-2.0',
      prompt: body.prompt,
      lyrics: body.lyrics,
      output_format: body.output_format,
      stream: body.stream,
      audio_setting: body.audio_setting,
      generationType: body.generationType, // Keep for internal use, but won't be sent to API
    };
    
    const result = await generateMusic(apiKey, cleanBody);
    
    // Check if status is completed (status: 2)
    const status = (result as any)?.data?.status;
    if (status !== 2) {
      await generationHistoryRepository.update(uid, historyId, { 
        status: 'failed', 
        error: `Music generation not completed. Status: ${status}` 
      } as any);
      throw new ApiError(`Music generation not completed. Status: ${status}`, 502, result);
    }
    
    // Handle hex-encoded audio (default)
    const hexAudio: string | undefined = (result as any)?.data?.audio;
    if (hexAudio && typeof hexAudio === 'string') {
      const format: string = body.audio_setting?.format || 'mp3';
      const ext = format.toLowerCase() === 'wav' ? 'wav' : format.toLowerCase() === 'pcm' ? 'pcm' : 'mp3';
      const contentType = ext === 'wav' ? 'audio/wav' : ext === 'pcm' ? 'audio/pcm' : 'audio/mpeg';
      const buffer = Buffer.from(hexAudio, 'hex');
      const username = creator?.username || uid;
      const key = `users/${username}/audio/${historyId}/music-1.${ext}`;
      const { publicUrl } = await uploadBufferToZata(key, buffer, contentType);
      const audioItem: any = { 
        id: 'music-1', 
        url: publicUrl, 
        storagePath: key,
        originalUrl: publicUrl 
      };
      
      // Store in multiple formats for frontend compatibility
      const audiosArray = [audioItem];
      const imagesArray = [{ ...audioItem, type: 'audio' }];
      
      await generationHistoryRepository.update(uid, historyId, { 
        status: 'completed', 
        audio: audioItem,
        audios: audiosArray,
        images: imagesArray,
        provider: 'minimax' 
      } as any);
      await syncToMirror(uid, historyId);
      return { audio: audioItem, audios: audiosArray, images: imagesArray, historyId, status: 'completed' };
    }
    
    // Fallback: try to extract URL
    const providerUrl = extractDownloadUrl(result);
    if (providerUrl) {
      try {
        const username = creator?.username || uid;
        const { key, publicUrl } = await uploadFromUrlToZata({
          sourceUrl: providerUrl,
          keyPrefix: `users/${username}/audio/${historyId}`,
          fileName: 'music-1',
        });
        const audioItem: any = { 
          id: 'music-1', 
          url: publicUrl, 
          storagePath: key, 
          originalUrl: providerUrl 
        };
        const audiosArray = [audioItem];
        const imagesArray = [{ ...audioItem, type: 'audio' }];
        await generationHistoryRepository.update(uid, historyId, { 
          status: 'completed', 
          audio: audioItem,
          audios: audiosArray,
          images: imagesArray,
          provider: 'minimax' 
        } as any);
        await syncToMirror(uid, historyId);
        return { audio: audioItem, audios: audiosArray, images: imagesArray, historyId, status: 'completed' };
      } catch (e) {
        console.warn('[MiniMax] Music Zata upload failed; using provider URL', e);
        const audioItem: any = { id: 'music-1', url: providerUrl, originalUrl: providerUrl };
        const audiosArray = [audioItem];
        const imagesArray = [{ ...audioItem, type: 'audio' }];
        await generationHistoryRepository.update(uid, historyId, { 
          status: 'completed', 
          audio: audioItem,
          audios: audiosArray,
          images: imagesArray,
          provider: 'minimax' 
        } as any);
        await syncToMirror(uid, historyId);
        return { audio: audioItem, audios: audiosArray, images: imagesArray, historyId, status: 'completed' };
      }
    }
    
    await generationHistoryRepository.update(uid, historyId, { 
      status: 'failed', 
      error: 'No audio data returned from MiniMax' 
    } as any);
    throw new ApiError('MiniMax music response missing audio data', 502, result);
  } catch (err: any) {
    const message = err?.message || 'Failed to generate music with MiniMax';
    await generationHistoryRepository.update(uid, historyId, { 
      status: 'failed', 
      error: message 
    } as any);
    await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
    throw err;
  }
}

export const minimaxService = {
  generate,
  generateVideo,
  getVideoStatus,
  getFile,
  generateMusic,
  processVideoFile,
  musicGenerateAndStore,
};
