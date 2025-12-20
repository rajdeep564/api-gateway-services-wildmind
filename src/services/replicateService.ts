import { mediaRepository } from "../repository/canvas/mediaRepository";
import { generationHistoryRepository } from "../repository/generationHistoryRepository";
// Use dynamic import signature to avoid type requirement during build-time
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Replicate = require("replicate");
import sharp from "sharp";
import util from "util";
import { ApiError } from "../utils/errorHandler";
import { env } from "../config/env";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import { authRepository } from "../repository/auth/authRepository";
import {
  uploadFromUrlToZata,
  uploadDataUriToZata,
} from "../utils/storage/zataUpload";
import { replicateRepository } from "../repository/replicateRepository";
import { creditsRepository } from "../repository/creditsRepository";
import { computeWanVideoCost } from "../utils/pricing/wanPricing";
import { syncToMirror, updateMirror } from "../utils/mirrorHelper";
import { aestheticScoreService } from "./aestheticScoreService";
import { markGenerationCompleted } from "./generationHistoryService";

// Import image functions from the new replicate module
import {
  removeBackground,
  upscale,
  generateImage,
  multiangle,
  nextScene,
} from "./replicate";

// Import utilities from replicateUtils (used by video/queue functions)
import {
  ensureReplicate,
  getLatestModelVersion,
  resolveOutputUrls,
  composeModelSpec,
  resolveWanModelFast,
  extractFirstUrl,
  downloadToDataUri,
  buildReplicateImageFileName,
  clamp,
  type SubmitReturn,
} from "./replicate/replicateUtils";

// Image functions (removeBackground, upscale, generateImage, multiangle, nextScene) 
// have been moved to ./replicate/replicateImageService.ts
// They are re-exported from ./replicate/index.ts for backward compatibility

// Re-export image functions for backward compatibility
export {
  removeBackground,
  upscale,
  generateImage,
  multiangle,
  nextScene,
} from "./replicate";

// Video and queue functions are defined below
// The replicateService object is exported at the end of the file

// Wan 2.5 Image-to-Video via Replicate
export async function wanI2V(uid: string, body: any) {
  // env.replicateApiKey already handles REPLICATE_API_TOKEN as fallback in env.ts
  const key = env.replicateApiKey as string;
  if (!key) {
    // eslint-disable-next-line no-console
    console.error("[replicateService.wanI2V] Missing REPLICATE_API_TOKEN");
    throw new ApiError("Replicate API key not configured", 500);
  }
  if (!body?.image) throw new ApiError("image is required", 400);
  if (!body?.prompt) throw new ApiError("prompt is required", 400);

  const replicate = new Replicate({ auth: key });
  const isFast = await resolveWanModelFast(body);
  const modelBase = isFast
    ? "wan-video/wan-2.5-i2v-fast"
    : "wan-video/wan-2.5-i2v";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const parseDurationSec = (d: any): number => {
    const s = String(d ?? "5").toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  };
  const normalizeRes = (r: any): string => {
    const s = String(r ?? "720p").toLowerCase();
    const m = s.match(/(480|720|1080)/);
    return m ? `${m[1]}p` : "720p";
  };

  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "image-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: parseDurationSec(body.duration),
    resolution: normalizeRes(body.resolution),
  } as any);
  const legacyId = await replicateRepository.createGenerationRecord(
    { prompt: body.prompt, model: modelBase, isPublic: body.isPublic === true },
    createdBy
  );

  const input: any = {
    image: body.image,
    prompt: body.prompt,
    duration: parseDurationSec(body.duration),
    resolution: normalizeRes(body.resolution),
  };
  if (body.seed != null && Number.isInteger(Number(body.seed)))
    input.seed = Number(body.seed);
  if (body.audio != null && typeof body.audio === "string")
    input.audio = body.audio;
  if (body.negative_prompt != null && typeof body.negative_prompt === "string")
    input.negative_prompt = body.negative_prompt;
  if (body.enable_prompt_expansion != null)
    input.enable_prompt_expansion = Boolean(body.enable_prompt_expansion);

  let outputUrl = "";
  // Persist input image to Zata so UI can show "Your Uploads"
  try {
    const username = creator?.username || uid;
    const keyPrefix = `users/${username}/input/${historyId}`;
    if (typeof body.image === 'string' && body.image.length > 0) {
      const stored = /^data:/i.test(body.image)
        ? await uploadDataUriToZata({ dataUri: body.image, keyPrefix, fileName: 'input-1' })
        : await uploadFromUrlToZata({ sourceUrl: body.image, keyPrefix, fileName: 'input-1' });
      await generationHistoryRepository.update(uid, historyId, {
        inputImages: [{ id: 'in-1', url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: body.image }],
      } as any);
    }
  } catch { }
  try {
    const version = (body as any).version as string | undefined;
    const modelSpec = composeModelSpec(modelBase, version);
    // eslint-disable-next-line no-console
    console.log("[replicateService.wanI2V] run", {
      modelSpec,
      inputKeys: Object.keys(input),
    });
    const output: any = await replicate.run(modelSpec as any, { input });
    // eslint-disable-next-line no-console
    console.log(
      "[replicateService.wanI2V] output",
      typeof output,
      Array.isArray(output) ? output.length : "n/a"
    );
    const urls = await resolveOutputUrls(output);
    outputUrl = urls[0] || "";
    if (!outputUrl) throw new Error("No output URL returned by Replicate");
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[replicateService.wanI2V] error", e?.message || e);
    try {
      await replicateRepository.updateGenerationRecord(legacyId, {
        status: "failed",
        error: e?.message || "Replicate failed",
      });
    } catch { }
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate failed",
    } as any);
    throw new ApiError("Replicate generation failed", 502, e);
  }

  // Upload video to Zata
  let storedUrl = outputUrl;
  let storagePath = "";
  try {
    const username = creator?.username || uid;
    const uploaded = await uploadFromUrlToZata({
      sourceUrl: outputUrl,
      keyPrefix: `users/${username}/video/${historyId}`,
      fileName: "video-1",
    });
    storedUrl = uploaded.publicUrl;
    storagePath = uploaded.key;
  } catch {
    // fallback keep provider URL
  }

  const videoItem: any = {
    id: `replicate-${Date.now()}`,
    url: storedUrl,
    storagePath,
    originalUrl: outputUrl,
  };

  // Score the video for aesthetic quality (wanI2V function)
  const videos = [videoItem];
  const scoredVideos = await aestheticScoreService.scoreVideos(videos);
  const highestScore = aestheticScoreService.getHighestScore(scoredVideos);

  await generationHistoryRepository.update(uid, historyId, {
    status: "completed",
    videos: scoredVideos,
    aestheticScore: highestScore,
  } as any);
  try { console.log('[Replicate.wanI2V] Video history updated with scores', { historyId, videoCount: scoredVideos.length, highestScore }); } catch { }
  try {
    await replicateRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      videos: scoredVideos as any,
    });
  } catch { }
  // Robust mirror sync with retry logic
  await syncToMirror(uid, historyId);
  return {
    videos: scoredVideos,
    aestheticScore: highestScore,
    historyId,
    model: modelBase,
    status: "completed",
  } as any;
}

// Image functions (removeBackground, upscale, generateImage, multiangle, nextScene)
// have been moved to ./replicate/replicateImageService.ts
// They are re-exported from ./replicate/index.ts for backward compatibility

// Video and queue functions are defined below
export const replicateService = {
  removeBackground,
  upscale,
  generateImage,
  multiangle,
  nextScene,
  wanI2V,
  wanT2V,
};

// All duplicate functions removed. Queue functions continue below.

// ============ Queue-style API for Replicate WAN 2.5 ============
// SubmitReturn, resolveWanModelFast, ensureReplicate, and getLatestModelVersion
// are imported from ./replicate/replicateUtils

// All duplicate functions (wanT2vSubmit, multiangle, generateImage, wanI2V, wanT2V) 
// have been removed. They are now in ./replicate/replicateImageService.ts or below.
// Video functions continue below

// All duplicate functions (wanT2V, multiangle, generateImage, wanI2V) have been removed.
// They are now in ./replicate/replicateImageService.ts or below.
// Video functions continue below

