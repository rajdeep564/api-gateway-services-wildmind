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

  // create legacy generation record (existing repo)
  const creator = await authRepository.getUserById(uid);
  console.log("creator", creator);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  const legacyId = await bflRepository.createGenerationRecord(
    { ...payload, isPublic: (payload as any).isPublic === true },
    createdBy
  );
  // create authoritative history first
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt,
    model,
    generationType: (payload as any).generationType || "text-to-image",
    visibility: (payload as any).visibility || "private",
    tags: (payload as any).tags,
    nsfw: (payload as any).nsfw,
    isPublic: (payload as any).isPublic === true,
    createdBy,
  });

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
        const reason =
          (errorPayload && (errorPayload.message || errorPayload.error)) ||
          "Unknown error";
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
            // Username-scoped minimal layout
            keyPrefix: `users/${
              (await authRepository.getUserById(uid))?.username || uid
            }/image/${historyId}`,
            fileName: `image-${index + 1}`,
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
    await bflRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      images: storedImages,
      frameSize,
    });
    // update authoritative history and mirror
    await generationHistoryRepository.update(uid, historyId, {
      status: "completed",
      images: storedImages,
      // persist optional fields
      ...(frameSize ? { frameSize: frameSize as any } : {}),
    } as Partial<GenerationHistoryItem>);
    try {
      const creator = await authRepository.getUserById(uid);
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) {
        await generationsMirrorRepository.upsertFromHistory(
          uid,
          historyId,
          fresh,
          {
            uid,
            username: creator?.username,
            displayName: (creator as any)?.displayName,
            photoURL: creator?.photoURL,
          }
        );
      }
    } catch {}
    return {
      historyId,
      prompt,
      model,
      generationType: (payload as any).generationType || "text-to-image",
      visibility: (payload as any).visibility || "private",
      isPublic: (payload as any).isPublic === true,
      createdBy,
      images: storedImages,
      status: "completed",
    } as any;
  } catch (err: any) {
    const message = err?.message || "Failed to generate images";
    // eslint-disable-next-line no-console
    console.error("[BFL] Generation error:", message, err?.data || "");
    await bflRepository.updateGenerationRecord(legacyId, {
      status: "failed",
      error: message,
    });
    try {
      await generationHistoryRepository.update(uid, historyId, {
        status: "failed",
        error: message,
      } as any);
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) {
        await generationsMirrorRepository.updateFromHistory(
          uid,
          historyId,
          fresh
        );
      }
    } catch {}
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
  await generationHistoryRepository.update(uid, historyId, {
    status: "completed",
    images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
  } as any);
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh)
      await generationsMirrorRepository.upsertFromHistory(
        uid,
        historyId,
        fresh,
        { uid, username: (await authRepository.getUserById(uid))?.username }
      );
  } catch {}
  return {
    historyId,
    prompt: body?.prompt || "",
    model: "flux-pro-1.0-fill",
    generationType: body?.generationType || "text-to-image",
    visibility: "private",
    isPublic: body?.isPublic === true,
    createdBy,
      images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
      status: "completed",
    } as any;
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
  await generationHistoryRepository.update(uid, historyId, {
    status: "completed",
    images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
  } as any);
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh)
      await generationsMirrorRepository.upsertFromHistory(
        uid,
        historyId,
        fresh,
        { uid, username: (await authRepository.getUserById(uid))?.username }
      );
  } catch {}
  return {
    historyId,
    prompt: body?.prompt || "",
    model: "flux-pro-1.0-expand",
    generationType: body?.generationType || "text-to-image",
      visibility: "private",
    isPublic: body?.isPublic === true,
      createdBy,
      images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
      status: "completed",
    } as any;
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
  await generationHistoryRepository.update(uid, historyId, {
    status: "completed",
    images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
  } as any);
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh)
      await generationsMirrorRepository.upsertFromHistory(
        uid,
        historyId,
        fresh,
        { uid, username: (await authRepository.getUserById(uid))?.username }
      );
  } catch {}
  return {
    historyId,
    prompt: body?.prompt || "",
    model: "flux-pro-1.0-canny",
    generationType: body?.generationType || "text-to-image",
      visibility: "private",
    isPublic: body?.isPublic === true,
      createdBy,
      images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
      status: "completed",
    } as any;
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
  await generationHistoryRepository.update(uid, historyId, {
    status: "completed",
    images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
  } as any);
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh)
      await generationsMirrorRepository.upsertFromHistory(
        uid,
        historyId,
        fresh,
        { uid, username: (await authRepository.getUserById(uid))?.username }
      );
  } catch {}
  return {
    historyId,
    prompt: body?.prompt || "",
    model: "flux-pro-1.0-depth",
    generationType: body?.generationType || "text-to-image",
      visibility: "private",
    isPublic: body?.isPublic === true,
      createdBy,
      images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
      status: "completed",
    } as any;
}

export const bflService = {
  generate,
  pollForResults,
  fill,
  expand,
  canny,
  depth,
};
