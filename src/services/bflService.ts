import {
  BflGenerateRequest,
  BflGenerateResponse,
  GeneratedImage,
  FrameSize,
} from "../types/bfl";
import { ApiError } from "../utils/errorHandler";
import { ALLOWED_MODELS } from "../middlewares/validators/bfl/validateBflGenerate";
import { bflRepository } from "../repository/bflRepository";
import { bflutils } from "../utils/bflutils";
import axios from "axios";
import { generationHistoryRepository } from "../repository/generationHistoryRepository";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import { authRepository } from "../repository/auth/authRepository";
import { GenerationHistoryItem } from "../types/generate";
import { uploadFromUrlToZata, uploadDataUriToZata } from "../utils/storage/zataUpload";
import { env } from "../config/env";
import sharp from "sharp";
import { syncToMirror, updateMirror } from "../utils/mirrorHelper";
import { aestheticScoreService } from "./aestheticScoreService";
import { publicVisibilityEnforcer } from "../utils/publicVisibilityEnforcer";
import { markGenerationCompleted } from "./generationHistoryService";

// Normalize input (URL | data URI | raw base64) to a base64 string without a data URI prefix
// Returns base64 plus metadata (mime, width, height)
async function normalizeToBase64(src: string): Promise<{ base64: string; mime?: string; width?: number; height?: number }> {
  if (!src || typeof src !== "string") {
    throw new ApiError("image/mask must be a non-empty string", 400);
  }
  let buf: Buffer | undefined;
  let inferredMime: string | undefined;

  const trimmed = src.trim();

  // Attempt strict data URI parse first
  const dataUriMatch = /^data:([^;]+);base64,(.*)$/i.exec(trimmed);
  if (dataUriMatch) {
    inferredMime = dataUriMatch[1];
    const b64 = dataUriMatch[2];
    try {
      buf = Buffer.from(b64, "base64");
      if (!buf || buf.length === 0) throw new Error("empty buffer");
    } catch {
      throw new ApiError("Invalid base64 data URI provided", 400);
    }
  }

  // If not a strict data URI, maybe it's a URL to fetch
  if (!buf && /^https?:\/\//i.test(trimmed)) {
    try {
      const resp = await axios.get(trimmed, { responseType: "arraybuffer", validateStatus: () => true });
      if (resp.status < 200 || resp.status >= 300) {
        throw new ApiError(`Failed to download image: HTTP ${resp.status}`, resp.status);
      }
      buf = Buffer.from(resp.data as ArrayBuffer);
      if (!buf || buf.length === 0) throw new ApiError("Downloaded image is empty", 400);
      // Try to infer mime from response headers
      const ct = (resp.headers && (resp.headers["content-type"] || resp.headers["Content-Type"])) as string | undefined;
      if (ct) inferredMime = ct.split(";")[0];
    } catch (e: any) {
      const msg = e?.message || "Failed to fetch image for base64 conversion";
      throw new ApiError(msg, 400);
    }
  }

  // If still not buffer, assume raw base64 or a malformed data URI: try to salvage base64 substring
  if (!buf) {
    // If string contains 'base64,' take the substring after the last comma
    const maybeAfterComma = trimmed.includes(",") ? trimmed.substring(trimmed.lastIndexOf(",") + 1) : trimmed;
    // Extract longest base64-like substring (allow padding =)
    const b64match = /([A-Za-z0-9+/=\-_]{64,})/.exec(maybeAfterComma.replace(/\s+/g, ""));
    const candidate = b64match ? b64match[1] : maybeAfterComma.replace(/\s+/g, "");
    try {
      const candidateBuf = Buffer.from(candidate, "base64");
      if (!candidateBuf || candidateBuf.length === 0) throw new Error("empty buffer");
      buf = candidateBuf;
    } catch {
      throw new ApiError("Invalid base64 encoding for image/mask", 400);
    }
  }

  // Use sharp to probe image metadata (mime, width, height) when possible
  try {
    const meta = await sharp(buf).metadata();
    if (meta && meta.format) {
      inferredMime = inferredMime || `image/${meta.format}`;
    }
    const width = meta.width;
    const height = meta.height;
    return { base64: buf.toString("base64"), mime: inferredMime, width, height };
  } catch (e) {
    // Not an image or sharp failed -> still return the base64 so provider can decide
    return { base64: buf.toString("base64"), mime: inferredMime };
  }
}