// Wan 2.5 Text-to-Video via Replicate
export async function wanT2V(uid: string, body: any) {
  // env.replicateApiKey already handles REPLICATE_API_TOKEN as fallback in env.ts
  const key = env.replicateApiKey as string;
  if (!key) {
    // eslint-disable-next-line no-console
    console.error("[replicateService.wanT2V] Missing REPLICATE_API_TOKEN");
    throw new ApiError("Replicate API key not configured", 500);
  }
  if (!body?.prompt) throw new ApiError("prompt is required", 400);

  const replicate = new Replicate({ auth: key });
  const isFast = ((): boolean => {
    const s = (body?.speed ?? "").toString().toLowerCase();
    const m = (body?.model ?? "").toString().toLowerCase();
    const speedFast =
      s === "fast" ||
      s === "true" ||
      s.includes("fast") ||
      body?.speed === true;
    const modelFast = m.includes("fast");
    return speedFast || modelFast;
  })();
  const modelBase = isFast
    ? "wan-video/wan-2.5-t2v-fast"
    : "wan-video/wan-2.5-t2v";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const s = String(body?.duration ?? "5").toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  })();
  // Derive resolution from size if provided
  const size = String(body?.size ?? "1280*720");
  const res =
    size.includes("*480") || size.startsWith("480*")
      ? "480p"
      : size.includes("*1080") || size.startsWith("1080*")
        ? "1080p"
        : "720p";

  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "text-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec,
    resolution: res,
  } as any);
  const legacyId = await replicateRepository.createGenerationRecord(
    { prompt: body.prompt, model: modelBase, isPublic: body.isPublic === true },
    createdBy
  );

  const input: any = {
    prompt: body.prompt,
    duration: durationSec,
    size,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed)))
    input.seed = Number(body.seed);
  if (body.audio != null && typeof body.audio === "string")
    input.audio = body.audio;
  if (body.negative_prompt != null && typeof body.negative_prompt === "string")
    input.negative_prompt = body.negative_prompt;
  if (body.enable_prompt_expansion != null)
    input.enable_prompt_expansion = Boolean(body.enable_prompt_expansion);

  let outputUrl = "";
  try {
    const version = (body as any).version as string | undefined;
    const modelSpec = composeModelSpec(modelBase, version);
    // eslint-disable-next-line no-console
    console.log("[replicateService.wanT2V] run", {
      modelSpec,
      inputKeys: Object.keys(input),
    });
    const output: any = await replicate.run(modelSpec as any, { input });
    // eslint-disable-next-line no-console
    console.log(
      "[replicateService.wanT2V] output",
      typeof output,
      Array.isArray(output) ? output.length : "n/a"
    );
    const urls = await resolveOutputUrls(output);
    outputUrl = urls[0] || "";
    if (!outputUrl) throw new Error("No output URL returned by Replicate");
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[replicateService.wanT2V] error", e?.message || e);
    try {
      await replicateRepository.updateGenerationRecord(legacyId, {
        status: "failed",
        error: e?.message || "Replicate failed",
      });
    } catch { }
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate failed",
    } as any);
    throw new ApiError("Replicate generation failed", 502, e);
  }

  // Upload video to Zata
  let storedUrl = outputUrl;
  let storagePath = "";
  try {
    const username = creator?.username || uid;
    const uploaded = await uploadFromUrlToZata({
      sourceUrl: outputUrl,
      keyPrefix: `users/${username}/video/${historyId}`,
      fileName: "video-1",
    });
    storedUrl = uploaded.publicUrl;
    storagePath = uploaded.key;
  } catch {
    // fallback keep provider URL
  }

  const videoItem: any = {
    id: `replicate-${Date.now()}`,
    url: storedUrl,
    storagePath,
    originalUrl: outputUrl,
  };

  // Score the video for aesthetic quality (wanT2V function)
  const videos = [videoItem];
  const scoredVideos = await aestheticScoreService.scoreVideos(videos);
  const highestScore = aestheticScoreService.getHighestScore(scoredVideos);

  // Generate and attach thumbnails
  try {
    const { generateAndAttachThumbnail } = await import('./videoThumbnailService');
    const keyPrefix = storagePath ? storagePath.substring(0, storagePath.lastIndexOf('/')) : `users/${creator?.username || uid}/video/${historyId}`;
    const videosWithThumbnails = await Promise.all(
      scoredVideos.map((video: any) => generateAndAttachThumbnail(video, keyPrefix))
    );
    await generationHistoryRepository.update(uid, historyId, {
      status: "completed",
      videos: videosWithThumbnails,
      aestheticScore: highestScore,
    } as any);
  } catch (thumbErr) {
    console.warn('[Replicate.wanT2V] Failed to generate thumbnails, continuing without them:', thumbErr);
    await generationHistoryRepository.update(uid, historyId, {
      status: "completed",
      videos: scoredVideos,
      aestheticScore: highestScore,
    } as any);
  }
  try { console.log('[Replicate.wanT2V] Video history updated with scores', { historyId, videoCount: scoredVideos.length, highestScore }); } catch { }
  try {
    await replicateRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      videos: scoredVideos as any,
    });
  } catch { }
  // Robust mirror sync with retry logic
  await syncToMirror(uid, historyId);
  return {
    videos: scoredVideos,
    aestheticScore: highestScore,
    historyId,
    model: modelBase,
    status: "completed",
  } as any;
}

// All duplicate image functions (upscale, multiangle, generateImage, etc.) have been removed.
// They are now in ./replicate/replicateImageService.ts

// ============ Queue-style API for Replicate WAN 2.5 ============
// SubmitReturn, resolveWanModelFast, ensureReplicate, and getLatestModelVersion
// are imported from ./replicate/replicateUtils

export async function wanT2vSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError("prompt is required", 400);
  const replicate = ensureReplicate();
  const isFast = await resolveWanModelFast(body);
  const modelBase = isFast
    ? "wan-video/wan-2.5-t2v-fast"
    : "wan-video/wan-2.5-t2v";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const s = String(body?.duration ?? "5").toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  })();
  const size = String(body?.size ?? "1280*720");
  const res =
    size.includes("*480") || size.startsWith("480*")
      ? "480p"
      : size.includes("*1080") || size.startsWith("1080*")
        ? "1080p"
        : "720p";

  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "text-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: res as any,
  } as any);

  // Build input
  const input: any = {
    prompt: body.prompt,
    duration: durationSec,
    size,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed)))
    input.seed = Number(body.seed);
  if (body.audio != null && typeof body.audio === "string")
    input.audio = body.audio;
  if (body.negative_prompt != null && typeof body.negative_prompt === "string")
    input.negative_prompt = body.negative_prompt;
  if (body.enable_prompt_expansion != null)
    input.enable_prompt_expansion = Boolean(body.enable_prompt_expansion);

  // Create prediction (non-blocking)
  let predictionId = "";
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    // eslint-disable-next-line no-console
    console.log("[replicateQueue.wanT2vSubmit] create", {
      modelBase,
      hasVersion: !!version,
    });
    const pred = await replicate.predictions.create(
      version ? { version, input } : { model: modelBase, input }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[replicateQueue.wanT2vSubmit] error", e?.message || e);
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);
    throw new ApiError("Failed to submit WAN T2V job", 502, e);
  }

  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);
  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

// All duplicate functions (wanI2vSubmit, multiangle, generateImage, wanI2V, wanT2V) 
// have been removed. They are now in ./replicate/replicateImageService.ts or below.
// Queue functions continue below

export async function wanI2vSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.image) throw new ApiError("image is required", 400);
  if (!body?.prompt) throw new ApiError("prompt is required", 400);
  const replicate = ensureReplicate();
  const isFast = await resolveWanModelFast(body);
  const modelBase = isFast
    ? "wan-video/wan-2.5-i2v-fast"
    : "wan-video/wan-2.5-i2v";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const s = String(body?.duration ?? "5").toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  })();
  const res = ((): string => {
    const s = String(body?.resolution ?? "720p").toLowerCase();
    const m = s.match(/(480|720|1080)/);
    return m ? `${m[1]}p` : "720p";
  })();

  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "image-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: res as any,
  } as any);

  // Persist input image to Zata so UI can show "Your Uploads"
  try {
    const username = creator?.username || uid;
    const keyPrefix = `users/${username}/input/${historyId}`;
    if (typeof body.image === 'string' && body.image.length > 0) {
      const stored = /^data:/i.test(body.image)
        ? await uploadDataUriToZata({ dataUri: body.image, keyPrefix, fileName: 'input-1' })
        : await uploadFromUrlToZata({ sourceUrl: body.image, keyPrefix, fileName: 'input-1' });
      await generationHistoryRepository.update(uid, historyId, {
        inputImages: [{ id: 'in-1', url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: body.image }],
      } as any);
      console.log('[replicateQueue.wanI2vSubmit] Saved inputImages to database', { historyId });
    }
  } catch (e) {
    console.warn('[replicateQueue.wanI2vSubmit] Failed to save inputImages:', e);
  }

  const input: any = {
    image: body.image,
    prompt: body.prompt,
    duration: durationSec,
    resolution: res,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed)))
    input.seed = Number(body.seed);
  if (body.audio != null && typeof body.audio === "string")
    input.audio = body.audio;
  if (body.negative_prompt != null && typeof body.negative_prompt === "string")
    input.negative_prompt = body.negative_prompt;
  if (body.enable_prompt_expansion != null)
    input.enable_prompt_expansion = Boolean(body.enable_prompt_expansion);

  let predictionId = "";
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    // eslint-disable-next-line no-console
    console.log("[replicateQueue.wanI2vSubmit] create", {
      modelBase,
      hasVersion: !!version,
    });
    const pred = await replicate.predictions.create(
      version ? { version, input } : { model: modelBase, input }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[replicateQueue.wanI2vSubmit] error", e?.message || e);
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);
    throw new ApiError("Failed to submit WAN I2V job", 502, e);
  }

  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);
  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

export async function replicateQueueStatus(
  _uid: string,
  requestId: string
): Promise<any> {
  const replicate = ensureReplicate();
  try {
    const status = await replicate.predictions.get(requestId);
    return status;
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[replicateQueueStatus] Error fetching prediction", {
      requestId,
      error: e?.message || e,
    });
    throw new ApiError("Failed to fetch Replicate status", 502, e);
  }
}

/**
 * Polls a prediction until it completes (succeeded, failed, canceled) or times out.
 * @param predictionId ID of the prediction to poll
 * @param timeoutMs Max wait time in ms (default 5 mins)
 * @param intervalMs Polling interval in ms (default 5s)
 */
export async function waitForPrediction(
  predictionId: string,
  timeoutMs: number = 5 * 60 * 1000,
  intervalMs: number = 5000 // OPTIMIZED: Increased from 2s to 5s to reduce CPU load
): Promise<any> {
  const replicate = ensureReplicate();
  const startTime = Date.now();
  let pollCount = 0;
  
  while (Date.now() - startTime < timeoutMs) {
    const prediction = await replicate.predictions.get(predictionId);
    const status = prediction.status;

    if (status === 'succeeded') {
      return prediction;
    } else if (status === 'failed' || status === 'canceled') {
      throw new Error(`Prediction ${status}: ${prediction.error || 'Unknown error'}`);
    }

    pollCount++;
    // OPTIMIZED: Exponential backoff to reduce CPU load - start at 5s, increase gradually
    const backoffInterval = Math.min(intervalMs * (1 + Math.floor(pollCount / 10)), 30000); // Max 30s
    
    // Wait before next poll with exponential backoff
    await new Promise(resolve => setTimeout(resolve, backoffInterval));
  }
  throw new Error(`Prediction timed out after ${timeoutMs}ms`);
}

// All duplicate/orphaned functions have been removed.

// All duplicate image functions have been removed.
// They are now in ./replicate/replicateImageService.ts

