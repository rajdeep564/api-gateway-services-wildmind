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

    await minimaxRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      images: storedImages,
    });
    await generationHistoryRepository.update(uid, historyId, {
      status: 'completed',
      images: storedImages,
      provider: 'minimax',
    } as Partial<GenerationHistoryItem>);
    // Robust mirror sync with retry logic
    await syncToMirror(uid, historyId);
    return { images: storedImages, historyId, id: data.id } as any;
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
  const res = await axios.post(`${MINIMAX_API_BASE}/music_generation`, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError(
      `MiniMax music error: ${res.status}`,
      res.status,
      res.data
    );
  }
  return res.data as MinimaxMusicResponse;
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
    
    // Update existing history entry
    await generationHistoryRepository.update(uid, historyId, {
      status: 'completed',
      videos: [videoItem],
      provider: 'minimax',
    } as any);
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
    return { videos: [videoItem], historyId, status: 'completed' };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[MiniMax] Video Zata upload failed; using provider URL');
    const creator = await authRepository.getUserById(uid);
    const videoItem: any = { id: fileId, url: providerUrl, originalUrl: providerUrl };
    
    // Update existing history entry
    await generationHistoryRepository.update(uid, historyId, {
      status: 'completed',
      videos: [videoItem],
      provider: 'minimax',
    } as any);
    // Attempt debit even if we used provider URL
    try {
      const freshForCost = await generationHistoryRepository.get(uid, historyId);
      const model = (freshForCost as any)?.model || 'MiniMax-Hailuo-02';
      const { cost, pricingVersion, meta } = await computeMinimaxVideoCostFromParams(model, (freshForCost as any)?.duration, (freshForCost as any)?.resolution);
      await creditsRepository.writeDebitIfAbsent(uid, historyId, cost, 'minimax.video', { ...meta, historyId, provider: 'minimax', pricingVersion });
    } catch {}
    // Robust mirror sync with retry logic
    await syncToMirror(uid, historyId);
    return { videos: [videoItem], historyId, status: 'completed' };
  }
}

async function musicGenerateAndStore(
  uid: string,
  body: MinimaxMusicRequest & { prompt?: string; isPublic?: boolean; visibility?: string }
): Promise<any> {
  const apiKey = env.minimaxApiKey as string;
  if (!apiKey) throw new ApiError('MiniMax API not configured', 500);
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: (body as any)?.prompt || body?.lyrics || '',
    model: String(body?.model || 'MiniMax-Music'),
    generationType: body?.generationType || 'text-to-music',
    visibility: (body as any)?.visibility || 'private',
  isPublic: (body as any)?.isPublic === true,
    createdBy,
  } as any);
  const result = await generateMusic(apiKey, body);
  const providerUrl = extractDownloadUrl(result);
  if (providerUrl) {
    try {
      const username = creator?.username || uid;
      const { key, publicUrl } = await uploadFromUrlToZata({
        sourceUrl: providerUrl,
        keyPrefix: `users/${username}/music/${historyId}`,
        fileName: 'music-1',
      });
      const audioItem: any = { id: 'music-1', url: publicUrl, storagePath: key, originalUrl: providerUrl };
      await generationHistoryRepository.update(uid, historyId, { status: 'completed', audios: [audioItem], provider: 'minimax' } as any);
      // Robust mirror sync with retry logic
      await syncToMirror(uid, historyId);
      return { historyId, audios: [audioItem], status: 'completed' };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[MiniMax] Music Zata upload failed; using provider URL');
      const audioItem: any = { id: 'music-1', url: providerUrl, originalUrl: providerUrl };
      await generationHistoryRepository.update(uid, historyId, { status: 'completed', audios: [audioItem], provider: 'minimax' } as any);
      // Robust mirror sync with retry logic
      await syncToMirror(uid, historyId);
      return { historyId, audios: [audioItem], status: 'completed' };
    }
  }

  // Fallback: hex data in result
  const hexAudio: string | undefined = (result as any)?.data?.audio || (result as any)?.audio;
  if (!hexAudio || typeof hexAudio !== 'string') {
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: 'No audio URL or hex from MiniMax' } as any);
    throw new ApiError('MiniMax music response missing downloadable URL or audio hex', 502, result);
  }
  const format: string = (body as any)?.audio_setting?.format || 'mp3';
  const ext = format.toLowerCase() === 'wav' ? 'wav' : format.toLowerCase() === 'pcm' ? 'pcm' : 'mp3';
  const contentType = ext === 'wav' ? 'audio/wav' : ext === 'pcm' ? 'audio/pcm' : 'audio/mpeg';
  const buffer = Buffer.from(hexAudio, 'hex');
  const username = creator?.username || uid;
  const key = `users/${username}/music/${historyId}/music-1.${ext}`;
  const { publicUrl } = await uploadBufferToZata(key, buffer, contentType);
  const audioItem: any = { id: 'music-1', url: publicUrl, storagePath: key };
  await generationHistoryRepository.update(uid, historyId, { status: 'completed', audios: [audioItem], provider: 'minimax' } as any);
  // Robust mirror sync with retry logic
  await syncToMirror(uid, historyId);
  return { historyId, audios: [audioItem], status: 'completed' };
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