async function pollForResults(
  pollingUrl: string,
  apiKey: string
): Promise<string> {
  const intervalMs = env.bflPollIntervalMs ?? 1000; // default 1s
  const maxLoops = env.bflPollMaxLoops ?? 180; // default ~3 minutes
  for (let i = 0; i < maxLoops; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const pollResponse = await axios.get(pollingUrl, {
      headers: { accept: "application/json", "x-key": apiKey },
      validateStatus: () => true,
    });
    if (pollResponse.status < 200 || pollResponse.status >= 300) {
      let errorPayload: any = undefined;
      try {
        errorPayload = pollResponse.data;
      } catch (_) {
        try {
          const text = String(pollResponse.data);
          errorPayload = { message: text };
        } catch {}
      }
      const reason =
        (errorPayload && (errorPayload.message || errorPayload.error)) ||
        "Unknown error";
      throw new ApiError(
        `Polling failed: ${reason}`,
        pollResponse.status,
        errorPayload
      );
    }
    const result = pollResponse.data;
    if (result.status === "Ready") {
      return result.result.sample as string;
    }
    if (result.status === "Error" || result.status === "Failed") {
      throw new ApiError("Generation failed", 500, result);
    }
  }
  throw new ApiError("Timeout waiting for image generation", 504);
}