export async function replicateQueueResult(
  uid: string,
  requestId: string
): Promise<any> {
  const replicate = ensureReplicate();
  try {
    const result = await replicate.predictions.get(requestId);
    const located = await generationHistoryRepository.findByProviderTaskId(
      uid,
      "replicate",
      requestId
    );
    if (!located) return result;
    const historyId = located.id;
    // If completed and output present, persist video and finalize history
    const out = (result as any)?.output;
    const urls = await resolveOutputUrls(out);
    const outputUrl = urls[0] || "";
    if (!outputUrl) return result;
    let storedUrl = outputUrl;
    let storagePath = "";
    let canvasProjectId: string | undefined;
    try {
      const freshHistory = await generationHistoryRepository.get(uid, historyId);
      canvasProjectId = (freshHistory as any)?.canvasProjectId || (located.item as any)?.canvasProjectId;
    } catch { }
    try {
      const creator = await authRepository.getUserById(uid);
      const username = creator?.username || uid;
      const basePrefix = canvasProjectId
        ? `users/${username}/canvas/${canvasProjectId}/${historyId}`
        : `users/${username}/video/${historyId}`;
      const uploaded = await uploadFromUrlToZata({
        sourceUrl: outputUrl,
        keyPrefix: basePrefix,
        fileName: "video-1",
      });
      storedUrl = uploaded.publicUrl;
      storagePath = uploaded.key;
    } catch { }
    const videoItem: any = {
      id: requestId,
      url: storedUrl,
      storagePath,
      originalUrl: outputUrl,
    };
    // Score queued video result
    const scoredVideos = await aestheticScoreService.scoreVideos([videoItem]);
    const highestScore = aestheticScoreService.getHighestScore(scoredVideos);
    // Get current history to preserve duration/resolution/quality/inputImages if they exist
    const currentHistory = await generationHistoryRepository.get(uid, historyId).catch(() => null);
    await generationHistoryRepository.update(uid, historyId, {
      status: "completed",
      videos: scoredVideos,
      aestheticScore: highestScore,
      // Preserve duration and resolution from original history if they exist
      ...(currentHistory && (currentHistory as any)?.duration ? { duration: (currentHistory as any).duration } : {}),
      ...(currentHistory && (currentHistory as any)?.resolution ? { resolution: (currentHistory as any).resolution } : {}),
      // Preserve quality field (for PixVerse models)
      ...(currentHistory && (currentHistory as any)?.quality ? { quality: (currentHistory as any).quality } : {}),
      // Preserve inputImages if they exist (for showing "Your Uploads" in UI)
      ...(currentHistory && Array.isArray((currentHistory as any)?.inputImages) && (currentHistory as any).inputImages.length > 0
        ? { inputImages: (currentHistory as any).inputImages }
        : {}),
      ...(canvasProjectId ? { canvasProjectId } : {}),
    } as any);

    // If this originates from a canvas project, also create a canvas media record
    if (canvasProjectId && storagePath && storedUrl) {
      try {
        await mediaRepository.createMedia({
          url: storedUrl,
          storagePath,
          origin: "canvas",
          projectId: canvasProjectId,
          referencedByCount: 0,
          metadata: { format: "mp4" },
        });
      } catch (e) {
        console.warn("[replicateQueueResult] Failed to create canvas media record", e);
      }
    }
    // Robust mirror sync with retry logic
    await syncToMirror(uid, historyId);
    // Compute and write debit (use stored history fields)
    let debitedCredits: number | null = null;
    let debitStatus: 'WRITTEN' | 'SKIPPED' | 'ERROR' | null = null;
    let fresh: any = null;
    try {
      fresh = await generationHistoryRepository.get(uid, historyId);
      const model = (fresh as any)?.model?.toString().toLowerCase() || "";
      // Determine mode from generationType first (most reliable), then fallback to model name
      const generationType = String((fresh as any)?.generationType || "").toLowerCase();
      const isI2vFromType = generationType.includes("image-to-video") || generationType.includes("image_to_video") || generationType === "i2v";
      const modeGuess = isI2vFromType || (model.includes("i2v") && !model.includes("t2v")) ? "i2v" : "t2v";
      if (model.includes("wan-2.5")) {
        // Ensure duration and resolution have defaults if not stored in history
        const duration = (fresh as any)?.duration ?? 5;
        const resolution = (fresh as any)?.resolution ?? "720p";
        const fakeReq = {
          body: {
            mode: modeGuess,
            duration: duration,
            resolution: resolution,
            model: (fresh as any)?.model,
          },
        } as any;
        console.log('[replicateQueueResult] Computing WAN cost', {
          historyId,
          model,
          modeGuess,
          duration: duration,
          resolution: resolution,
          generationType,
          freshDuration: (fresh as any)?.duration,
          freshResolution: (fresh as any)?.resolution,
        });
        const { cost, pricingVersion, meta } = await computeWanVideoCost(fakeReq);
        console.log('[replicateQueueResult] WAN cost computed', { cost, pricingVersion, meta });
        const status = await creditsRepository.writeDebitIfAbsent(
          uid,
          historyId,
          cost,
          `replicate.queue.wan-${modeGuess}`,
          { ...meta, historyId, provider: "replicate", pricingVersion }
        );
        debitedCredits = cost;
        debitStatus = status;
      } else if (model.includes("kling-v2.")) {
        const { computeKlingVideoCost } = await import(
          "../utils/pricing/klingPricing"
        );
        // Ensure duration and resolution have defaults if not stored in history
        const duration = (fresh as any)?.duration ?? 5;
        const resolution = (fresh as any)?.resolution ?? "720p";
        const fakeReq = {
          body: {
            kind: modeGuess,
            duration: duration,
            resolution: resolution,
            model: (fresh as any)?.model,
            kling_mode: (fresh as any)?.kling_mode || (fresh as any)?.mode,
            mode: (fresh as any)?.kling_mode || (fresh as any)?.mode,
          },
        } as any;
        console.log('[replicateQueueResult] Computing Kling cost', {
          historyId,
          model,
          modeGuess,
          duration: duration,
          resolution: resolution,
          generationType,
          kling_mode: (fresh as any)?.kling_mode || (fresh as any)?.mode,
          freshDuration: (fresh as any)?.duration,
          freshResolution: (fresh as any)?.resolution,
        });
        const { cost, pricingVersion, meta } = await computeKlingVideoCost(fakeReq as any);
        console.log('[replicateQueueResult] Kling cost computed', { cost, pricingVersion, meta });
        const status = await creditsRepository.writeDebitIfAbsent(
          uid,
          historyId,
          cost,
          `replicate.queue.kling-${modeGuess}`,
          { ...meta, historyId, provider: "replicate", pricingVersion }
        );
        debitedCredits = cost;
        debitStatus = status;
      } else if (model.includes("seedance")) {
        const { computeSeedanceVideoCost } = await import(
          "../utils/pricing/seedancePricing"
        );
        // Use generationType first (most reliable), then fallback to modeGuess
        const kindFromHistory =
          (fresh as any)?.generationType && String((fresh as any)?.generationType).toLowerCase().includes("image")
            ? "i2v"
            : modeGuess;
        // Ensure duration and resolution have defaults if not stored in history
        const duration = (fresh as any)?.duration ?? 5;
        const resolution = (fresh as any)?.resolution ?? "1080p";
        const fakeReq = {
          body: {
            kind: kindFromHistory,
            duration: duration,
            resolution: resolution,
            model: (fresh as any)?.model,
          },
        } as any;
        console.log('[replicateQueueResult] Computing Seedance cost', {
          historyId,
          model,
          kindFromHistory,
          duration: duration,
          resolution: resolution,
          generationType,
        });
        const { cost, pricingVersion, meta } = await computeSeedanceVideoCost(fakeReq as any);
        console.log('[replicateQueueResult] Seedance cost computed', { cost, pricingVersion, meta });
        const status = await creditsRepository.writeDebitIfAbsent(
          uid,
          historyId,
          cost,
          `replicate.queue.seedance-${kindFromHistory}`,
          { ...meta, historyId, provider: "replicate", pricingVersion }
        );
        debitedCredits = cost;
        debitStatus = status;
      } else if (model.includes("pixverse")) {
        const { computePixverseVideoCost } = await import(
          "../utils/pricing/pixversePricing"
        );
        // Use generationType first (most reliable), then fallback to modeGuess
        const kindFromHistory =
          (fresh as any)?.generationType && String((fresh as any)?.generationType).toLowerCase().includes("image")
            ? "i2v"
            : modeGuess;
        // Ensure duration and quality/resolution have defaults if not stored in history
        const duration = (fresh as any)?.duration ?? 5;
        // For PixVerse, quality is stored separately, but also check resolution as fallback
        const quality = (fresh as any)?.quality || (fresh as any)?.resolution || "720p";
        const fakeReq = {
          body: {
            kind: kindFromHistory,
            duration: duration,
            quality: quality,
            resolution: quality, // Also pass as resolution for compatibility
            model: (fresh as any)?.model,
          },
        } as any;
        console.log('[replicateQueueResult] Computing PixVerse cost', {
          historyId,
          model,
          kindFromHistory,
          duration: duration,
          quality: quality,
          storedQuality: (fresh as any)?.quality,
          storedResolution: (fresh as any)?.resolution,
          generationType,
        });
        const { cost, pricingVersion, meta } = await computePixverseVideoCost(fakeReq as any);
        console.log('[replicateQueueResult] PixVerse cost computed', { cost, pricingVersion, meta });
        const status = await creditsRepository.writeDebitIfAbsent(
          uid,
          historyId,
          cost,
          `replicate.queue.pixverse-${kindFromHistory}`,
          { ...meta, historyId, provider: "replicate", pricingVersion }
        );
        debitedCredits = cost;
        debitStatus = status;
      } else if (model.includes("wan-2.2-animate-replace")) {
        const { computeWanAnimateReplaceCost } = await import(
          "../utils/pricing/wanAnimatePricing"
        );
        // Estimate runtime from video duration if available, otherwise use default
        const estimatedRuntime = (fresh as any)?.video_duration || (fresh as any)?.duration || 5;
        const fakeReq = {
          body: {
            estimated_runtime: estimatedRuntime,
            runtime: estimatedRuntime,
            video_duration: estimatedRuntime,
          },
        } as any;
        const { cost, pricingVersion, meta } = await computeWanAnimateReplaceCost(fakeReq as any);
        const status = await creditsRepository.writeDebitIfAbsent(
          uid,
          historyId,
          cost,
          `replicate.queue.wan-animate-replace`,
          { ...meta, historyId, provider: "replicate", pricingVersion }
        );
        debitedCredits = cost;
        debitStatus = status;
      } else if (model.includes("wan-2.2-animate-animation")) {
        const { computeWanAnimateAnimationCost } = await import(
          "../utils/pricing/wanAnimateAnimationPricing"
        );
        // Estimate runtime from video duration if available, otherwise use default
        const estimatedRuntime = (fresh as any)?.video_duration || (fresh as any)?.duration || 5;
        const fakeReq = {
          body: {
            estimated_runtime: estimatedRuntime,
            runtime: estimatedRuntime,
            video_duration: estimatedRuntime,
          },
        } as any;
        const { cost, pricingVersion, meta } = await computeWanAnimateAnimationCost(fakeReq as any);
        const status = await creditsRepository.writeDebitIfAbsent(
          uid,
          historyId,
          cost,
          `replicate.queue.wan-animate-animation`,
          { ...meta, historyId, provider: "replicate", pricingVersion }
        );
        debitedCredits = cost;
        debitStatus = status;
      }
    } catch (err: any) {
      console.error('[replicateQueueResult] Credit debit error', {
        historyId,
        error: err?.message || err,
        stack: err?.stack,
        model: (fresh as any)?.model,
      });
      debitStatus = 'ERROR';
    }
    return {
      videos: scoredVideos,
      historyId,
      model: (located.item as any)?.model,
      requestId,
      status: "completed",
      debitedCredits,
      debitStatus,
    } as any;
  } catch (e: any) {
    throw new ApiError(e?.message || "Failed to fetch Replicate result", 502);
  }
}