async function generate(
  uid: string,
  payload: BflGenerateRequest
): Promise<BflGenerateResponse & { historyId?: string }> {
  const {
    prompt,
    model,
    n = 1,
    frameSize = "1:1",
    uploadedImages: inputImages = [],
    width,
    height,
    generationType,
    tags,
    nsfw,
    visibility,
    isPublic,
  } = payload;

  const apiKey = env.bflApiKey as string;
  if (!apiKey) throw new ApiError("API key not configured", 500);
  if (!prompt) throw new ApiError("Prompt is required", 400);
  if (!ALLOWED_MODELS.includes(model))
    throw new ApiError("Unsupported model", 400);

  // Enforce public visibility for free plan users
  const { isPublic: enforcedIsPublic, visibility: enforcedVisibility } = 
    await publicVisibilityEnforcer.enforcePublicVisibility(uid, isPublic);

  // create legacy generation record (existing repo)
  const creator = await authRepository.getUserById(uid);
  console.log("creator", creator);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  const legacyId = await bflRepository.createGenerationRecord(
    { ...payload, isPublic: enforcedIsPublic },
    createdBy
  );
  // create authoritative history first
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt,
    model,
    generationType: (payload as any).generationType || "text-to-image",
    visibility: enforcedVisibility,
    tags: (payload as any).tags,
    nsfw: (payload as any).nsfw,
    isPublic: enforcedIsPublic,
    createdBy,
  });
  const imageFileNameForIndex = (index: number) => {
    if (historyId) {
      return `${historyId}-image-${index + 1}`;
    }
    return `image-${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 6)}`;
  };

  // Persist user uploaded input images (if any)
  try {
    const username = creator?.username || uid;
    const keyPrefix = `users/${username}/input/${historyId}`;
    const inputPersisted: any[] = [];
    let idx = 0;
    for (const src of (inputImages || [])) {
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
    }
  } catch {}

  try {
    const imagePromises = Array.from({ length: n }, async () => {
      const normalizedModel = (model as string)
        .toLowerCase()
        .replace(/\s+/g, "-");
      const endpoint = `https://api.bfl.ai/v1/${normalizedModel}`;

      let body: any = { prompt };
      if (normalizedModel.includes("kontext")) {
        body.aspect_ratio = frameSize;
        body.output_format = (payload as any).output_format || "png";
        if ((payload as any).prompt_upsampling !== undefined)
          body.prompt_upsampling = (payload as any).prompt_upsampling;
        if (Array.isArray(inputImages) && inputImages.length > 0) {
          const [img1, img2, img3, img4] = inputImages;
          if (img1) body.input_image = img1;
          if (img2) body.input_image_2 = img2;
          if (img3) body.input_image_3 = img3;
          if (img4) body.input_image_4 = img4;
        }
      } else if (
        normalizedModel === "flux-pro" ||
        normalizedModel === "flux-pro-1.1" ||
        normalizedModel === "flux-pro-1.1-ultra"
      ) {
        if (width && height) {
          body.width = width;
          body.height = height;
        } else {
          const { width: convertedWidth, height: convertedHeight } =
            bflutils.getDimensions(frameSize as FrameSize);
          body.width = convertedWidth;
          body.height = convertedHeight;
        }
        body.output_format = (payload as any).output_format || "jpeg";
        if ((payload as any).prompt_upsampling !== undefined)
          body.prompt_upsampling = (payload as any).prompt_upsampling;
      } else if (normalizedModel === "flux-dev") {
        const { width: convertedWidth, height: convertedHeight } =
          bflutils.getDimensions(frameSize as FrameSize);
        body.width = convertedWidth;
        body.height = convertedHeight;
        body.output_format = (payload as any).output_format || "jpeg";
        if ((payload as any).prompt_upsampling !== undefined)
          body.prompt_upsampling = (payload as any).prompt_upsampling;
      } else {
        body.aspect_ratio = frameSize;
        body.output_format = (payload as any).output_format || "jpeg";
        if ((payload as any).prompt_upsampling !== undefined)
          body.prompt_upsampling = (payload as any).prompt_upsampling;
      }

      const response = await axios.post(endpoint, body, {
        headers: {
          accept: "application/json",
          "x-key": apiKey,
          "Content-Type": "application/json",
        },
        validateStatus: () => true,
      });
      if (response.status < 200 || response.status >= 300) {
        let errorPayload: any = undefined;
        try {
          errorPayload = response.data;
        } catch (_) {
          try {
            const text = String(response.data);
            errorPayload = { message: text };
          } catch {}
        }
        
        // Enhanced error logging for 403 Forbidden
        if (response.status === 403) {
          console.error(`[BFL Service] 403 Forbidden Error Details:`, {
            endpoint,
            model: normalizedModel,
            apiKeyPresent: !!apiKey,
            apiKeyLength: apiKey?.length || 0,
            apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : 'missing',
            errorPayload,
            responseHeaders: response.headers,
          });
        }
        
        const reason =
          (errorPayload && (errorPayload.message || errorPayload.error || errorPayload.detail)) ||
          (response.status === 403 
            ? "API key may be invalid, expired, or lacks access to this model. Please check your BFL_API_KEY environment variable."
            : "Unknown error");
        throw new ApiError(
          `Failed to initiate image generation: ${reason}`,
          response.status,
          errorPayload
        );
      }
      const data = response.data;
      if (!data.polling_url) throw new ApiError("No polling URL received", 502);

      const imageUrl = await pollForResults(data.polling_url, apiKey);
      return {
        url: imageUrl,
        originalUrl: imageUrl,
        id: data.id as string,
      } as GeneratedImage;
    });

    const images = await Promise.all(imagePromises);

    // Upload provider images to Zata and keep both links
    const storedImages = await Promise.all(
      images.map(async (img, index) => {
        try {
          const { key, publicUrl } = await uploadFromUrlToZata({
            sourceUrl: img.url,
            // Allow canvas override to avoid duplicate storage paths
            keyPrefix: (payload as any)?.storageKeyPrefixOverride || `users/${
              (await authRepository.getUserById(uid))?.username || uid
            }/image/${historyId}`,
            fileName: imageFileNameForIndex(index),
          });
          return {
            id: img.id,
            url: publicUrl,
            storagePath: key,
            originalUrl: img.originalUrl || img.url,
          };
        } catch (e: any) {
          // Soft fallback: continue with provider URL if Zata fails
          // eslint-disable-next-line no-console
          console.warn("[BFL] Zata upload failed, falling back to provider URL:", e?.message || e);
          return {
            id: img.id,
            url: img.url,
            originalUrl: img.originalUrl || img.url,
          } as any;
        }
      })
    );

    // Score the images for aesthetic quality
    const scoredImages = await aestheticScoreService.scoreImages(storedImages);
    const highestScore = aestheticScoreService.getHighestScore(scoredImages);

    // Clean images array to remove undefined aestheticScore values
    const cleanedImages = scoredImages.map(img => {
      const { aestheticScore, ...rest } = img as any;
      return aestheticScore !== undefined ? { ...rest, aestheticScore } : rest;
    });

    await bflRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      images: cleanedImages as any, // BFL repo uses older GeneratedImage type
      frameSize,
    });
    // update authoritative history and mirror with aesthetic scores
    // Only include aestheticScore if it's not undefined
    const updateData: any = {
      status: "completed",
      images: cleanedImages,
      // persist optional fields
      ...(frameSize ? { frameSize: frameSize as any } : {}),
    };
    if (highestScore !== undefined) {
      updateData.aestheticScore = highestScore;
    }
    
    await generationHistoryRepository.update(uid, historyId, updateData as Partial<GenerationHistoryItem>);
    
    // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
    markGenerationCompleted(uid, historyId, {
      status: "completed",
      images: scoredImages,
    }).catch(err => console.error('[BFL] Image optimization failed:', err));
    
    // Robust mirror sync with retry logic
    await syncToMirror(uid, historyId);
    const returnData: any = {
      historyId,
      prompt,
      model,
      generationType: (payload as any).generationType || "text-to-image",
      visibility: enforcedVisibility,
      isPublic: enforcedIsPublic,
      createdBy,
      images: cleanedImages,
      status: "completed",
    };
    if (highestScore !== undefined) {
      returnData.aestheticScore = highestScore;
    }
    return returnData as any;
  } catch (err: any) {
    const message = err?.message || "Failed to generate images";
    // eslint-disable-next-line no-console
    console.error("[BFL] Generation error:", message, err?.data || "");
    await bflRepository.updateGenerationRecord(legacyId, {
      status: "failed",
      error: message,
    });
    // Update history and mirror with error state
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: message,
    } as any);
    await updateMirror(uid, historyId, { status: "failed" as any, error: message });
    throw err;
  }
}

async function fill(uid: string, body: any) {
  const apiKey = env.bflApiKey as string;
  if (!apiKey) throw new ApiError("API key not configured", 500);
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  const endpoint = `https://api.bfl.ai/v1/flux-pro-1.0-fill`;
  // Normalize inputs to pure base64 strings as required by BFL Fill API
  const normalizedPayload: any = { ...body };
  try {
    if (!body?.image) throw new ApiError("image is required", 400);
    const imgNorm = await normalizeToBase64(body.image);
    normalizedPayload.image = imgNorm.base64;
    // If mask provided, normalize and validate dimensions if available
    if (body?.mask) {
      const maskNorm = await normalizeToBase64(body.mask);
      // If we have dimensions for both, ensure they match
      if (imgNorm.width && imgNorm.height && maskNorm.width && maskNorm.height) {
        if (imgNorm.width !== maskNorm.width || imgNorm.height !== maskNorm.height) {
          throw new ApiError(
            `Mask dimensions (${maskNorm.width}x${maskNorm.height}) do not match image dimensions (${imgNorm.width}x${imgNorm.height})`,
            400
          );
        }
      }
      normalizedPayload.mask = maskNorm.base64;
    }
  } catch (err) {
    // Surface validation/normalization errors clearly
    throw err;
  }
  const response = await axios.post(endpoint, normalizedPayload, {
    headers: {
      accept: "application/json",
      "x-key": apiKey,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300)
    throw new ApiError("Failed to start fill", response.status, response.data);
  const { polling_url, id } = response.data || {};
  if (!polling_url) throw new ApiError("No polling URL received", 502);
  const imageUrl = await pollForResults(polling_url, apiKey);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body?.prompt || "",
    model: "flux-pro-1.0-fill",
    generationType: body?.generationType || "text-to-image",
    visibility: "private",
    isPublic: body?.isPublic === true,
    createdBy,
  } as any);
  const { key, publicUrl } = await uploadFromUrlToZata({
    sourceUrl: imageUrl,
    keyPrefix: `users/${
      (await authRepository.getUserById(uid))?.username || uid
    }/image/${historyId}`,
    fileName: "image-1",
  });

  const images = [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }];
  const scoredImages = await aestheticScoreService.scoreImages(images);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);

  // Clean images array to remove undefined aestheticScore values
  const cleanedImages = scoredImages.map(img => {
    const { aestheticScore, ...rest } = img as any;
    return aestheticScore !== undefined ? { ...rest, aestheticScore } : rest;
  });

  const updateData: any = {
    status: "completed",
    images: scoredImages,
    aestheticScore: highestScore,
  } as any);
  // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
  try {
    console.log('[BFL.fill] Triggering markGenerationCompleted for optimization', { uid, historyId });
    markGenerationCompleted(uid, historyId, {
      status: 'completed',
      images: scoredImages,
    }).catch(err => console.error('[BFL.fill] Image optimization failed:', err));
  } catch (optErr) {
    console.warn('[BFL.fill] markGenerationCompleted invocation error:', optErr);
  }
  // Robust mirror sync with retry logic
  await syncToMirror(uid, historyId);
  const returnData: any = {
    historyId,
    prompt: body?.prompt || "",
    model: "flux-pro-1.0-fill",
    generationType: body?.generationType || "text-to-image",
    visibility: "private",
    isPublic: body?.isPublic === true,
    createdBy,
    images: cleanedImages,
    status: "completed",
  };
  if (highestScore !== undefined) {
    returnData.aestheticScore = highestScore;
  }
  return returnData as any;
}