Object.assign(replicateService, {
  wanT2vSubmit,
  wanI2vSubmit,
  replicateQueueStatus,
  replicateQueueResult,
});

// ============ Queue-style API for Replicate Kling ============

export async function klingT2vSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError("prompt is required", 400);
  const replicate = ensureReplicate();
  const modelBase =
    body.model && String(body.model).length > 0
      ? String(body.model)
      : "kwaivgi/kling-v2.5-turbo-pro";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const s = String(body?.duration ?? "5").toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  })();
  const aspect = ((): string => {
    const a = String(body?.aspect_ratio ?? "16:9");
    return ["16:9", "9:16", "1:1"].includes(a) ? a : "16:9";
  })();
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "text-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    // Kling v2.1 supports standard(720p) and pro(1080p). Default others to 720p for pricing/meta.
    resolution: ((): any => {
      const isV21 = modelBase.includes("kling-v2.1");
      const m = String(body?.mode || "").toLowerCase();
      if (isV21 && m === "pro") return "1080p";
      return "720p";
    })(),
    kling_mode: body?.mode || undefined,
  } as any);

  const input: any = {
    prompt: body.prompt,
    duration: durationSec,
    aspect_ratio: aspect,
  };
  if (body.guidance_scale != null)
    input.guidance_scale = Math.max(
      0,
      Math.min(1, Number(body.guidance_scale))
    );
  if (body.negative_prompt != null)
    input.negative_prompt = String(body.negative_prompt);
  if (modelBase.includes("kling-v2.1") && body.mode)
    input.mode = String(body.mode).toLowerCase();

  let predictionId = "";
  try {
    // Try to get version, but if model doesn't exist, we'll get a better error message
    let version: string | null = null;
    try {
      version = await getLatestModelVersion(replicate, modelBase);
      // eslint-disable-next-line no-console
      console.log("[klingT2vSubmit] Model version lookup", {
        modelBase,
        version: version || "not found",
      });
    } catch (versionError: any) {
      // eslint-disable-next-line no-console
      console.warn(
        "[klingT2vSubmit] Version lookup failed, will try direct model",
        { modelBase, error: versionError?.message }
      );
      // Continue without version - will try direct model usage
    }

    // eslint-disable-next-line no-console
    console.log("[klingT2vSubmit] Creating prediction", {
      modelBase,
      version: version || "latest",
      input,
    });
    const pred = await replicate.predictions.create(
      version ? { version, input } : { model: modelBase, input }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
    // eslint-disable-next-line no-console
    console.log("[klingT2vSubmit] Prediction created", { predictionId });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[klingT2vSubmit] Error creating prediction", {
      modelBase,
      error: e?.message || e,
      stack: e?.stack,
      response: e?.response,
      status: e?.status,
      data: e?.data,
      statusCode: e?.statusCode,
    });
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);

    // Extract error message from various sources
    let errorMessage = e?.message || "Replicate API error";
    const statusCode = e?.statusCode || e?.response?.status || e?.status;

    // Check if error message contains HTML (Cloudflare error page)
    if (typeof errorMessage === 'string' && errorMessage.includes('<!DOCTYPE html>')) {
      // Try to extract meaningful info from HTML error
      if (errorMessage.includes('500: Internal server error') || errorMessage.includes('Error code 500')) {
        errorMessage = "Replicate service is temporarily unavailable (500 Internal Server Error). This is a Replicate/Cloudflare issue. Please try again in a few minutes.";
      } else if (errorMessage.includes('502') || errorMessage.includes('Bad Gateway')) {
        errorMessage = "Replicate service is temporarily unavailable (502 Bad Gateway). This is a Replicate/Cloudflare issue. Please try again in a few minutes.";
      } else {
        errorMessage = "Replicate service returned an error. Please try again in a few minutes.";
      }
    } else {
      // Try to extract from response data
      if (e?.response?.data) {
        if (typeof e.response.data === 'string') {
          // If it's an HTML string, use generic message
          if (e.response.data.includes('<!DOCTYPE html>')) {
            errorMessage = "Replicate service is temporarily unavailable. Please try again in a few minutes.";
          } else {
            errorMessage = e.response.data;
          }
        } else if (e.response.data.detail) {
          errorMessage = e.response.data.detail;
        } else if (e.response.data.message) {
          errorMessage = e.response.data.message;
        }
      }
    }

    // Provide a more helpful error message for 404s
    if (
      statusCode === 404 ||
      (errorMessage && errorMessage.includes("404"))
    ) {
      const notFoundMessage = `Model "${modelBase}" not found on Replicate. Please verify the model name is correct. Error: ${errorMessage || "Model not found"
        }`;
      throw new ApiError(notFoundMessage, 404, e);
    }

    // Handle 500 errors specifically
    if (statusCode === 500) {
      throw new ApiError(
        errorMessage || "Replicate service is experiencing issues (500 Internal Server Error). Please try again in a few minutes.",
        502,
        e
      );
    }

    // Handle 502 errors specifically
    if (statusCode === 502) {
      throw new ApiError(
        errorMessage || "Replicate service is temporarily unavailable (502 Bad Gateway). Please try again in a few minutes.",
        502,
        e
      );
    }

    throw new ApiError(
      `Failed to submit Kling T2V job: ${errorMessage}`,
      502,
      e
    );
  }
  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);
  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

export async function klingI2vSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError("prompt is required", 400);
  const hasImg = !!(body?.image || body?.start_image);
  if (!hasImg) throw new ApiError("image or start_image is required", 400);
  const replicate = ensureReplicate();
  const modelBase =
    body.model && String(body.model).length > 0
      ? String(body.model)
      : body.start_image
        ? "kwaivgi/kling-v2.1"
        : "kwaivgi/kling-v2.5-turbo-pro";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const s = String(body?.duration ?? "5").toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  })();
  const aspect = ((): string => {
    const a = String(body?.aspect_ratio ?? "16:9");
    return ["16:9", "9:16", "1:1"].includes(a) ? a : "16:9";
  })();
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "image-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: ((): any => {
      const isV21 = modelBase.includes("kling-v2.1");
      const m = String(body?.mode || "").toLowerCase();
      if (isV21 && m === "pro") return "1080p";
      return "720p";
    })(),
    kling_mode: body?.mode || undefined,
  } as any);

  // Persist input images (image/start_image/end_image) to history
  try {
    const username = creator?.username || uid;
    const keyPrefix = `users/${username}/input/${historyId}`;
    const urls: string[] = [];
    if (typeof body.image === 'string' && body.image) urls.push(String(body.image));
    if (typeof body.start_image === 'string' && body.start_image) urls.push(String(body.start_image));
    if (typeof body.end_image === 'string' && body.end_image) urls.push(String(body.end_image));
    const inputPersisted: any[] = [];
    let idx = 0;
    for (const src of urls) {
      try {
        const stored = /^data:/i.test(src)
          ? await uploadDataUriToZata({ dataUri: src, keyPrefix, fileName: `input-${++idx}` })
          : await uploadFromUrlToZata({ sourceUrl: src, keyPrefix, fileName: `input-${++idx}` });
        inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: src });
      } catch { }
    }
    if (inputPersisted.length > 0) await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
  } catch { }

  const input: any = { prompt: body.prompt, duration: durationSec };
  if (body.image) input.image = String(body.image);
  if (body.start_image) input.start_image = String(body.start_image);
  if (body.end_image) input.end_image = String(body.end_image);
  if (body.aspect_ratio) input.aspect_ratio = aspect;
  if (body.guidance_scale != null)
    input.guidance_scale = Math.max(
      0,
      Math.min(1, Number(body.guidance_scale))
    );
  if (body.negative_prompt != null)
    input.negative_prompt = String(body.negative_prompt);
  if (modelBase.includes("kling-v2.1") && body.mode)
    input.mode = String(body.mode).toLowerCase();

  let predictionId = "";
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    const pred = await replicate.predictions.create(
      version ? { version, input } : { model: modelBase, input }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
  } catch (e: any) {
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);
    throw new ApiError("Failed to submit Kling I2V job", 502, e);
  }
  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);
  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

Object.assign(replicateService, { klingT2vSubmit, klingI2vSubmit });

// ============ Queue-style API for Replicate Kling Lipsync ============

export async function klingLipsyncSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.video_url && !body?.video_id) {
    throw new ApiError("video_url or video_id is required", 400);
  }
  if (body.video_url && body.video_id) {
    throw new ApiError("Cannot use both video_url and video_id", 400);
  }
  if (!body?.audio_file && !body?.text) {
    throw new ApiError("text or audio_file is required", 400);
  }

  const replicate = ensureReplicate();
  const modelBase = body.model && String(body.model).length > 0
    ? String(body.model)
    : "kwaivgi/kling-lip-sync";

  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);

  // Create history record
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.text || body.audio_file ? "Lipsync generation" : "",
    model: modelBase,
    generationType: "video-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    originalPrompt: body.text || "",
  } as any);

  // Persist input video URL (if provided) to history
  try {
    const creator2 = await authRepository.getUserById(uid);
    const username = creator2?.username || uid;
    const keyPrefix = `users/${username}/input/${historyId}`;
    if (typeof body.video_url === 'string' && body.video_url) {
      try {
        const stored = /^data:/i.test(body.video_url)
          ? await uploadDataUriToZata({ dataUri: body.video_url, keyPrefix, fileName: 'input-video-1' })
          : await uploadFromUrlToZata({ sourceUrl: body.video_url, keyPrefix, fileName: 'input-video-1' });
        await generationHistoryRepository.update(uid, historyId, { inputVideos: [{ id: 'vin-1', url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: body.video_url }] } as any);
      } catch { }
    }
  } catch { }

  const input: any = {};

  // Video input (either video_url or video_id)
  if (body.video_url) {
    input.video_url = String(body.video_url);
  } else if (body.video_id) {
    input.video_id = String(body.video_id);
  }

  // Audio or text input
  if (body.audio_file) {
    input.audio_file = String(body.audio_file);
  } else if (body.text) {
    input.text = String(body.text);
    if (body.voice_id) {
      input.voice_id = String(body.voice_id);
    }
    if (body.voice_speed !== undefined) {
      input.voice_speed = Math.max(0.8, Math.min(2, Number(body.voice_speed)));
    }
  }

  let predictionId = "";
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    const pred = await replicate.predictions.create(
      version ? { version, input } : { model: modelBase, input }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
  } catch (e: any) {
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);
    throw new ApiError("Failed to submit Kling Lipsync job", 502, e);
  }

  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);

  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