async function expand(uid: string, body: any) {
  const apiKey = env.bflApiKey as string;
  if (!apiKey) throw new ApiError("API key not configured", 500);
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  const endpoint = `https://api.bfl.ai/v1/flux-pro-1.0-expand`;
  const response = await axios.post(endpoint, body, {
    headers: {
      accept: "application/json",
      "x-key": apiKey,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300)
    throw new ApiError(
      "Failed to start expand",
      response.status,
      response.data
    );
  const { polling_url, id } = response.data || {};
  if (!polling_url) throw new ApiError("No polling URL received", 502);
  const imageUrl = await pollForResults(polling_url, apiKey);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body?.prompt || "",
    model: "flux-pro-1.0-expand",
    generationType: body?.generationType || "text-to-image",
    visibility: "private",
    isPublic: body?.isPublic === true,
    createdBy,
  } as any);
  const { key, publicUrl } = await uploadFromUrlToZata({
    sourceUrl: imageUrl,
    keyPrefix: `users/${
      (await authRepository.getUserById(uid))?.username || uid
    }/image/${historyId}`,
    fileName: "image-1",
  });

  const images = [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }];
  const scoredImages = await aestheticScoreService.scoreImages(images);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);

  // Clean images array to remove undefined aestheticScore values
  const cleanedImages = scoredImages.map(img => {
    const { aestheticScore, ...rest } = img as any;
    return aestheticScore !== undefined ? { ...rest, aestheticScore } : rest;
  });

  const updateData: any = {
    status: "completed",
    images: scoredImages,
    aestheticScore: highestScore,
  } as any);
  // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
  try {
    console.log('[BFL.expand] Triggering markGenerationCompleted for optimization', { uid, historyId });
    markGenerationCompleted(uid, historyId, {
      status: 'completed',
      images: scoredImages,
    }).catch(err => console.error('[BFL.expand] Image optimization failed:', err));
  } catch (optErr) {
    console.warn('[BFL.expand] markGenerationCompleted invocation error:', optErr);
  }
  // Robust mirror sync with retry logic
  await syncToMirror(uid, historyId);
  const returnData: any = {
    historyId,
    prompt: body?.prompt || "",
    model: "flux-pro-1.0-expand",
    generationType: body?.generationType || "text-to-image",
    visibility: "private",
    isPublic: body?.isPublic === true,
    createdBy,
    images: cleanedImages,
    status: "completed",
  };
  if (highestScore !== undefined) {
    returnData.aestheticScore = highestScore;
  }
  return returnData as any;
}