Object.assign(replicateService, { klingLipsyncSubmit });

// ============ Queue-style API for Replicate WAN 2.2 Animate Replace ============

export async function wanAnimateReplaceSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.video) {
    throw new ApiError("video is required", 400);
  }
  if (!body?.character_image) {
    throw new ApiError("character_image is required", 400);
  }

  const replicate = ensureReplicate();
  const modelBase = body.model && String(body.model).length > 0
    ? String(body.model)
    : "wan-video/wan-2.2-animate-replace";

  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);

  // Create history record
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt || "Animate Replace generation",
    model: modelBase,
    generationType: "video-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    originalPrompt: body.prompt || "",
  } as any);

  // Persist input video and character image to history
  try {
    const username = creator?.username || uid;
    const base = `users/${username}/input/${historyId}`;
    const updates: any = {};
    if (typeof body.video === 'string' && body.video) {
      try {
        const stored = /^data:/i.test(body.video)
          ? await uploadDataUriToZata({ dataUri: body.video, keyPrefix: base, fileName: 'input-video-1' })
          : await uploadFromUrlToZata({ sourceUrl: body.video, keyPrefix: base, fileName: 'input-video-1' });
        updates.inputVideos = [{ id: 'vin-1', url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: body.video }];
      } catch { }
    }
    if (typeof body.character_image === 'string' && body.character_image) {
      try {
        const stored = /^data:/i.test(body.character_image)
          ? await uploadDataUriToZata({ dataUri: body.character_image, keyPrefix: base, fileName: 'input-1' })
          : await uploadFromUrlToZata({ sourceUrl: body.character_image, keyPrefix: base, fileName: 'input-1' });
        updates.inputImages = [{ id: 'in-1', url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: body.character_image }];
      } catch { }
    }
    if (Object.keys(updates).length > 0) await generationHistoryRepository.update(uid, historyId, updates);
  } catch { }

  const input: any = {
    video: String(body.video),
    character_image: String(body.character_image),
  };

  // Optional parameters
  if (body.seed != null && Number.isInteger(Number(body.seed))) {
    input.seed = Number(body.seed);
  }
  if (typeof body.go_fast === 'boolean') {
    input.go_fast = body.go_fast;
  } else {
    input.go_fast = true; // Default
  }
  if (body.refert_num === 1 || body.refert_num === 5) {
    input.refert_num = Number(body.refert_num);
  } else {
    input.refert_num = 1; // Default
  }
  if (body.resolution === '720' || body.resolution === '480') {
    input.resolution = String(body.resolution);
  } else {
    input.resolution = '720'; // Default
  }
  if (typeof body.merge_audio === 'boolean') {
    input.merge_audio = body.merge_audio;
  } else {
    input.merge_audio = true; // Default
  }
  if (body.frames_per_second != null) {
    const fps = Number(body.frames_per_second);
    if (fps >= 5 && fps <= 60) {
      input.frames_per_second = fps;
    } else {
      input.frames_per_second = 24; // Default
    }
  } else {
    input.frames_per_second = 24; // Default
  }

  let predictionId = "";
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    const pred = await replicate.predictions.create(
      version ? { version, input } : { model: modelBase, input }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
  } catch (e: any) {
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);
    throw new ApiError("Failed to submit WAN Animate Replace job", 502, e);
  }

  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);

  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

Object.assign(replicateService, { wanAnimateReplaceSubmit });

// ============ Queue-style API for Replicate WAN 2.2 Animate Animation ============

export async function wanAnimateAnimationSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.video) {
    throw new ApiError("video is required", 400);
  }
  if (!body?.character_image) {
    throw new ApiError("character_image is required", 400);
  }

  const replicate = ensureReplicate();
  const modelBase = body.model && String(body.model).length > 0
    ? String(body.model)
    : "wan-video/wan-2.2-animate-animation";

  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);

  // Create history record
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt || "Animate Animation generation",
    model: modelBase,
    generationType: "video-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    originalPrompt: body.prompt || "",
  } as any);

  // Persist input video and character image to history
  try {
    const username = creator?.username || uid;
    const base = `users/${username}/input/${historyId}`;
    const updates: any = {};
    if (typeof body.video === 'string' && body.video) {
      try {
        const stored = /^data:/i.test(body.video)
          ? await uploadDataUriToZata({ dataUri: body.video, keyPrefix: base, fileName: 'input-video-1' })
          : await uploadFromUrlToZata({ sourceUrl: body.video, keyPrefix: base, fileName: 'input-video-1' });
        updates.inputVideos = [{ id: 'vin-1', url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: body.video }];
      } catch { }
    }
    if (typeof body.character_image === 'string' && body.character_image) {
      try {
        const stored = /^data:/i.test(body.character_image)
          ? await uploadDataUriToZata({ dataUri: body.character_image, keyPrefix: base, fileName: 'input-1' })
          : await uploadFromUrlToZata({ sourceUrl: body.character_image, keyPrefix: base, fileName: 'input-1' });
        updates.inputImages = [{ id: 'in-1', url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: body.character_image }];
      } catch { }
    }
    if (Object.keys(updates).length > 0) await generationHistoryRepository.update(uid, historyId, updates);
  } catch { }

  const input: any = {
    video: String(body.video),
    character_image: String(body.character_image),
  };

  // Optional parameters
  if (body.seed != null && Number.isInteger(Number(body.seed))) {
    input.seed = Number(body.seed);
  }
  if (typeof body.go_fast === 'boolean') {
    input.go_fast = body.go_fast;
  } else {
    input.go_fast = true; // Default
  }
  if (body.refert_num === 1 || body.refert_num === 5) {
    input.refert_num = Number(body.refert_num);
  } else {
    input.refert_num = 1; // Default
  }
  if (body.resolution === '720' || body.resolution === '480') {
    input.resolution = String(body.resolution);
  } else {
    input.resolution = '720'; // Default
  }
  if (typeof body.merge_audio === 'boolean') {
    input.merge_audio = body.merge_audio;
  } else {
    input.merge_audio = true; // Default
  }
  if (body.frames_per_second != null) {
    const fps = Number(body.frames_per_second);
    if (fps >= 5 && fps <= 60) {
      input.frames_per_second = fps;
    } else {
      input.frames_per_second = 24; // Default
    }
  } else {
    input.frames_per_second = 24; // Default
  }

  let predictionId = "";
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    const pred = await replicate.predictions.create(
      version ? { version, input } : { model: modelBase, input }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
  } catch (e: any) {
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);
    throw new ApiError("Failed to submit WAN Animate Animation job", 502, e);
  }

  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);

  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

Object.assign(replicateService, { wanAnimateAnimationSubmit });

// ============ Queue-style API for Replicate Seedance ============