async function canny(uid: string, body: any) {
  const apiKey = env.bflApiKey as string;
  if (!apiKey) throw new ApiError("API key not configured", 500);
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  const endpoint = `https://api.bfl.ai/v1/flux-pro-1.0-canny`;
  const response = await axios.post(endpoint, body, {
    headers: {
      accept: "application/json",
      "x-key": apiKey,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300)
    throw new ApiError("Failed to start canny", response.status, response.data);
  const { polling_url, id } = response.data || {};
  if (!polling_url) throw new ApiError("No polling URL received", 502);
  const imageUrl = await pollForResults(polling_url, apiKey);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body?.prompt || "",
    model: "flux-pro-1.0-canny",
    generationType: body?.generationType || "text-to-image",
    visibility: "private",
    isPublic: body?.isPublic === true,
    createdBy,
  } as any);
  const { key, publicUrl } = await uploadFromUrlToZata({
    sourceUrl: imageUrl,
    keyPrefix: `users/${
      (await authRepository.getUserById(uid))?.username || uid
    }/image/${historyId}`,
    fileName: "image-1",
  });

  const images = [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }];
  const scoredImages = await aestheticScoreService.scoreImages(images);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);

  // Clean images array to remove undefined aestheticScore values
  const cleanedImages = scoredImages.map(img => {
    const { aestheticScore, ...rest } = img as any;
    return aestheticScore !== undefined ? { ...rest, aestheticScore } : rest;
  });

  const updateData: any = {
    status: "completed",
    images: scoredImages,
    aestheticScore: highestScore,
  } as any);
  // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
  try {
    console.log('[BFL.canny] Triggering markGenerationCompleted for optimization', { uid, historyId });
    markGenerationCompleted(uid, historyId, {
      status: 'completed',
      images: scoredImages,
    }).catch(err => console.error('[BFL.canny] Image optimization failed:', err));
  } catch (optErr) {
    console.warn('[BFL.canny] markGenerationCompleted invocation error:', optErr);
  }
  // Robust mirror sync with retry logic
  await syncToMirror(uid, historyId);
  const returnData: any = {
    historyId,
    prompt: body?.prompt || "",
    model: "flux-pro-1.0-canny",
    generationType: body?.generationType || "text-to-image",
    visibility: "private",
    isPublic: body?.isPublic === true,
    createdBy,
    images: cleanedImages,
    status: "completed",
  };
  if (highestScore !== undefined) {
    returnData.aestheticScore = highestScore;
  }
  return returnData as any;
}

async function depth(uid: string, body: any) {
  const apiKey = env.bflApiKey as string;
  if (!apiKey) throw new ApiError("API key not configured", 500);
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  const endpoint = `https://api.bfl.ai/v1/flux-pro-1.0-depth`;
  const response = await axios.post(endpoint, body, {
    headers: {
      accept: "application/json",
      "x-key": apiKey,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300)
    throw new ApiError("Failed to start depth", response.status, response.data);
  const { polling_url, id } = response.data || {};
  if (!polling_url) throw new ApiError("No polling URL received", 502);
  const imageUrl = await pollForResults(polling_url, apiKey);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body?.prompt || "",
    model: "flux-pro-1.0-depth",
    generationType: body?.generationType || "text-to-image",
    visibility: "private",
    isPublic: body?.isPublic === true,
    createdBy,
  } as any);
  const { key, publicUrl } = await uploadFromUrlToZata({
    sourceUrl: imageUrl,
    keyPrefix: `users/${
      (await authRepository.getUserById(uid))?.username || uid
    }/image/${historyId}`,
    fileName: "image-1",
  });

  const images = [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }];
  const scoredImages = await aestheticScoreService.scoreImages(images);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);

  // Clean images array to remove undefined aestheticScore values
  const cleanedImages = scoredImages.map(img => {
    const { aestheticScore, ...rest } = img as any;
    return aestheticScore !== undefined ? { ...rest, aestheticScore } : rest;
  });

  const updateData: any = {
    status: "completed",
    images: scoredImages,
    aestheticScore: highestScore,
  } as any);
  // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
  try {
    console.log('[BFL.depth] Triggering markGenerationCompleted for optimization', { uid, historyId });
    markGenerationCompleted(uid, historyId, {
      status: 'completed',
      images: scoredImages,
    }).catch(err => console.error('[BFL.depth] Image optimization failed:', err));
  } catch (optErr) {
    console.warn('[BFL.depth] markGenerationCompleted invocation error:', optErr);
  }
  // Robust mirror sync with retry logic
  await syncToMirror(uid, historyId);
  const returnData: any = {
    historyId,
    prompt: body?.prompt || "",
    model: "flux-pro-1.0-depth",
    generationType: body?.generationType || "text-to-image",
    visibility: "private",
    isPublic: body?.isPublic === true,
    createdBy,
    images: cleanedImages,
    status: "completed",
  };
  if (highestScore !== undefined) {
    returnData.aestheticScore = highestScore;
  }
  return returnData as any;
}