export async function seedanceT2vSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError("prompt is required", 400);
  const replicate = ensureReplicate();
  const modelStr = String(body.model || "").toLowerCase();
  const speed = String(body.speed || "").toLowerCase();
  const isLite =
    modelStr.includes("lite") || speed === "lite" || speed.includes("lite");
  // Correct model names on Replicate: bytedance/seedance-1-pro and bytedance/seedance-1-lite (not 1.0)
  const modelBase = isLite
    ? "bytedance/seedance-1-lite"
    : "bytedance/seedance-1-pro";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const d = Number(body?.duration ?? 5);
    return Math.max(2, Math.min(12, Math.round(d)));
  })();
  const res = ((): string => {
    const r = String(body?.resolution ?? "1080p").toLowerCase();
    const m = r.match(/(480|720|1080)/);
    return m ? `${m[1]}p` : "1080p";
  })();
  const aspect = ((): string => {
    const a = String(body?.aspect_ratio ?? "16:9");
    return ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"].includes(a)
      ? a
      : "16:9";
  })();
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "text-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: res as any,
  } as any);

  // Persist image (first frame), last_frame_image, and reference_images (if provided) as inputImages so preview shows uploads
  try {
    const username = creator?.username || uid;
    const keyPrefix = `users/${username}/input/${historyId}`;
    const urls: string[] = [];
    // First frame image
    if (typeof body.image === 'string' && body.image.length > 5) urls.push(String(body.image));
    // Last frame image
    if (typeof body.last_frame_image === 'string' && body.last_frame_image.length > 5) urls.push(String(body.last_frame_image));
    // Reference images
    if (Array.isArray(body.reference_images)) {
      for (const r of body.reference_images.slice(0, 4)) if (typeof r === 'string' && r.length > 5) urls.push(r);
    }
    const inputPersisted: any[] = [];
    let idx = 0;
    for (const src of urls) {
      try {
        const stored = /^data:/i.test(src)
          ? await uploadDataUriToZata({ dataUri: src, keyPrefix, fileName: `input-${++idx}` })
          : await uploadFromUrlToZata({ sourceUrl: src, keyPrefix, fileName: `input-${++idx}` });
        inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: src });
      } catch { }
    }
    if (inputPersisted.length > 0) await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
  } catch { }

  const input: any = {
    prompt: body.prompt,
    duration: durationSec,
    resolution: res,
    aspect_ratio: aspect,
    fps: 24,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed)))
    input.seed = Number(body.seed);
  if (typeof body.camera_fixed === "boolean")
    input.camera_fixed = body.camera_fixed;
  // First frame image (for image-to-video generation with seedance T2V)
  if (typeof body.image === 'string' && body.image.length > 5) {
    input.image = String(body.image);
  }
  // Last frame image (only works if first frame image is provided)
  if (typeof body.last_frame_image === 'string' && body.last_frame_image.length > 5) {
    input.last_frame_image = String(body.last_frame_image);
  }
  // Reference images (1-4 images) for guiding video generation
  // Note: Cannot be used with 1080p resolution or first/last frame images
  if (
    Array.isArray(body.reference_images) &&
    body.reference_images.length > 0 &&
    body.reference_images.length <= 4
  ) {
    // Validate that reference images are not used with incompatible settings
    const hasFirstFrame = body.image && String(body.image).length > 5;
    const hasLastFrame = body.last_frame_image && String(body.last_frame_image).length > 5;
    if (res === "1080p") {
      console.warn(
        "[seedanceT2vSubmit] reference_images cannot be used with 1080p resolution, ignoring"
      );
    } else if (hasFirstFrame || hasLastFrame) {
      console.warn(
        "[seedanceT2vSubmit] reference_images cannot be used with first/last frame images, ignoring"
      );
    } else {
      input.reference_images = body.reference_images.slice(0, 4); // Limit to 4 images
    }
  }

  let predictionId = "";
  try {
    // Try to get version, but if model doesn't exist, we'll get a better error message
    let version: string | null = null;
    try {
      version = await getLatestModelVersion(replicate, modelBase);
      // eslint-disable-next-line no-console
      console.log("[seedanceT2vSubmit] Model version lookup", {
        modelBase,
        version: version || "not found",
      });
    } catch (versionError: any) {
      // eslint-disable-next-line no-console
      console.warn(
        "[seedanceT2vSubmit] Version lookup failed, will try direct model",
        { modelBase, error: versionError?.message }
      );
      // Continue without version - will try direct model usage
    }

    // eslint-disable-next-line no-console
    console.log("[seedanceT2vSubmit] Creating prediction", {
      modelBase,
      version: version || "latest",
      input,
    });
    const pred = await replicate.predictions.create(
      version ? { version, input } : { model: modelBase, input }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
    // eslint-disable-next-line no-console
    console.log("[seedanceT2vSubmit] Prediction created", { predictionId });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[seedanceT2vSubmit] Error creating prediction", {
      modelBase,
      error: e?.message || e,
      stack: e?.stack,
      response: e?.response,
      status: e?.status,
      data: e?.data,
      statusCode: e?.statusCode,
    });
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);

    // Extract error message from various sources
    let errorMessage = e?.message || "Replicate API error";
    const statusCode = e?.statusCode || e?.response?.status || e?.status;

    // Check if error message contains HTML (Cloudflare error page)
    if (typeof errorMessage === 'string' && errorMessage.includes('<!DOCTYPE html>')) {
      // Try to extract meaningful info from HTML error
      if (errorMessage.includes('500: Internal server error') || errorMessage.includes('Error code 500')) {
        errorMessage = "Replicate service is temporarily unavailable (500 Internal Server Error). This is a Replicate/Cloudflare issue. Please try again in a few minutes.";
      } else if (errorMessage.includes('502') || errorMessage.includes('Bad Gateway')) {
        errorMessage = "Replicate service is temporarily unavailable (502 Bad Gateway). This is a Replicate/Cloudflare issue. Please try again in a few minutes.";
      } else {
        errorMessage = "Replicate service returned an error. Please try again in a few minutes.";
      }
    } else {
      // Try to extract from response data
      if (e?.response?.data) {
        if (typeof e.response.data === 'string') {
          // If it's an HTML string, use generic message
          if (e.response.data.includes('<!DOCTYPE html>')) {
            errorMessage = "Replicate service is temporarily unavailable. Please try again in a few minutes.";
          } else {
            errorMessage = e.response.data;
          }
        } else if (e.response.data.detail) {
          errorMessage = e.response.data.detail;
        } else if (e.response.data.message) {
          errorMessage = e.response.data.message;
        }
      }
    }

    // Provide a more helpful error message for 404s
    if (
      statusCode === 404 ||
      (errorMessage && errorMessage.includes("404"))
    ) {
      const notFoundMessage = `Model "${modelBase}" not found on Replicate. Please verify the model name is correct. Error: ${errorMessage || "Model not found"
        }`;
      throw new ApiError(notFoundMessage, 404, e);
    }

    // Handle 500 errors specifically
    if (statusCode === 500) {
      throw new ApiError(
        errorMessage || "Replicate service is experiencing issues (500 Internal Server Error). Please try again in a few minutes.",
        502,
        e
      );
    }

    // Handle 502 errors specifically
    if (statusCode === 502) {
      throw new ApiError(
        errorMessage || "Replicate service is temporarily unavailable (502 Bad Gateway). Please try again in a few minutes.",
        502,
        e
      );
    }

    throw new ApiError(
      `Failed to submit Seedance T2V job: ${errorMessage}`,
      502,
      e
    );
  }
  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);
  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

export async function seedanceI2vSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError("prompt is required", 400);
  if (!body?.image) throw new ApiError("image is required", 400);
  const replicate = ensureReplicate();
  const modelStr = String(body.model || "").toLowerCase();
  const speed = String(body.speed || "").toLowerCase();
  const isLite =
    modelStr.includes("lite") || speed === "lite" || speed.includes("lite");
  // Correct model names on Replicate: bytedance/seedance-1-pro and bytedance/seedance-1-lite (not 1.0)
  const modelBase = isLite
    ? "bytedance/seedance-1-lite"
    : "bytedance/seedance-1-pro";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const d = Number(body?.duration ?? 5);
    return Math.max(2, Math.min(12, Math.round(d)));
  })();
  const res = ((): string => {
    const r = String(body?.resolution ?? "1080p").toLowerCase();
    const m = r.match(/(480|720|1080)/);
    return m ? `${m[1]}p` : "1080p";
  })();
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "image-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: res as any,
  } as any);

  // Persist input image, last_frame_image, and reference_images to history
  try {
    const username = creator?.username || uid;
    const keyPrefix = `users/${username}/input/${historyId}`;
    const urls: string[] = [];
    if (typeof body.image === 'string') urls.push(String(body.image));
    if (typeof body.last_frame_image === 'string' && body.last_frame_image.length > 5) urls.push(String(body.last_frame_image));
    if (Array.isArray(body.reference_images)) {
      for (const r of body.reference_images.slice(0, 4)) if (typeof r === 'string') urls.push(r);
    }
    const inputPersisted: any[] = [];
    let idx = 0;
    for (const src of urls) {
      try {
        const stored = /^data:/i.test(src)
          ? await uploadDataUriToZata({ dataUri: src, keyPrefix, fileName: `input-${++idx}` })
          : await uploadFromUrlToZata({ sourceUrl: src, keyPrefix, fileName: `input-${++idx}` });
        inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: src });
      } catch { }
    }
    if (inputPersisted.length > 0) await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
  } catch { }

  const input: any = {
    prompt: body.prompt,
    image: String(body.image),
    duration: durationSec,
    resolution: res,
    fps: 24,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed)))
    input.seed = Number(body.seed);
  if (typeof body.camera_fixed === "boolean")
    input.camera_fixed = body.camera_fixed;
  if (body.last_frame_image && String(body.last_frame_image).length > 5)
    input.last_frame_image = String(body.last_frame_image);
  // Reference images (1-4 images) for guiding video generation
  // Note: Cannot be used with 1080p resolution or first/last frame images
  if (
    Array.isArray(body.reference_images) &&
    body.reference_images.length > 0 &&
    body.reference_images.length <= 4
  ) {
    // Validate that reference images are not used with incompatible settings
    const hasFirstFrame = body.image && String(body.image).length > 5;
    const hasLastFrame = body.last_frame_image && String(body.last_frame_image).length > 5;
    if (
      res === "1080p" ||
      hasFirstFrame ||
      hasLastFrame
    ) {
      console.warn(
        "[seedanceI2vSubmit] reference_images cannot be used with 1080p resolution or first/last frame images, ignoring"
      );
    } else {
      input.reference_images = body.reference_images.slice(0, 4); // Limit to 4 images
    }
  }

  let predictionId = "";
  try {
    // Try to get version, but if model doesn't exist, we'll get a better error message
    let version: string | null = null;
    try {
      version = await getLatestModelVersion(replicate, modelBase);
      // eslint-disable-next-line no-console
      console.log("[seedanceI2vSubmit] Model version lookup", {
        modelBase,
        version: version || "not found",
      });
    } catch (versionError: any) {
      // eslint-disable-next-line no-console
      console.warn(
        "[seedanceI2vSubmit] Version lookup failed, will try direct model",
        { modelBase, error: versionError?.message }
      );
      // Continue without version - will try direct model usage
    }

    // eslint-disable-next-line no-console
    console.log("[seedanceI2vSubmit] Creating prediction", {
      modelBase,
      version: version || "latest",
      inputKeys: Object.keys(input),
    });
    const pred = await replicate.predictions.create(
      version ? { version, input } : { model: modelBase, input }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
    // eslint-disable-next-line no-console
    console.log("[seedanceI2vSubmit] Prediction created", { predictionId });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[seedanceI2vSubmit] Error creating prediction", {
      modelBase,
      error: e?.message || e,
      stack: e?.stack,
      response: e?.response,
      status: e?.status,
      data: e?.data,
      statusCode: e?.statusCode,
    });
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);

    // Extract error message from various sources
    let errorMessage = e?.message || "Replicate API error";
    const statusCode = e?.statusCode || e?.response?.status || e?.status;

    // Check if error message contains HTML (Cloudflare error page)
    if (typeof errorMessage === 'string' && errorMessage.includes('<!DOCTYPE html>')) {
      // Try to extract meaningful info from HTML error
      if (errorMessage.includes('500: Internal server error') || errorMessage.includes('Error code 500')) {
        errorMessage = "Replicate service is temporarily unavailable (500 Internal Server Error). This is a Replicate/Cloudflare issue. Please try again in a few minutes.";
      } else if (errorMessage.includes('502') || errorMessage.includes('Bad Gateway')) {
        errorMessage = "Replicate service is temporarily unavailable (502 Bad Gateway). This is a Replicate/Cloudflare issue. Please try again in a few minutes.";
      } else {
        errorMessage = "Replicate service returned an error. Please try again in a few minutes.";
      }
    } else {
      // Try to extract from response data
      if (e?.response?.data) {
        if (typeof e.response.data === 'string') {
          // If it's an HTML string, use generic message
          if (e.response.data.includes('<!DOCTYPE html>')) {
            errorMessage = "Replicate service is temporarily unavailable. Please try again in a few minutes.";
          } else {
            errorMessage = e.response.data;
          }
        } else if (e.response.data.detail) {
          errorMessage = e.response.data.detail;
        } else if (e.response.data.message) {
          errorMessage = e.response.data.message;
        }
      }
    }

    // Provide a more helpful error message for 404s
    if (
      statusCode === 404 ||
      (errorMessage && errorMessage.includes("404"))
    ) {
      const notFoundMessage = `Model "${modelBase}" not found on Replicate. Please verify the model name is correct. Error: ${errorMessage || "Model not found"
        }`;
      throw new ApiError(notFoundMessage, 404, e);
    }

    // Handle 500 errors specifically
    if (statusCode === 500) {
      throw new ApiError(
        errorMessage || "Replicate service is experiencing issues (500 Internal Server Error). Please try again in a few minutes.",
        502,
        e
      );
    }

    // Handle 502 errors specifically
    if (statusCode === 502) {
      throw new ApiError(
        errorMessage || "Replicate service is temporarily unavailable (502 Bad Gateway). Please try again in a few minutes.",
        502,
        e
      );
    }

    throw new ApiError(
      `Failed to submit Seedance I2V job: ${errorMessage}`,
      502,
      e
    );
  }
  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);
  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

Object.assign(replicateService, { seedanceT2vSubmit, seedanceI2vSubmit });

// ============ Queue-style API for Replicate Seedance Pro Fast ============

export async function seedanceProFastT2vSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError("prompt is required", 400);
  const replicate = ensureReplicate();
  const modelBase = "bytedance/seedance-1-pro-fast";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const d = Number(body?.duration ?? 5);
    return Math.max(2, Math.min(12, Math.round(d)));
  })();
  const res = ((): string => {
    const r = String(body?.resolution ?? "1080p").toLowerCase();
    const m = r.match(/(480|720|1080)/);
    return m ? `${m[1]}p` : "1080p";
  })();
  const aspect = ((): string => {
    const a = String(body?.aspect_ratio ?? "16:9");
    return ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"].includes(a)
      ? a
      : "16:9";
  })();
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "text-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: res as any,
  } as any);

  // Note: Pro Fast does NOT support first_frame_image or last_frame_image
  // Only persist reference images if provided (and not incompatible with settings)
  try {
    const username = creator?.username || uid;
    const keyPrefix = `users/${username}/input/${historyId}`;
    const urls: string[] = [];
    // Reference images (if provided and compatible)
    if (Array.isArray(body.reference_images)) {
      for (const r of body.reference_images.slice(0, 4)) if (typeof r === 'string' && r.length > 5) urls.push(r);
    }
    const inputPersisted: any[] = [];
    let idx = 0;
    for (const src of urls) {
      try {
        const stored = /^data:/i.test(src)
          ? await uploadDataUriToZata({ dataUri: src, keyPrefix, fileName: `input-${++idx}` })
          : await uploadFromUrlToZata({ sourceUrl: src, keyPrefix, fileName: `input-${++idx}` });
        inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: src });
      } catch { }
    }
    if (inputPersisted.length > 0) await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
  } catch { }

  const input: any = {
    prompt: body.prompt,
    duration: durationSec,
    resolution: res,
    aspect_ratio: aspect,
    fps: 24,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed)))
    input.seed = Number(body.seed);
  if (typeof body.camera_fixed === "boolean")
    input.camera_fixed = body.camera_fixed;
  // Note: Pro Fast does NOT support first_frame_image or last_frame_image
  // Reference images (1-4 images) - only include if not 1080p
  if (
    Array.isArray(body.reference_images) &&
    body.reference_images.length > 0 &&
    body.reference_images.length <= 4
  ) {
    if (res === "1080p") {
      console.warn(
        "[seedanceProFastT2vSubmit] reference_images cannot be used with 1080p resolution, ignoring"
      );
    } else {
      input.reference_images = body.reference_images.slice(0, 4); // Limit to 4 images
    }
  }

  let predictionId = "";
  try {
    let version: string | null = null;
    try {
      version = await getLatestModelVersion(replicate, modelBase);
      console.log("[seedanceProFastT2vSubmit] Model version lookup", {
        modelBase,
        version: version || "not found",
      });
    } catch (versionError: any) {
      console.warn(
        "[seedanceProFastT2vSubmit] Version lookup failed, will try direct model",
        { modelBase, error: versionError?.message }
      );
    }

    console.log("[seedanceProFastT2vSubmit] Creating prediction", {
      modelBase,
      version: version || "latest",
      input,
    });
    const pred = await replicate.predictions.create(
      version ? { version, input } : { model: modelBase, input }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
    console.log("[seedanceProFastT2vSubmit] Prediction created", { predictionId });
  } catch (e: any) {
    console.error("[seedanceProFastT2vSubmit] Error creating prediction", {
      modelBase,
      error: e?.message || e,
      stack: e?.stack,
      response: e?.response,
      status: e?.status,
      data: e?.data,
      statusCode: e?.statusCode,
    });
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);

    let errorMessage = e?.message || "Replicate API error";
    const statusCode = e?.statusCode || e?.response?.status || e?.status;

    if (typeof errorMessage === 'string' && errorMessage.includes('<!DOCTYPE html>')) {
      if (errorMessage.includes('500: Internal server error') || errorMessage.includes('Error code 500')) {
        errorMessage = "Replicate service is temporarily unavailable (500 Internal Server Error). This is a Replicate/Cloudflare issue. Please try again in a few minutes.";
      } else if (errorMessage.includes('502') || errorMessage.includes('Bad Gateway')) {
        errorMessage = "Replicate service is temporarily unavailable (502 Bad Gateway). This is a Replicate/Cloudflare issue. Please try again in a few minutes.";
      } else {
        errorMessage = "Replicate service returned an error. Please try again in a few minutes.";
      }
    } else {
      if (e?.response?.data) {
        if (typeof e.response.data === 'string') {
          if (e.response.data.includes('<!DOCTYPE html>')) {
            errorMessage = "Replicate service is temporarily unavailable. Please try again in a few minutes.";
          } else {
            errorMessage = e.response.data;
          }
        } else if (e.response.data.detail) {
          errorMessage = e.response.data.detail;
        } else if (e.response.data.message) {
          errorMessage = e.response.data.message;
        }
      }
    }

    if (
      statusCode === 404 ||
      (errorMessage && errorMessage.includes("404"))
    ) {
      const notFoundMessage = `Model "${modelBase}" not found on Replicate. Please verify the model name is correct. Error: ${errorMessage || "Model not found"
        }`;
      throw new ApiError(notFoundMessage, 404, e);
    }

    if (statusCode === 500) {
      throw new ApiError(
        errorMessage || "Replicate service is experiencing issues (500 Internal Server Error). Please try again in a few minutes.",
        502,
        e
      );
    }

    if (statusCode === 502) {
      throw new ApiError(
        errorMessage || "Replicate service is temporarily unavailable (502 Bad Gateway). Please try again in a few minutes.",
        502,
        e
      );
    }

    throw new ApiError(
      `Failed to submit Seedance Pro Fast T2V job: ${errorMessage}`,
      502,
      e
    );
  }
  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);
  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

export async function seedanceProFastI2vSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError("prompt is required", 400);
  if (!body?.image) throw new ApiError("image is required", 400);
  const replicate = ensureReplicate();
  const modelBase = "bytedance/seedance-1-pro-fast";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const d = Number(body?.duration ?? 5);
    return Math.max(2, Math.min(12, Math.round(d)));
  })();
  const res = ((): string => {
    const r = String(body?.resolution ?? "1080p").toLowerCase();
    const m = r.match(/(480|720|1080)/);
    return m ? `${m[1]}p` : "1080p";
  })();
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "image-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: res as any,
  } as any);

  // Persist input image (for I2V) and reference_images to history
  // Note: Pro Fast does NOT support last_frame_image
  try {
    const username = creator?.username || uid;
    const keyPrefix = `users/${username}/input/${historyId}`;
    const urls: string[] = [];
    if (typeof body.image === 'string') urls.push(String(body.image));
    if (Array.isArray(body.reference_images)) {
      for (const r of body.reference_images.slice(0, 4)) if (typeof r === 'string') urls.push(r);
    }
    const inputPersisted: any[] = [];
    let idx = 0;
    for (const src of urls) {
      try {
        const stored = /^data:/i.test(src)
          ? await uploadDataUriToZata({ dataUri: src, keyPrefix, fileName: `input-${++idx}` })
          : await uploadFromUrlToZata({ sourceUrl: src, keyPrefix, fileName: `input-${++idx}` });
        inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: src });
      } catch { }
    }
    if (inputPersisted.length > 0) await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
  } catch { }

  const input: any = {
    prompt: body.prompt,
    image: String(body.image),
    duration: durationSec,
    resolution: res,
    fps: 24,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed)))
    input.seed = Number(body.seed);
  if (typeof body.camera_fixed === "boolean")
    input.camera_fixed = body.camera_fixed;
  // Note: Pro Fast does NOT support last_frame_image
  // Reference images (1-4 images) - only include if not 1080p
  if (
    Array.isArray(body.reference_images) &&
    body.reference_images.length > 0 &&
    body.reference_images.length <= 4
  ) {
    if (res === "1080p") {
      console.warn(
        "[seedanceProFastI2vSubmit] reference_images cannot be used with 1080p resolution, ignoring"
      );
    } else {
      input.reference_images = body.reference_images.slice(0, 4); // Limit to 4 images
    }
  }

  let predictionId = "";
  try {
    let version: string | null = null;
    try {
      version = await getLatestModelVersion(replicate, modelBase);
      console.log("[seedanceProFastI2vSubmit] Model version lookup", {
        modelBase,
        version: version || "not found",
      });
    } catch (versionError: any) {
      console.warn(
        "[seedanceProFastI2vSubmit] Version lookup failed, will try direct model",
        { modelBase, error: versionError?.message }
      );
    }

    console.log("[seedanceProFastI2vSubmit] Creating prediction", {
      modelBase,
      version: version || "latest",
      input,
    });
    const pred = await replicate.predictions.create(
      version ? { version, input } : { model: modelBase, input }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
    console.log("[seedanceProFastI2vSubmit] Prediction created", { predictionId });
  } catch (e: any) {
    console.error("[seedanceProFastI2vSubmit] Error creating prediction", {
      modelBase,
      error: e?.message || e,
      stack: e?.stack,
      response: e?.response,
      status: e?.status,
      data: e?.data,
      statusCode: e?.statusCode,
    });
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);

    let errorMessage = e?.message || "Replicate API error";
    const statusCode = e?.statusCode || e?.response?.status || e?.status;

    if (typeof errorMessage === 'string' && errorMessage.includes('<!DOCTYPE html>')) {
      if (errorMessage.includes('500: Internal server error') || errorMessage.includes('Error code 500')) {
        errorMessage = "Replicate service is temporarily unavailable (500 Internal Server Error). This is a Replicate/Cloudflare issue. Please try again in a few minutes.";
      } else if (errorMessage.includes('502') || errorMessage.includes('Bad Gateway')) {
        errorMessage = "Replicate service is temporarily unavailable (502 Bad Gateway). This is a Replicate/Cloudflare issue. Please try again in a few minutes.";
      } else {
        errorMessage = "Replicate service returned an error. Please try again in a few minutes.";
      }
    } else {
      if (e?.response?.data) {
        if (typeof e.response.data === 'string') {
          if (e.response.data.includes('<!DOCTYPE html>')) {
            errorMessage = "Replicate service is temporarily unavailable. Please try again in a few minutes.";
          } else {
            errorMessage = e.response.data;
          }
        } else if (e.response.data.detail) {
          errorMessage = e.response.data.detail;
        } else if (e.response.data.message) {
          errorMessage = e.response.data.message;
        }
      }
    }

    if (
      statusCode === 404 ||
      (errorMessage && errorMessage.includes("404"))
    ) {
      const notFoundMessage = `Model "${modelBase}" not found on Replicate. Please verify the model name is correct. Error: ${errorMessage || "Model not found"
        }`;
      throw new ApiError(notFoundMessage, 404, e);
    }

    if (statusCode === 500) {
      throw new ApiError(
        errorMessage || "Replicate service is experiencing issues (500 Internal Server Error). Please try again in a few minutes.",
        502,
        e
      );
    }

    if (statusCode === 502) {
      throw new ApiError(
        errorMessage || "Replicate service is temporarily unavailable (502 Bad Gateway). Please try again in a few minutes.",
        502,
        e
      );
    }

    throw new ApiError(
      `Failed to submit Seedance Pro Fast I2V job: ${errorMessage}`,
      502,
      e
    );
  }
  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);
  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