// Expansion using FLUX Fill - generates mask from expansion margins
async function expandWithFill(uid: string, body: any) {
  const apiKey = env.bflApiKey as string;
  if (!apiKey) throw new ApiError("API key not configured", 500);
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  
  if (!body?.image) throw new ApiError("image is required", 400);
  if (!body?.canvas_size || !Array.isArray(body.canvas_size) || body.canvas_size.length !== 2) {
    throw new ApiError("canvas_size [width, height] is required", 400);
  }
  if (!body?.original_image_size || !Array.isArray(body.original_image_size) || body.original_image_size.length !== 2) {
    throw new ApiError("original_image_size [width, height] is required", 400);
  }
  
  const canvasW = Number(body.canvas_size[0]);
  const canvasH = Number(body.canvas_size[1]);
  const origW = Number(body.original_image_size[0]);
  const origH = Number(body.original_image_size[1]);
  const origX = Number(body.original_image_location?.[0] || 0);
  const origY = Number(body.original_image_location?.[1] || 0);
  
  if (canvasW <= 0 || canvasH <= 0 || origW <= 0 || origH <= 0) {
    throw new ApiError("Invalid canvas or original image dimensions", 400);
  }
  
  // Normalize image to base64
  const imgNorm = await normalizeToBase64(body.image);
  if (!imgNorm.width || !imgNorm.height) {
    throw new ApiError("Could not determine image dimensions", 400);
  }
  
  // Create expanded canvas with original image placed at specified position
  // Then generate mask: white for expansion areas, black for original image
  const imgBuffer = Buffer.from(imgNorm.base64, "base64");
  
  // Create expanded canvas with transparent background
  const expandedCanvasBuffer = Buffer.alloc(canvasW * canvasH * 4); // RGBA
  expandedCanvasBuffer.fill(0); // Transparent black
  
  const expandedCanvas = await sharp(expandedCanvasBuffer, {
    raw: {
      width: canvasW,
      height: canvasH,
      channels: 4
    }
  })
    .composite([
      {
        input: imgBuffer,
        left: origX,
        top: origY,
      }
    ])
    .png()
    .toBuffer();
  
  // Generate mask: white (255) for expansion areas, black (0) for original image area
  // Create a white canvas for the mask (all areas to fill)
  const whiteCanvasBuffer = Buffer.alloc(canvasW * canvasH);
  whiteCanvasBuffer.fill(255); // White = fill area
  
  // Create a black rectangle for the original image area (keep original)
  const blackRectBuffer = Buffer.alloc(origW * origH);
  blackRectBuffer.fill(0); // Black = keep original
  
  // Composite the black rectangle onto the white canvas at the original image position
  const maskBuffer = await sharp(whiteCanvasBuffer, {
    raw: {
      width: canvasW,
      height: canvasH,
      channels: 1
    }
  })
    .composite([
      {
        input: await sharp(blackRectBuffer, {
          raw: {
            width: origW,
            height: origH,
            channels: 1
          }
        }).png().toBuffer(),
        left: origX,
        top: origY,
      }
    ])
    .png()
    .toBuffer();
  
  const expandedBase64 = expandedCanvas.toString("base64");
  const maskBase64 = maskBuffer.toString("base64");
  
  // Call FLUX Fill API
  const endpoint = `https://api.bfl.ai/v1/flux-pro-1.0-fill`;
  const normalizedPayload: any = {
    image: expandedBase64,
    mask: maskBase64,
    prompt: body?.prompt || "",
    steps: body?.steps || 50,
    prompt_upsampling: body?.prompt_upsampling ?? false,
    seed: body?.seed,
    guidance: body?.guidance || 60,
    output_format: body?.output_format || "jpeg",
    safety_tolerance: body?.safety_tolerance ?? 2,
  };
  
  const response = await axios.post(endpoint, normalizedPayload, {
    headers: {
      accept: "application/json",
      "x-key": apiKey,
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
  
  if (response.status < 200 || response.status >= 300)
    throw new ApiError("Failed to start fill expansion", response.status, response.data);
  
  const { polling_url, id } = response.data || {};
  if (!polling_url) throw new ApiError("No polling URL received", 502);
  const imageUrl = await pollForResults(polling_url, apiKey);
  
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body?.prompt || "FLUX Fill Expansion",
    model: "flux-pro-1.0-fill",
    generationType: "image-outpaint",
    visibility: body?.isPublic === true ? "public" : "private",
    isPublic: body?.isPublic === true,
    createdBy,
  } as any);
  
  const { key, publicUrl } = await uploadFromUrlToZata({
    sourceUrl: imageUrl,
    keyPrefix: `users/${creator?.username || uid}/image/${historyId}`,
    fileName: "image-1",
  });

  const images = [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }];
  const scoredImages = await aestheticScoreService.scoreImages(images);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);
  
  // Clean images array to remove undefined aestheticScore values
  const cleanedImages = scoredImages.map(img => {
    const { aestheticScore, ...rest } = img as any;
    return aestheticScore !== undefined ? { ...rest, aestheticScore } : rest;
  });

  const updateData: any = {
    status: "completed",
    images: scoredImages,
    aestheticScore: highestScore,
  } as any);
  // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
  try {
    console.log('[BFL.expandWithFill] Triggering markGenerationCompleted for optimization', { uid, historyId });
    markGenerationCompleted(uid, historyId, {
      status: 'completed',
      images: scoredImages,
    }).catch(err => console.error('[BFL.expandWithFill] Image optimization failed:', err));
  } catch (optErr) {
    console.warn('[BFL.expandWithFill] markGenerationCompleted invocation error:', optErr);
  }
  
  // Robust mirror sync with retry logic
  await syncToMirror(uid, historyId);
  
  const returnData: any = {
    historyId,
    prompt: body?.prompt || "FLUX Fill Expansion",
    model: "flux-pro-1.0-fill",
    generationType: "image-outpaint",
    visibility: body?.isPublic === true ? "public" : "private",
    isPublic: body?.isPublic === true,
    createdBy,
    images: cleanedImages,
    status: "completed",
  };
  if (highestScore !== undefined) {
    returnData.aestheticScore = highestScore;
  }
  return returnData as any;
}

export const bflService = {
  generate,
  pollForResults,
  fill,
  expand,
  expandWithFill,
  canny,
  depth,
};