Object.assign(replicateService, { seedanceProFastT2vSubmit, seedanceProFastI2vSubmit });

// ============ Queue-style API for Replicate PixVerse v5 ============

export async function pixverseT2vSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError("prompt is required", 400);
  const replicate = ensureReplicate();
  const modelBase =
    body.model && String(body.model).length > 0
      ? String(body.model)
      : "pixverseai/pixverse-v5";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const s = String(body?.duration ?? "5").toLowerCase();
    const m = s.match(/(5|8)/);
    return m ? Number(m[1]) : 5;
  })();
  const quality = ((): string => {
    const q = String(body?.quality ?? body?.resolution ?? "720p").toLowerCase();
    const m = q.match(/(360|540|720|1080)/);
    return m ? `${m[1]}p` : "720p";
  })();

  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "text-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: quality as any,
    quality: quality as any, // Store quality separately for PixVerse pricing
  } as any);

  const input: any = {
    prompt: body.prompt,
    duration: durationSec,
    quality,
    aspect_ratio: ((): string => {
      const a = String(body?.aspect_ratio ?? "16:9");
      return ["16:9", "9:16", "1:1"].includes(a) ? a : "16:9";
    })(),
  };
  if (body.seed != null && Number.isInteger(Number(body.seed)))
    input.seed = Number(body.seed);
  if (body.negative_prompt != null)
    input.negative_prompt = String(body.negative_prompt);

  let predictionId = "";
  try {
    // Try to get version, but if model doesn't exist, we'll get a better error message
    let version: string | null = null;
    try {
      version = await getLatestModelVersion(replicate, modelBase);
      // eslint-disable-next-line no-console
      console.log("[pixverseT2vSubmit] Model version lookup", {
        modelBase,
        version: version || "not found",
      });
    } catch (versionError: any) {
      // eslint-disable-next-line no-console
      console.warn(
        "[pixverseT2vSubmit] Version lookup failed, will try direct model",
        { modelBase, error: versionError?.message }
      );
      // Continue without version - will try direct model usage
    }

    // Ensure no image/frame parameters are in input for T2V
    const cleanInput: any = {
      prompt: input.prompt,
      duration: input.duration,
      quality: input.quality,
      aspect_ratio: input.aspect_ratio,
    };
    if (input.seed != null) cleanInput.seed = input.seed;
    if (input.negative_prompt != null) cleanInput.negative_prompt = input.negative_prompt;

    // eslint-disable-next-line no-console
    console.log("[pixverseT2vSubmit] Creating prediction", {
      modelBase,
      version: version || "latest",
      input: cleanInput,
      inputKeys: Object.keys(cleanInput),
    });

    const pred = await replicate.predictions.create(
      version ? { version, input: cleanInput } : { model: modelBase, input: cleanInput }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
    // eslint-disable-next-line no-console
    console.log("[pixverseT2vSubmit] Prediction created", { predictionId });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[pixverseT2vSubmit] Error creating prediction", {
      modelBase,
      error: e?.message || e,
      stack: e?.stack,
      response: e?.response,
      status: e?.status,
      data: e?.data,
      statusCode: e?.statusCode,
    });
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);

    // Extract error message from various sources
    let errorMessage = e?.message || "Replicate API error";
    const statusCode = e?.statusCode || e?.response?.status || e?.status;

    // Check if error message contains HTML (Cloudflare error page)
    if (typeof errorMessage === 'string' && errorMessage.includes('<!DOCTYPE html>')) {
      // Try to extract meaningful info from HTML error
      if (errorMessage.includes('500: Internal server error') || errorMessage.includes('Error code 500')) {
        errorMessage = "Replicate service is temporarily unavailable (500 Internal Server Error). This is a Replicate/Cloudflare issue. Please try again in a few minutes.";
      } else if (errorMessage.includes('502') || errorMessage.includes('Bad Gateway')) {
        errorMessage = "Replicate service is temporarily unavailable (502 Bad Gateway). This is a Replicate/Cloudflare issue. Please try again in a few minutes.";
      } else {
        errorMessage = "Replicate service returned an error. Please try again in a few minutes.";
      }
    } else {
      // Try to extract from response data
      if (e?.response?.data) {
        if (typeof e.response.data === 'string') {
          // If it's an HTML string, use generic message
          if (e.response.data.includes('<!DOCTYPE html>')) {
            errorMessage = "Replicate service is temporarily unavailable. Please try again in a few minutes.";
          } else {
            errorMessage = e.response.data;
          }
        } else if (e.response.data.detail) {
          errorMessage = e.response.data.detail;
        } else if (e.response.data.message) {
          errorMessage = e.response.data.message;
        }
      }
    }

    // Provide a more helpful error message for 404s
    if (
      statusCode === 404 ||
      (errorMessage && errorMessage.includes("404"))
    ) {
      const notFoundMessage = `Model "${modelBase}" not found on Replicate. The model may have been removed or renamed. Please verify the model name is correct. Error: ${errorMessage || "Model not found"
        }`;
      throw new ApiError(notFoundMessage, 404, e);
    }

    // Handle 500 errors specifically
    if (statusCode === 500) {
      throw new ApiError(
        errorMessage || "Replicate service is experiencing issues (500 Internal Server Error). Please try again in a few minutes.",
        502,
        e
      );
    }

    // Handle 502 errors specifically
    if (statusCode === 502) {
      throw new ApiError(
        errorMessage || "Replicate service is temporarily unavailable (502 Bad Gateway). Please try again in a few minutes.",
        502,
        e
      );
    }

    throw new ApiError(
      `Failed to submit PixVerse T2V job: ${errorMessage}`,
      502,
      e
    );
  }
  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);
  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

export async function pixverseI2vSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError("prompt is required", 400);
  if (!body?.image) throw new ApiError("image is required", 400);
  const replicate = ensureReplicate();
  const modelBase =
    body.model && String(body.model).length > 0
      ? String(body.model)
      : "pixverseai/pixverse-v5";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const s = String(body?.duration ?? "5").toLowerCase();
    const m = s.match(/(5|8)/);
    return m ? Number(m[1]) : 5;
  })();
  const quality = ((): string => {
    const q = String(body?.quality ?? body?.resolution ?? "720p").toLowerCase();
    const m = q.match(/(360|540|720|1080)/);
    return m ? `${m[1]}p` : "720p";
  })();

  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "image-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: quality as any,
    quality: quality as any, // Store quality separately for PixVerse pricing
  } as any);

  // Persist input image to history so preview shows uploads
  try {
    const username = creator?.username || uid;
    const keyPrefix = `users/${username}/input/${historyId}`;
    const src = String(body.image);
    if (src && src.length > 0) {
      const stored = /^data:/i.test(src)
        ? await uploadDataUriToZata({ dataUri: src, keyPrefix, fileName: 'input-1' })
        : await uploadFromUrlToZata({ sourceUrl: src, keyPrefix, fileName: 'input-1' });
      await generationHistoryRepository.update(uid, historyId, { inputImages: [{ id: 'in-1', url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: src }] } as any);
    }
  } catch { }

  const input: any = {
    prompt: body.prompt,
    image: String(body.image),
    duration: durationSec,
    quality,
    aspect_ratio: ((): string => {
      const a = String(body?.aspect_ratio ?? "16:9");
      return ["16:9", "9:16", "1:1"].includes(a) ? a : "16:9";
    })(),
  };
  if (body.seed != null && Number.isInteger(Number(body.seed)))
    input.seed = Number(body.seed);
  if (body.negative_prompt != null)
    input.negative_prompt = String(body.negative_prompt);

  let predictionId = "";
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    const pred = await replicate.predictions.create(
      version ? { version, input } : { model: modelBase, input }
    );
    predictionId = (pred as any)?.id || "";
    if (!predictionId) throw new Error("Missing prediction id");
  } catch (e: any) {
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: e?.message || "Replicate submit failed",
    } as any);
    throw new ApiError("Failed to submit PixVerse I2V job", 502, e);
  }
  await generationHistoryRepository.update(uid, historyId, {
    provider: "replicate",
    providerTaskId: predictionId,
  } as any);
  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: "submitted",
  };
}

Object.assign(replicateService, { pixverseT2vSubmit, pixverseI2vSubmit });


