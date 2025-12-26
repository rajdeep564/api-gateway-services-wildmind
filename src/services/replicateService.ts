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

const DEFAULT_BG_MODEL_A =
  "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";
const DEFAULT_BG_MODEL_B =
  "lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1";

// Version map for community models that require explicit version hashes
const DEFAULT_VERSION_BY_MODEL: Record<string, string> = {
  "fermatresearch/magic-image-refiner":
    "507ddf6f977a7e30e46c0daefd30de7d563c72322f9e4cf7cbac52ef0f667b13",
  "philz1337x/clarity-upscaler":
    "dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e",
  "851-labs/background-remover":
    "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
  "lucataco/remove-bg":
    "95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1",
  "nightmareai/real-esrgan":
    "f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa",
  "mv-lab/swin2sr":
    "a01b0512004918ca55d02e554914a9eca63909fa83a29ff0f115c78a7045574f",
  "prunaai/z-image-turbo":
    "7ea16386290ff5977c7812e66e462d7ec3954d8e007a8cd18ded3e7d41f5d7cf",
};

function composeModelSpec(modelBase: string, maybeVersion?: string): string {
  const version = maybeVersion || DEFAULT_VERSION_BY_MODEL[modelBase];
  return version ? `${modelBase}:${version}` : modelBase;
}

function clamp(n: any, min: number, max: number): number {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}

async function downloadToDataUri(
  sourceUrl: string
): Promise<{ dataUri: string; ext: string } | null> {
  try {
    const res = await fetch(sourceUrl as any);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const ext =
      contentType.includes("jpeg") || contentType.includes("jpg")
        ? "jpg"
        : contentType.includes("webp")
          ? "webp"
          : "png";
    const ab = await res.arrayBuffer();
    const b64 = Buffer.from(new Uint8Array(ab)).toString("base64");
    return { dataUri: `data:${contentType};base64,${b64}`, ext };
  } catch {
    return null;
  }
}

function extractFirstUrl(output: any): string {
  try {
    if (!output) return "";
    if (typeof output === "string") return output;
    if (Array.isArray(output)) {
      const item = output[0];
      if (!item) return "";
      if (typeof item === "string") return item;
      if (item && typeof item.url === "function") return String(item.url());
      if (item && typeof item.url === "string") return String(item.url);
      return "";
    }
    if (typeof output.url === "function") return String(output.url());
    if (typeof output.url === "string") return String(output.url);
    return "";
  } catch {
    return "";
  }
}

const buildReplicateImageFileName = (historyId?: string, index: number = 0) => {
  if (historyId) {
    return `${historyId}-image-${index + 1}`;
  }
  return `image-${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 6)}`;
};

async function resolveItemUrl(item: any): Promise<string> {
  try {
    if (!item) return "";
    if (typeof item === "string") return item;
    // Replicate SDK file-like item: item.url() may be sync or async
    const maybeUrlFn = (item as any).url;
    if (typeof maybeUrlFn === "function") {
      const result = maybeUrlFn.call(item);
      if (result && typeof (result as any).then === "function") {
        const awaited = await result;
        // Some SDKs may return URL objects or objects with toString()
        return typeof awaited === "string" ? awaited : String(awaited);
      }
      return typeof result === "string" ? result : String(result);
    }
    return "";
  } catch {
    return "";
  }
}

async function resolveOutputUrls(output: any): Promise<string[]> {
  try {
    if (!output) return [];
    if (Array.isArray(output)) {
      const urls: string[] = [];
      for (const it of output) {
        const u = await resolveItemUrl(it);
        if (u) urls.push(u);
      }
      return urls;
    }
    const single = await resolveItemUrl(output);
    return single ? [single] : [];
  } catch {
    return [];
  }
}

export async function removeBackground(
  uid: string,
  body: {
    image: string;
    model?: string;
    format?: "png" | "jpg" | "jpeg" | "webp";
    reverse?: boolean;
    threshold?: number;
    background_type?: string;
    isPublic?: boolean;
  }
) {
  // env.replicateApiKey already handles REPLICATE_API_TOKEN as fallback in env.ts
  const key = env.replicateApiKey as string;
  if (!key) {
    // eslint-disable-next-line no-console
    console.error(
      "[replicateService.removeBackground] Missing REPLICATE_API_TOKEN"
    );
    throw new ApiError("Replicate API key not configured", 500);
  }
  // For bria/eraser, validator allows image OR image_url; basic guard here only for legacy models
  const modelHint = String(body?.model || "").toLowerCase();
  const isEraser = modelHint.includes("bria/eraser");
  if (!isEraser && !body?.image) throw new ApiError("image is required", 400);

  const replicate = new Replicate({ auth: key });

  const creator = await authRepository.getUserById(uid);
  const storageKeyPrefixOverride: string | undefined = (body as any)?.storageKeyPrefixOverride;
  const legacyId = await replicateRepository.createGenerationRecord(
    {
      prompt: "[Remove background]",
      model: body.model || DEFAULT_BG_MODEL_A,
      isPublic: body.isPublic === true,
    },
    creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid }
  );
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: "[Remove background]",
    model: body.model || DEFAULT_BG_MODEL_A,
    generationType: "text-to-image",
    visibility: body.isPublic === true ? "public" : "private",
    isPublic: body.isPublic === true,
    createdBy: creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid },
  } as any);

  // Prepare input based on model
  const modelBase =
    body.model && body.model.length > 0
      ? body.model
      : DEFAULT_BG_MODEL_A.split(":")[0];
  // Prepare model-specific input mapping
  const input: Record<string, any> = {};
  if (modelBase.startsWith("bria/eraser")) {
    // bria/eraser schema: support image or image_url; optional mask/mask_url; mask_type; preserve_alpha; content_moderation; sync
    const anyBody: any = body as any;
    if (typeof anyBody.image === "string" && anyBody.image.length > 0)
      input.image = anyBody.image;
    if (
      !input.image &&
      typeof anyBody.image_url === "string" &&
      anyBody.image_url.length > 0
    )
      input.image_url = anyBody.image_url;
    if (typeof anyBody.mask === "string" && anyBody.mask.length > 0)
      input.mask = anyBody.mask;
    if (typeof anyBody.mask_url === "string" && anyBody.mask_url.length > 0)
      input.mask_url = anyBody.mask_url;
    if (anyBody.mask_type)
      input.mask_type =
        String(anyBody.mask_type).toLowerCase() === "manual"
          ? "manual"
          : String(anyBody.mask_type).toLowerCase() === "automatic"
            ? "automatic"
            : undefined;
    if (typeof anyBody.preserve_alpha === "boolean")
      input.preserve_alpha = anyBody.preserve_alpha;
    else input.preserve_alpha = true;
    if (typeof anyBody.content_moderation === "boolean")
      input.content_moderation = anyBody.content_moderation;
    if (typeof anyBody.sync === "boolean") input.sync = anyBody.sync;
    else input.sync = true;
  } else {
    // Legacy background removers
    // Use input image directly (URL or data URI); only upload outputs to Zata
    input.image = body.image;
    if (modelBase.startsWith("851-labs/background-remover")) {
      // Ensure transparent PNG by default
      input.format = body.format || "png";
      input.background_type = body.background_type || "rgba";
      if (typeof body.reverse === "boolean") input.reverse = body.reverse;
      if (typeof body.threshold === "number") input.threshold = body.threshold;
    }
  }

  let outputUrl = "";
  const version = (body as any).version as string | undefined;
  const modelSpec = composeModelSpec(modelBase, version);
  try {
    // eslint-disable-next-line no-console
    console.log("[replicateService.removeBackground] run", {
      modelSpec,
      input,
    });
    let output: any = await replicate.run(modelSpec as any, { input });
    // eslint-disable-next-line no-console
    console.log(
      "[replicateService.removeBackground] output",
      typeof output,
      Array.isArray(output) ? output.length : "n/a"
    );
    // Resolve possible file-like outputs
    const urls = await resolveOutputUrls(output);
    outputUrl = urls[0] || "";
    if (!outputUrl) throw new Error("No output URL returned by Replicate");
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[replicateService.removeBackground] error", e?.message || e);
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

  // Upload to Zata
  let storedUrl = outputUrl;
  let storagePath = "";
  try {
    const username = creator?.username || uid;
    const uploaded = await uploadFromUrlToZata({
      sourceUrl: outputUrl,
      keyPrefix: `users/${username}/image/${historyId}`,
      // Preserve PNG for background-removed outputs; avoid double extensions
      fileName: "image-1",
    });
    storedUrl = uploaded.publicUrl;
    storagePath = uploaded.key;
  } catch {
    // fallback keep provider URL
  }

  const images = [
    {
      id: `replicate-${Date.now()}`,
      url: storedUrl,
      storagePath,
      originalUrl: outputUrl,
    } as any,
  ];
  const scoredImages = await aestheticScoreService.scoreImages(images);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);

  await generationHistoryRepository.update(uid, historyId, {
    status: "completed",
    images: scoredImages,
    aestheticScore: highestScore,
    updatedAt: new Date().toISOString(), // Set completion time for proper sorting
  } as any);
  try { console.log('[Replicate.removeBackground] History updated with scores', { historyId, imageCount: scoredImages.length, highestScore }); } catch { }
  try {
    await replicateRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      images: scoredImages as any,
    });
  } catch { }

  // Trigger optimization and re-enqueue mirror update (non-blocking)
  try {
    console.log(
      "[replicateService.removeBackground] triggering markGenerationCompleted",
      { uid, historyId, isPublic: body?.isPublic === true }
    );
    markGenerationCompleted(uid, historyId, {
      status: "completed",
      images: scoredImages as any,
      isPublic: body?.isPublic === true,
    }).catch((e: any) =>
      console.error(
        "[replicateService.removeBackground] markGenerationCompleted failed",
        e
      )
    );
  } catch (e) {
    console.warn(
      "[replicateService.removeBackground] markGenerationCompleted call error",
      e
    );
  }

  // Robust mirror sync with retry logic
  await syncToMirror(uid, historyId);

  return {
    images: scoredImages,
    aestheticScore: highestScore,
    historyId,
    model: modelBase,
    status: "completed",
  } as any;
}

export async function upscale(uid: string, body: any) {
  // env.replicateApiKey already handles REPLICATE_API_TOKEN as fallback in env.ts
  const key = env.replicateApiKey as string;
  if (!key) {
    // eslint-disable-next-line no-console
    console.error("[replicateService.upscale] Missing REPLICATE_API_TOKEN");
    throw new ApiError("Replicate API key not configured", 500);
  }
  if (!body?.image) throw new ApiError("image is required", 400);

  const replicate = new Replicate({ auth: key });

  const modelBase = (
    body.model && body.model.length > 0
      ? String(body.model)
      : "philz1337x/crystal-upscaler"
  ).trim();
  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: "[Upscale]",
    model: modelBase,
    generationType: "text-to-image",
    visibility: body.isPublic === true ? "public" : "private",
    isPublic: body.isPublic === true,
    createdBy: creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid },
  } as any);

  const legacyId = await replicateRepository.createGenerationRecord(
    { prompt: "[Upscale]", model: modelBase, isPublic: body.isPublic === true },
    creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid }
  );

  // Track the original input image URL for saving to database
  const originalInputImage = body.image;
  let inputImageStoragePath: string | undefined;
  let inputImageUrl: string | undefined;

  // If we receive a data URI, persist to Zata and use the public URL for Replicate
  // This is required because Replicate may not accept large data URIs or may timeout
  if (typeof body.image === "string" && body.image.startsWith("data:")) {
    try {
      const username = creator?.username || uid;
      // Check data URI size (limit to ~10MB to avoid issues)
      const dataUriSize = body.image.length;
      const maxDataUriSize = 10 * 1024 * 1024; // 10MB
      if (dataUriSize > maxDataUriSize) {
        throw new ApiError(
          `Image data URI is too large (${Math.round(dataUriSize / 1024 / 1024)}MB). Maximum size is 10MB.`,
          400
        );
      }
      const stored = await uploadDataUriToZata({
        dataUri: body.image,
        keyPrefix: `users/${username}/input/${historyId}`,
        fileName: "source",
      });
      if (!stored?.publicUrl) {
        throw new Error("Failed to upload image to storage: no public URL returned");
      }
      body.image = stored.publicUrl;
      inputImageUrl = stored.publicUrl;
      inputImageStoragePath = (stored as any).key;
      // eslint-disable-next-line no-console
      console.log("[replicateService.upscale] Uploaded data URI to Zata", {
        historyId,
        publicUrl: stored.publicUrl,
      });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error("[replicateService.upscale] Failed to upload data URI to Zata", e?.message || e);
      await generationHistoryRepository.update(uid, historyId, {
        status: "failed",
        error: e?.message || "Failed to upload image to storage",
      } as any);
      throw new ApiError(
        e?.message || "Failed to upload image to storage. Please try again or use a smaller image.",
        e?.statusCode || 500,
        e
      );
    }
  } else if (typeof body.image === "string" && body.image.trim().length > 0) {
    // For URL inputs, try to upload to Zata for consistency and to ensure we have a storage path
    try {
      const username = creator?.username || uid;
      // Check if it's already a Zata URL - if so, extract the storage path
      const ZATA_PREFIX = env.zataPrefix;
      if (ZATA_PREFIX && body.image.startsWith(ZATA_PREFIX)) {
        inputImageStoragePath = body.image.substring(ZATA_PREFIX.length);
        inputImageUrl = body.image;
      } else {
        // Upload external URL to Zata for consistency
        const stored = await uploadFromUrlToZata({
          sourceUrl: body.image,
          keyPrefix: `users/${username}/input/${historyId}`,
          fileName: "source",
        });
        inputImageUrl = stored.publicUrl;
        inputImageStoragePath = (stored as any).key;
        body.image = stored.publicUrl; // Use the Zata URL for Replicate
      }
    } catch (e: any) {
      // If upload fails, still use the original URL but log a warning
      // eslint-disable-next-line no-console
      console.warn("[replicateService.upscale] Failed to upload input URL to Zata, using original URL", e?.message || e);
      inputImageUrl = body.image;
    }
  }

  // Validate that we have a valid image URL (not a data URI)
  if (typeof body.image === "string" && body.image.startsWith("data:")) {
    throw new ApiError(
      "Image upload failed. Please try again or use a smaller image.",
      400
    );
  }

  if (!body.image || typeof body.image !== "string" || body.image.trim().length === 0) {
    throw new ApiError("Invalid image URL provided", 400);
  }

  // Save input image to database
  if (inputImageUrl) {
    try {
      const inputPersisted: any[] = [{
        id: "in-1",
        url: inputImageUrl,
        originalUrl: originalInputImage,
      }];
      if (inputImageStoragePath) {
        inputPersisted[0].storagePath = inputImageStoragePath;
      }
      await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
      // eslint-disable-next-line no-console
      console.log("[replicateService.upscale] Saved inputImages to database", { historyId, count: inputPersisted.length });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn("[replicateService.upscale] Failed to save inputImages:", e);
    }
  }
  let outputUrls: string[] = [];
  try {
    const { model: _m, isPublic: _p, ...rest } = body || {};
    const input: any = { image: body.image, ...rest };
    // Sanitize inputs
    if (modelBase === "philz1337x/clarity-upscaler") {
      if (input.dynamic != null) input.dynamic = clamp(input.dynamic, 1, 50);
      if (input.sharpen != null) input.sharpen = clamp(input.sharpen, 0, 10);
      if (input.scale_factor != null)
        input.scale_factor = clamp(input.scale_factor, 1, 4);
      if (input.creativity != null)
        input.creativity = clamp(input.creativity, 0, 1);
      if (input.resemblance != null)
        input.resemblance = clamp(input.resemblance, 0, 3);
      if (input.num_inference_steps != null)
        input.num_inference_steps = Math.max(
          1,
          Math.min(100, Number(input.num_inference_steps))
        );
    }
    if (modelBase === "fermatresearch/magic-image-refiner") {
      if (input.hdr != null) input.hdr = clamp(input.hdr, 0, 1);
      if (input.creativity != null)
        input.creativity = clamp(input.creativity, 0, 1);
      if (input.resemblance != null)
        input.resemblance = clamp(input.resemblance, 0, 1);
      if (input.guidance_scale != null)
        input.guidance_scale = clamp(input.guidance_scale, 0.1, 30);
      if (input.steps != null)
        input.steps = Math.max(1, Math.min(100, Number(input.steps)));
      if (!input.resolution) input.resolution = "1024";
    }
    if (modelBase === "leonardoai/lucid-origin") {
      if (rest.aspect_ratio) input.aspect_ratio = String(rest.aspect_ratio);
      if (rest.style) input.style = String(rest.style);
      if (rest.contrast) input.contrast = String(rest.contrast);
      if (rest.num_images != null && Number.isInteger(rest.num_images))
        input.num_images = Math.max(1, Math.min(8, Number(rest.num_images)));
      if (typeof rest.prompt_enhance === "boolean")
        input.prompt_enhance = rest.prompt_enhance;
      if (rest.generation_mode)
        input.generation_mode = String(rest.generation_mode);
    }
    if (modelBase === "nightmareai/real-esrgan") {
      // real-esrgan supports scale 0-10 (default 4) and face_enhance boolean
      if (input.scale != null)
        input.scale = Math.max(0, Math.min(10, Number(input.scale)));
      if (input.face_enhance != null)
        input.face_enhance = Boolean(input.face_enhance);
    }
    if (modelBase === "mv-lab/swin2sr") {
      // Swin2SR expects `task` enum and image. If provided, allow pass-through of task
      if (input.task) {
        const allowed = new Set(["classical_sr", "real_sr", "compressed_sr"]);
        if (!allowed.has(String(input.task))) input.task = "real_sr";
      }
    }
    if (modelBase === "philz1337x/crystal-upscaler") {
      // crystal-upscaler expects scale_factor (1-4) and optional output_format (png/jpg)
      if (input.scale_factor != null) {
        input.scale_factor = clamp(input.scale_factor, 1, 4);
      } else {
        input.scale_factor = 2; // Default scale factor
      }
      if (input.output_format) {
        const allowedFormats = new Set(["png", "jpg", "jpeg"]);
        if (!allowedFormats.has(String(input.output_format).toLowerCase())) {
          input.output_format = "png"; // Default to PNG
        } else {
          input.output_format = String(input.output_format).toLowerCase();
        }
      }
    }
    const modelSpec = composeModelSpec(modelBase, body.version);
    // eslint-disable-next-line no-console
    console.log("[replicateService.upscale] run", {
      modelSpec,
      inputKeys: Object.keys(input),
      imageUrl: body.image?.substring?.(0, 100) || body.image, // Log first 100 chars of URL
    });

    // Add timeout wrapper for Replicate API call (5 minutes max)
    const REPLICATE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Replicate API call timed out after 5 minutes")), REPLICATE_TIMEOUT);
    });

    // Retry logic with exponential backoff for transient errors (500, 502, 503, 504)
    const MAX_RETRIES = 2;
    let lastError: any = null;
    let output: any = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff: wait 1s, 2s, 4s
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          // eslint-disable-next-line no-console
          console.log(`[replicateService.upscale] Retry attempt ${attempt} after ${delay}ms delay`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        output = await Promise.race([
          replicate.run(modelSpec as any, { input }),
          timeoutPromise,
        ]) as any;

        // Success - break out of retry loop
        break;
      } catch (retryError: any) {
        lastError = retryError;

        // Extract HTTP status code from various error formats
        const httpStatus =
          retryError?.statusCode ||
          retryError?.response?.status ||
          retryError?.$metadata?.httpStatusCode ||
          retryError?.data?.$metadata?.httpStatusCode ||
          (retryError?.message?.match(/status[:\s]+(\d{3})/i)?.[1] ? Number(retryError.message.match(/status[:\s]+(\d{3})/i)?.[1]) : null);

        // Check if this is a parsing/deserialization error (usually indicates HTML response from server)
        const isParseError =
          retryError?.message?.includes("Deserialization error") ||
          retryError?.message?.includes("Expected closing tag") ||
          retryError?.message?.includes("to see the raw response") ||
          (retryError?.$metadata && httpStatus >= 500);

        // Check if this is a retryable error (500, 502, 503, 504)
        // Parse errors with 5xx status codes are also retryable
        const isRetryable =
          httpStatus === 500 ||
          httpStatus === 502 ||
          httpStatus === 503 ||
          httpStatus === 504 ||
          (isParseError && httpStatus >= 500) ||
          (retryError?.message && /50[0-4]/.test(retryError.message));

        // If it's the last attempt or not retryable, throw the error
        if (attempt >= MAX_RETRIES || !isRetryable) {
          // If crystal-upscaler failed and we haven't tried fallback yet, try fallback model
          // Trigger fallback for retryable errors (5xx) or parse errors (which indicate server issues)
          if (
            modelBase === "philz1337x/crystal-upscaler" &&
            attempt >= MAX_RETRIES &&
            (isRetryable || isParseError) &&
            !body.model // Only fallback if user didn't explicitly specify the model
          ) {
            // eslint-disable-next-line no-console
            console.log("[replicateService.upscale] Crystal-upscaler failed, trying fallback model: philz1337x/clarity-upscaler");
            try {
              const fallbackModelSpec = composeModelSpec("philz1337x/clarity-upscaler", body.version);
              const fallbackInput: any = { image: body.image };
              // Copy relevant parameters from original input
              if (input.scale_factor) fallbackInput.scale_factor = input.scale_factor;
              if (input.dynamic != null) fallbackInput.dynamic = input.dynamic;
              if (input.sharpen != null) fallbackInput.sharpen = input.sharpen;

              output = await Promise.race([
                replicate.run(fallbackModelSpec as any, { input: fallbackInput }),
                timeoutPromise,
              ]) as any;

              // eslint-disable-next-line no-console
              console.log("[replicateService.upscale] Fallback model succeeded");
              break; // Success with fallback
            } catch (fallbackError: any) {
              // Fallback also failed, throw original error
              throw lastError;
            }
          } else {
            throw lastError;
          }
        }
        // Continue to next retry attempt
      }
    }

    if (!output) {
      throw lastError || new Error("Failed to get output from Replicate");
    }

    // eslint-disable-next-line no-console
    console.log(
      "[replicateService.upscale] output",
      typeof output,
      Array.isArray(output) ? output.length : "n/a"
    );

    // Robustly resolve Replicate SDK file outputs (which may be objects with url())
    const urlsResolved = await resolveOutputUrls(output);
    if (urlsResolved && urlsResolved.length) {
      outputUrls = urlsResolved;
    } else {
      // Fallback to best-effort single URL extraction
      const one = extractFirstUrl(output);
      if (one) outputUrls = [one];
    }
    if (!outputUrls.length) {
      // eslint-disable-next-line no-console
      console.error("[replicateService.upscale] No output URL returned by Replicate", {
        outputType: typeof output,
        outputValue: output,
      });
      throw new Error("No output URL returned by Replicate. The model may have failed or returned an unexpected format.");
    }
  } catch (e: any) {
    // Extract HTTP status code for logging
    const httpStatusForLog =
      e?.statusCode ||
      e?.response?.status ||
      e?.$metadata?.httpStatusCode ||
      e?.data?.$metadata?.httpStatusCode ||
      null;

    // eslint-disable-next-line no-console
    console.error("[replicateService.upscale] error", {
      message: e?.message || e,
      stack: e?.stack,
      model: modelBase,
      historyId,
      statusCode: e?.statusCode,
      responseStatus: e?.response?.status,
      httpStatusCode: httpStatusForLog,
      metadata: e?.$metadata || e?.data?.$metadata,
      isParseError: e?.message?.includes("Deserialization error") || e?.message?.includes("Expected closing tag"),
    });

    // Extract meaningful error message from HTML responses or API errors
    let errorMessage = "Replicate generation failed";

    // Extract HTTP status code from various error formats
    const httpStatus =
      e?.statusCode ||
      e?.response?.status ||
      e?.$metadata?.httpStatusCode ||
      e?.data?.$metadata?.httpStatusCode ||
      (e?.message?.match(/status[:\s]+(\d{3})/i)?.[1] ? Number(e.message.match(/status[:\s]+(\d{3})/i)?.[1]) : null);

    // Check if this is a parsing/deserialization error (usually indicates HTML response from server)
    const isParseError =
      e?.message?.includes("Deserialization error") ||
      e?.message?.includes("Expected closing tag") ||
      e?.message?.includes("to see the raw response") ||
      (e?.$metadata && httpStatus >= 500);

    // Check if error response contains HTML (Cloudflare error page)
    const errorText = String(e?.message || e?.response?.data || e?.data || e || "");
    if (isParseError || errorText.includes("<!DOCTYPE html>") || errorText.includes("Internal server error")) {
      errorMessage = "Replicate service is temporarily unavailable (server error). Please try again in a few minutes.";
    } else if (httpStatus === 500 || e?.statusCode === 500 || e?.response?.status === 500) {
      errorMessage = "Replicate service encountered an internal error. Please try again in a few minutes.";
    } else if (httpStatus === 502 || e?.statusCode === 502 || e?.response?.status === 502) {
      errorMessage = "Replicate service is temporarily unavailable. Please try again in a few minutes.";
    } else if (httpStatus === 503 || e?.statusCode === 503 || e?.response?.status === 503) {
      errorMessage = "Replicate service is temporarily overloaded. Please try again in a few minutes.";
    } else if (httpStatus === 504 || e?.statusCode === 504 || e?.response?.status === 504) {
      errorMessage = "Replicate service request timed out. Please try again.";
    } else if (e?.message?.includes("timeout")) {
      errorMessage = "The upscale operation timed out. Please try again with a smaller image or lower scale factor.";
    } else if (e?.message?.includes("No output URL")) {
      errorMessage = "The upscale model did not return a result. Please try again or use a different model.";
    } else if (e?.response?.data?.detail) {
      errorMessage = e.response.data.detail;
    } else if (e?.response?.data?.message) {
      errorMessage = e.response.data.message;
    } else if (e?.message) {
      errorMessage = e.message;
    }

    try {
      await replicateRepository.updateGenerationRecord(legacyId, {
        status: "failed",
        error: errorMessage,
      });
    } catch { }
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: errorMessage,
    } as any);
    throw new ApiError(errorMessage, 502, e);
  }

  // Upload possibly multiple output URLs
  const uploadedImages: Array<{
    id: string;
    url: string;
    storagePath?: string;
    originalUrl: string;
  }> = [];
  try {
    const username = creator?.username || uid;
    let idx = 1;
    for (const out of outputUrls) {
      try {
        // Prefer downloading and re-uploading to ensure we store first-party resource URLs
        const dl = await downloadToDataUri(out);
        if (dl) {
          const uploaded = await uploadDataUriToZata({
            dataUri: dl.dataUri,
            keyPrefix: `users/${username}/image/${historyId}`,
            fileName: `${buildReplicateImageFileName(historyId, idx - 1)}.${dl.ext}`,
          });
          uploadedImages.push({
            id: `replicate-${Date.now()}-${idx}`,
            url: uploaded.publicUrl,
            storagePath: uploaded.key,
            originalUrl: out,
          });
        } else {
          const uploaded = await uploadFromUrlToZata({
            sourceUrl: out,
            keyPrefix: `users/${username}/image/${historyId}`,
            fileName: buildReplicateImageFileName(historyId, idx - 1),
          });
          uploadedImages.push({
            id: `replicate-${Date.now()}-${idx}`,
            url: uploaded.publicUrl,
            storagePath: uploaded.key,
            originalUrl: out,
          });
        }
      } catch {
        uploadedImages.push({
          id: `replicate-${Date.now()}-${idx}`,
          url: out,
          originalUrl: out,
        });
      }
      idx++;
    }
  } catch {
    // Fallback: store raw urls
    uploadedImages.push(
      ...outputUrls.map((out, i) => ({
        id: `replicate-${Date.now()}-${i + 1}`,
        url: out,
        originalUrl: out,
      }))
    );
  }

  // Score the images for aesthetic quality (upscale function)
  const scoredImages = await aestheticScoreService.scoreImages(uploadedImages);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);

  // Preserve inputImages if they were already saved (don't overwrite them)
  const existing = await generationHistoryRepository.get(uid, historyId);
  const updateData: any = {
    status: "completed",
    images: scoredImages as any,
    aestheticScore: highestScore,
    updatedAt: new Date().toISOString(), // Set completion time for proper sorting
  };
  // Preserve inputImages if they exist
  if (existing && Array.isArray((existing as any).inputImages) && (existing as any).inputImages.length > 0) {
    updateData.inputImages = (existing as any).inputImages;
  }

  await generationHistoryRepository.update(uid, historyId, updateData);
  try { console.log('[Replicate.upscale] History updated with scores', { historyId, imageCount: scoredImages.length, highestScore }); } catch { }
  try {
    await replicateRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      images: scoredImages as any,
    });
  } catch { }
  // Trigger optimization and re-enqueue mirror update (non-blocking)
  try {
    console.log(
      "[replicateService.upscale] triggering markGenerationCompleted",
      { uid, historyId, isPublic: body?.isPublic === true }
    );
    markGenerationCompleted(uid, historyId, {
      status: "completed",
      images: scoredImages as any,
      isPublic: body?.isPublic === true,
    }).catch((e: any) =>
      console.error(
        "[replicateService.upscale] markGenerationCompleted failed",
        e
      )
    );
  } catch (e) {
    console.warn(
      "[replicateService.upscale] markGenerationCompleted call error",
      e
    );
  }
  // Robust mirror sync with retry logic
  await syncToMirror(uid, historyId);
  return {
    images: scoredImages,
    aestheticScore: highestScore,
    historyId,
    model: modelBase,
    status: "completed",
  } as any;
}

export async function multiangle(uid: string, body: any) {
  // env.replicateApiKey already handles REPLICATE_API_TOKEN as fallback in env.ts
  const key = env.replicateApiKey as string;
  if (!key) {
    // eslint-disable-next-line no-console
    console.error("[replicateService.multiangle] Missing REPLICATE_API_TOKEN");
    throw new ApiError("Replicate API key not configured", 500);
  }
  if (!body?.image) throw new ApiError("image is required", 400);

  const replicate = new Replicate({ auth: key });

  const modelBase = "qwen/qwen-edit-multiangle";

  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: "[Multiangle]",
    model: modelBase,
    generationType: "text-to-image",
    visibility: body.isPublic === true ? "public" : "private",
    isPublic: body.isPublic === true,
    createdBy: creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid },
  } as any);

  const legacyId = await replicateRepository.createGenerationRecord(
    { prompt: "[Multiangle]", model: modelBase, isPublic: body.isPublic === true },
    creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid }
  );

  // Track the original input image URL for saving to database
  const originalInputImage = body.image;
  let inputImageStoragePath: string | undefined;
  let inputImageUrl: string | undefined;

  // Input Image Upload Logic (Duplicated from upscale for robust handling)
  if (typeof body.image === "string" && body.image.startsWith("data:")) {
    try {
      const username = creator?.username || uid;
      const dataUriSize = body.image.length;
      const maxDataUriSize = 10 * 1024 * 1024; // 10MB
      if (dataUriSize > maxDataUriSize) {
        throw new ApiError(
          `Image data URI is too large (${Math.round(dataUriSize / 1024 / 1024)}MB). Maximum size is 10MB.`,
          400
        );
      }
      const stored = await uploadDataUriToZata({
        dataUri: body.image,
        keyPrefix: `users/${username}/input/${historyId}`,
        fileName: "source",
      });
      if (!stored?.publicUrl) throw new Error("Failed to upload image to storage");
      body.image = stored.publicUrl;
      inputImageUrl = stored.publicUrl;
      inputImageStoragePath = (stored as any).key;
    } catch (e: any) {
      console.error("[replicateService.multiangle] Failed to upload data URI", e);
      throw new ApiError("Failed to upload input image.", 500, e);
    }
  } else if (typeof body.image === "string" && body.image.trim().length > 0) {
    try {
      const username = creator?.username || uid;
      const ZATA_PREFIX = env.zataPrefix;
      if (ZATA_PREFIX && body.image.startsWith(ZATA_PREFIX)) {
        inputImageStoragePath = body.image.substring(ZATA_PREFIX.length);
        inputImageUrl = body.image;
      } else {
        const stored = await uploadFromUrlToZata({
          sourceUrl: body.image,
          keyPrefix: `users/${username}/input/${historyId}`,
          fileName: "source",
        });
        inputImageUrl = stored.publicUrl;
        inputImageStoragePath = (stored as any).key;
        body.image = stored.publicUrl;
      }
    } catch (e: any) {
      console.warn("[replicateService.multiangle] Failed to upload input URL to Zata, using original URL", e?.message || e);
      inputImageUrl = body.image;
    }
  }

  // Save input image to database
  if (inputImageUrl) {
    try {
      const inputPersisted: any[] = [{
        id: "in-1",
        url: inputImageUrl,
        originalUrl: originalInputImage,
      }];
      if (inputImageStoragePath) {
        inputPersisted[0].storagePath = inputImageStoragePath;
      }
      await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
    } catch (e) {
      console.warn("[replicateService.multiangle] Failed to save inputImages:", e);
    }
  }

  let outputUrls: string[] = [];
  try {
    const input: any = {
      image: body.image,
      prompt: body.prompt || "", // User specified prompt from UI
      rotate_degrees: typeof body.rotate_degrees === 'number' ? Math.max(-90, Math.min(90, body.rotate_degrees)) : 0,
      move_forward: typeof body.move_forward === 'number' ? Math.max(0, Math.min(50, body.move_forward)) : 0, // User sample showed 2.5, keep range reasonable
      vertical_tilt: typeof body.vertical_tilt === 'number' ? body.vertical_tilt : 0,
      use_wide_angle: body.wide_angle === true, // Mapped from wide_angle to use_wide_angle
      aspect_ratio: ["match_input_image", "1:1", "16:9", "9:16", "4:3", "3:4"].includes(body.aspect_ratio) ? body.aspect_ratio : "match_input_image",
      lora_weights: "dx8152/Qwen-Edit-2509-Multiple-angles", // REQUIRED
      lora_scale: 3, // User specified default
      true_guidance_scale: 8, // User specified default
      output_format: "jpg", // Default to jpg as requested
      output_quality: 95,
      go_fast: false,
    };

    // Dynamically resolve latest version for robustness
    let version = body.version;
    if (!version) {
      try {
        console.log("[replicateService.multiangle] Fetching latest version for", modelBase);
        const [owner, name] = modelBase.split('/');
        const modelData = await replicate.models.get(owner, name);
        version = modelData.latest_version?.id;
        console.log("[replicateService.multiangle] Resolved latest version:", version);
      } catch (verErr: any) {
        console.warn("[replicateService.multiangle] Failed to fetch latest version, falling back to base model string:", verErr.message);
      }
    }

    const modelSpec = version ? `${modelBase}:${version}` : modelBase;
    console.log("[replicateService.multiangle] run", { modelSpec, input });

    // 5 min timeout
    const REPLICATE_TIMEOUT = 5 * 60 * 1000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Replicate API call timed out")), REPLICATE_TIMEOUT);
    });

    const output: any = await Promise.race([
      replicate.run(modelSpec as any, { input }),
      timeoutPromise,
    ]);

    console.log("[replicateService.multiangle] output", typeof output);

    const urlsResolved = await resolveOutputUrls(output);
    if (urlsResolved && urlsResolved.length) {
      outputUrls = urlsResolved;
    } else {
      const one = extractFirstUrl(output);
      if (one) outputUrls = [one];
    }

    if (!outputUrls.length) {
      console.error("[replicateService.multiangle] No output URL. Raw output:", JSON.stringify(output, null, 2));
      throw new Error("No output URL returned by Replicate");
    }

  } catch (e: any) {
    console.error("[replicateService.multiangle] error details:", JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
    const errorMessage = e?.message || "Replicate generation failed";
    try {
      await replicateRepository.updateGenerationRecord(legacyId, { status: "failed", error: errorMessage });
    } catch { }
    await generationHistoryRepository.update(uid, historyId, { status: "failed", error: errorMessage } as any);
    throw new ApiError(errorMessage, 502, e);
  }

  // Upload outputs
  const uploadedImages: Array<{ id: string; url: string; storagePath?: string; originalUrl: string; }> = [];
  try {
    const username = creator?.username || uid;
    let idx = 1;
    for (const out of outputUrls) {
      try {
        const dl = await downloadToDataUri(out);
        if (dl) {
          const uploaded = await uploadDataUriToZata({
            dataUri: dl.dataUri,
            keyPrefix: `users/${username}/image/${historyId}`,
            fileName: `${buildReplicateImageFileName(historyId, idx - 1)}.${dl.ext}`,
          });
          uploadedImages.push({
            id: `replicate-${Date.now()}-${idx}`,
            url: uploaded.publicUrl,
            storagePath: uploaded.key,
            originalUrl: out,
          });
        } else {
          // Fallback upload from URL directly
          const uploaded = await uploadFromUrlToZata({
            sourceUrl: out,
            keyPrefix: `users/${username}/image/${historyId}`,
            fileName: buildReplicateImageFileName(historyId, idx - 1),
          });
          uploadedImages.push({
            id: `replicate-${Date.now()}-${idx}`,
            url: uploaded.publicUrl,
            storagePath: uploaded.key,
            originalUrl: out,
          });
        }
      } catch {
        uploadedImages.push({ id: `replicate-${Date.now()}-${idx}`, url: out, originalUrl: out });
      }
      idx++;
    }
  } catch {
    uploadedImages.push(...outputUrls.map((out, i) => ({ id: `replicate-${Date.now()}-${i + 1}`, url: out, originalUrl: out })));
  }

  const scoredImages = await aestheticScoreService.scoreImages(uploadedImages);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);

  const updateData: any = {
    status: "completed",
    images: scoredImages as any,
    aestheticScore: highestScore,
    updatedAt: new Date().toISOString(),
  };

  await generationHistoryRepository.update(uid, historyId, updateData);
  try { await replicateRepository.updateGenerationRecord(legacyId, { status: "completed", images: scoredImages as any }); } catch { }

  markGenerationCompleted(uid, historyId, {
    status: "completed",
    images: scoredImages as any,
    isPublic: body?.isPublic === true,
  }).catch(console.error);

  await syncToMirror(uid, historyId);

  return {
    images: scoredImages,
    aestheticScore: highestScore,
    historyId,
    model: modelBase,
    status: "completed",
  } as any;
}

const MULTISCENE_BASE_PROMPT = `Analyze the entire movie scene. Identify ALL key subjects present (whether it's a single person, a group/couple, a vehicle, or a specific object) and their spatial relationship/interaction.
Generate a cohesive 3x3 grid "Cinematic Contact Sheet" featuring 9 distinct camera shots of exactly these subjects in the same environment.
You must adapt the standard cinematic shot types to fit the content (e.g., if a group, keep the group together; if an object, frame the whole object):

**Row 1 (Establishing Context):**
1. **Extreme Long Shot (ELS):** The subject(s) are seen small within the vast environment.
2. **Long Shot (LS):** The complete subject(s) or group is visible from top to bottom (head to toe / wheels to roof).
3. **Medium Long Shot (American/3-4):** Framed from knees up (for people) or a 3/4 view (for objects).

**Row 2 (The Core Coverage):**
4. **Medium Shot (MS):** Framed from the waist up (or the central core of the object). Focus on interaction/action.
5. **Medium Close-Up (MCU):** Framed from chest up. Intimate framing of the main subject(s).
6. **Close-Up (CU):** Tight framing on the face(s) or the "front" of the object.

**Row 3 (Details & Angles):**
7. **Extreme Close-Up (ECU):** Macro detail focusing intensely on a key feature (eyes, hands, logo, texture).
8. **Low Angle Shot (Worm's Eye):** Looking up at the subject(s) from the ground (imposing/heroic).
9. **High Angle Shot (Bird's Eye):** Looking down on the subject(s) from above.

Ensure strict consistency: The same people/objects, same clothes, and same lighting across all 9 panels. The depth of field should shift realistically (bokeh in close-ups).

A professional 3x3 cinematic storyboard grid containing 9 panels.
The grid showcases the specific subjects/scene from the input image in a comprehensive range of focal lengths.
**Top Row:** Wide environmental shot, Full view, 3/4 cut.
**Middle Row:** Waist-up view, Chest-up view, Face/Front close-up.
**Bottom Row:** Macro detail, Low Angle, High Angle.
All frames feature photorealistic textures, consistent cinematic color grading, and correct framing for the specific number of subjects or objects analyzed.`;

export async function nextScene(uid: string, body: any) {
  // env.replicateApiKey already handles REPLICATE_API_TOKEN as fallback in env.ts
  const key = env.replicateApiKey as string;
  if (!key) {
    // eslint-disable-next-line no-console
    console.error("[replicateService.nextScene] Missing REPLICATE_API_TOKEN");
    throw new ApiError("Replicate API key not configured", 500);
  }
  if (!body?.image) throw new ApiError("image is required", 400);

  const replicate = new Replicate({ auth: key });

  const isMultiScene = body.mode === "nextscene";
  const modelBase = "qwen-edit-apps/qwen-image-edit-plus-lora-next-scene"; // MultiScene mode removed (was using nano-banana-pro)

  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt || "[Next Scene]",
    model: modelBase,
    generationType: "image-to-image",
    visibility: body.isPublic === true ? "public" : "private",
    isPublic: body.isPublic === true,
    createdBy: creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid },
  } as any);

  const legacyId = await replicateRepository.createGenerationRecord(
    { prompt: body.prompt || "[Next Scene]", model: modelBase, isPublic: body.isPublic === true },
    creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid }
  );

  // Track the original input image URL for saving to database
  const originalInputImage = body.image;
  let inputImageStoragePath: string | undefined;
  let inputImageUrl: string | undefined;

  // Input Image Upload Logic (Duplicated from upscale/multiangle for robust handling)
  if (typeof body.image === "string" && body.image.startsWith("data:")) {
    try {
      const username = creator?.username || uid;
      const dataUriSize = body.image.length;
      const maxDataUriSize = 10 * 1024 * 1024; // 10MB
      if (dataUriSize > maxDataUriSize) {
        throw new ApiError(
          `Image data URI is too large (${Math.round(dataUriSize / 1024 / 1024)}MB). Maximum size is 10MB.`,
          400
        );
      }
      const stored = await uploadDataUriToZata({
        dataUri: body.image,
        keyPrefix: `users/${username}/input/${historyId}`,
        fileName: "source",
      });
      if (!stored?.publicUrl) throw new Error("Failed to upload image to storage");
      body.image = stored.publicUrl;
      inputImageUrl = stored.publicUrl;
      inputImageStoragePath = (stored as any).key;
    } catch (e: any) {
      console.error("[replicateService.nextScene] Failed to upload data URI", e);
      throw new ApiError("Failed to upload input image.", 500, e);
    }
  } else if (typeof body.image === "string" && body.image.trim().length > 0) {
    try {
      const username = creator?.username || uid;
      const ZATA_PREFIX = env.zataPrefix;
      if (ZATA_PREFIX && body.image.startsWith(ZATA_PREFIX)) {
        inputImageStoragePath = body.image.substring(ZATA_PREFIX.length);
        inputImageUrl = body.image;
      } else {
        const stored = await uploadFromUrlToZata({
          sourceUrl: body.image,
          keyPrefix: `users/${username}/input/${historyId}`,
          fileName: "source",
        });
        inputImageUrl = stored.publicUrl;
        inputImageStoragePath = (stored as any).key;
        body.image = stored.publicUrl;
      }
    } catch (e: any) {
      console.warn("[replicateService.nextScene] Failed to upload input URL to Zata, using original URL", e?.message || e);
      inputImageUrl = body.image;
    }
  }

  // Save input image to database
  if (inputImageUrl) {
    try {
      const inputPersisted: any[] = [{
        id: "in-1",
        url: inputImageUrl,
        originalUrl: originalInputImage,
      }];
      if (inputImageStoragePath) {
        inputPersisted[0].storagePath = inputImageStoragePath;
      }
      await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
    } catch (e) {
      console.warn("[replicateService.nextScene] Failed to save inputImages:", e);
    }
  }

  let outputUrls: string[] = [];
  try {
    let finalPrompt = body.prompt || "Next Scene: The camera pulls back to reveal the entire landscape";

    // For MultiScene, inject the strict base prompt
    if (isMultiScene) {
      // If user provided a prompt, append it or merge it. 
      // The instruction says "this will be base prompt so make it like that".
      // We'll treat user prompt as the scene description to be analyzed.
      finalPrompt = `${MULTISCENE_BASE_PROMPT}\n\nScene Description: ${body.prompt || "A cinematic scene"}`;
    }

    const input: any = {
      image: body.image,
      prompt: finalPrompt,
      lora_scale: body.lora_scale !== undefined ? Number(body.lora_scale) : 4,
      aspect_ratio: body.aspect_ratio || "match_input_image",
      lora_weights: body.lora_weights || "",
      output_format: "png",
      output_quality: 95,
      true_guidance_scale: body.true_guidance_scale !== undefined ? Number(body.true_guidance_scale) : 0,
      guidance_scale: body.guidance_scale !== undefined ? Number(body.guidance_scale) : 3.5,
      num_inference_steps: body.num_inference_steps !== undefined ? Number(body.num_inference_steps) : 25,
    };

    // Dynamically resolve latest version for robustness, though modelBase usually works for Replicate models with slash
    // qwen-edit-apps/qwen-image-edit-plus-lora-next-scene
    // If we need a version version we can fetch it, but usually the owner/name works
    // Let's assume owner/name works or fallback to latest
    const modelSpec = modelBase;
    // eslint-disable-next-line no-console
    console.log("[replicateService.nextScene] run", { modelSpec, input });

    // 5 min timeout
    const REPLICATE_TIMEOUT = 5 * 60 * 1000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Replicate API call timed out")), REPLICATE_TIMEOUT);
    });

    const output: any = await Promise.race([
      replicate.run(modelSpec as any, { input }),
      timeoutPromise,
    ]);

    // eslint-disable-next-line no-console
    console.log("[replicateService.nextScene] output", typeof output);

    const urlsResolved = await resolveOutputUrls(output);
    if (urlsResolved && urlsResolved.length) {
      outputUrls = urlsResolved;
    } else {
      const one = extractFirstUrl(output);
      if (one) outputUrls = [one];
    }

    if (!outputUrls.length) {
      console.error("[replicateService.nextScene] No output URL. Raw output:", JSON.stringify(output, null, 2));
      throw new Error("No output URL returned by Replicate");
    }

  } catch (e: any) {
    console.error("[replicateService.nextScene] error details:", JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
    const errorMessage = e?.message || "Replicate generation failed";
    try {
      await replicateRepository.updateGenerationRecord(legacyId, { status: "failed", error: errorMessage });
    } catch { }
    await generationHistoryRepository.update(uid, historyId, { status: "failed", error: errorMessage } as any);
    throw new ApiError(errorMessage, 502, e);
  }

  // Upload outputs
  const uploadedImages: Array<{ id: string; url: string; storagePath?: string; originalUrl: string; }> = [];
  try {
    const username = creator?.username || uid;
    let idx = 1;
    for (const out of outputUrls) {
      try {
        const dl = await downloadToDataUri(out);
        if (dl) {
          const uploaded = await uploadDataUriToZata({
            dataUri: dl.dataUri,
            keyPrefix: `users/${username}/image/${historyId}`,
            fileName: `${buildReplicateImageFileName(historyId, idx - 1)}.${dl.ext}`,
          });
          uploadedImages.push({
            id: `replicate-${Date.now()}-${idx}`,
            url: uploaded.publicUrl,
            storagePath: uploaded.key,
            originalUrl: out,
          });
        } else {
          // Fallback upload from URL directly
          const uploaded = await uploadFromUrlToZata({
            sourceUrl: out,
            keyPrefix: `users/${username}/image/${historyId}`,
            fileName: buildReplicateImageFileName(historyId, idx - 1),
          });
          uploadedImages.push({
            id: `replicate-${Date.now()}-${idx}`,
            url: uploaded.publicUrl,
            storagePath: uploaded.key,
            originalUrl: out,
          });
        }
      } catch {
        uploadedImages.push({ id: `replicate-${Date.now()}-${idx}`, url: out, originalUrl: out });
      }
      idx++;
    }
  } catch {
    uploadedImages.push(...outputUrls.map((out, i) => ({ id: `replicate-${Date.now()}-${i + 1}`, url: out, originalUrl: out })));
  }

  const scoredImages = await aestheticScoreService.scoreImages(uploadedImages);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);

  const updateData: any = {
    status: "completed",
    images: scoredImages as any,
    aestheticScore: highestScore,
    updatedAt: new Date().toISOString(),
  };

  await generationHistoryRepository.update(uid, historyId, updateData);
  try { await replicateRepository.updateGenerationRecord(legacyId, { status: "completed", images: scoredImages as any }); } catch { }

  markGenerationCompleted(uid, historyId, {
    status: "completed",
    images: scoredImages as any,
    isPublic: body?.isPublic === true,
  }).catch(console.error);

  await syncToMirror(uid, historyId);

  return {
    images: scoredImages,
    aestheticScore: highestScore,
    historyId,
    model: modelBase,
    status: "completed",
  } as any;
}

export async function generateImage(uid: string, body: any) {
  // env.replicateApiKey already handles REPLICATE_API_TOKEN as fallback in env.ts
  const key = env.replicateApiKey as string;
  if (!key) {
    // eslint-disable-next-line no-console
    console.error(
      "[replicateService.generateImage] Missing REPLICATE_API_TOKEN"
    );
    throw new ApiError("Replicate API key not configured", 500);
  }
  if (!body?.prompt) throw new ApiError("prompt is required", 400);

  const replicate = new Replicate({ auth: key });

  const normalizeModelAlias = (raw: string): string => {
    const s = String(raw || '').trim();
    const lower = s.toLowerCase();

    // Frontend sometimes sends short aliases; Replicate expects owner/name or owner/name:version
    if (
      lower === 'qwen-image-edit' ||
      lower === 'qwen-image-edit-2511' ||
      lower === 'qwen/qwen-image-edit-2511' ||
      lower === 'replicate/qwen/qwen-image-edit-2511'
    ) {
      return 'qwen/qwen-image-edit-2511';
    }

    return s;
  };

  const modelBase = normalizeModelAlias(
    body?.model && String(body.model).length > 0 ? String(body.model) : 'bytedance/seedream-4'
  ).trim();
  const creator = await authRepository.getUserById(uid);
  const storageKeyPrefixOverride: string | undefined = (body as any)?.storageKeyPrefixOverride;
  const aspectRatio = body.aspect_ratio || body.frameSize || null;
  const isQwenImageEdit = modelBase.toLowerCase() === 'qwen/qwen-image-edit-2511';
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: isQwenImageEdit ? 'image-to-image' : "text-to-image",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    frameSize: aspectRatio,
    aspect_ratio: aspectRatio,
    createdBy: creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid },
  } as any);
  const legacyId = await replicateRepository.createGenerationRecord(
    { prompt: body.prompt, model: modelBase, isPublic: body.isPublic === true },
    creator
      ? { uid, username: creator.username, email: (creator as any)?.email }
      : { uid }
  );

  // Do not upload input data URIs to Zata; pass directly to provider
  let outputUrls: string[] = [];
  let replicateModelBase = modelBase; // Declare outside try block so it's accessible in catch
  try {
    const { model: _m, isPublic: _p, ...rest } = body || {};
    const input: any = { prompt: body.prompt };

    // Qwen Image Edit (image-to-image)
    // The frontend currently posts to /api/replicate/generate with model "qwen-image-edit".
    // Replicate requires an owner/name slug, and Qwen requires an image input.
    if (isQwenImageEdit) {
      replicateModelBase = 'qwen/qwen-image-edit-2511';

      const candidateImages: string[] = Array.isArray(rest.image)
        ? rest.image
        : (typeof rest.image === 'string' && rest.image.length > 5)
          ? [rest.image]
          : Array.isArray((body as any)?.uploadedImages)
            ? (body as any).uploadedImages
            : Array.isArray(rest.image_input)
              ? rest.image_input
              : [];

      const images = candidateImages
        .map((u: any) => (typeof u === 'string' ? u.trim() : ''))
        .filter((u: string) => u.length > 0)
        .slice(0, 8);

      if (images.length === 0) {
        throw new ApiError('image is required for qwen-image-edit', 400);
      }

      // Replicate validates image inputs as "uri" (must be data: or http(s) or other valid URI).
      // The frontend often supplies internal proxy URLs like "/api/proxy/resource/<encodedStoragePath>".
      // Convert those to a public Zata URL using env.zataPrefix.
      const username = creator?.username || uid;
      const keyPrefix = `users/${username}/input/${historyId}`;
      const resolvedImages: string[] = [];

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        // Data URI -> upload to Zata and pass public URL
        if (/^data:/i.test(img)) {
          const uploaded = await uploadDataUriToZata({
            dataUri: img,
            keyPrefix,
            fileName: `qwen-image-edit-ref-${i + 1}`,
          });
          resolvedImages.push(uploaded.publicUrl);
          continue;
        }

        // Absolute URL already OK
        if (/^https?:\/\//i.test(img)) {
          resolvedImages.push(img);
          continue;
        }

        // Proxy URL -> extract storage path and convert to Zata URL
        const isProxyUrl = /^\/api\/proxy\/resource\//i.test(img) || /^\/proxy\/resource\//i.test(img);
        if (isProxyUrl) {
          const match = img.match(/\/(?:api\/)?proxy\/resource\/(.+)$/i);
          if (match && match[1]) {
            const storagePath = decodeURIComponent(match[1]);
            if (env.zataPrefix) {
              const zataUrl = env.zataPrefix.replace(/\/$/, '') + '/' + storagePath;
              resolvedImages.push(zataUrl);
              continue;
            }
          }
        }

        // If we got a bare storage path like "users/...", make it a Zata URL
        if (!img.startsWith('/') && env.zataPrefix && /^users\//i.test(img)) {
          resolvedImages.push(env.zataPrefix.replace(/\/$/, '') + '/' + img);
          continue;
        }

        // Fallback: last resort, try uploading from URL (will only work if accessible)
        try {
          const uploaded = await uploadFromUrlToZata({
            sourceUrl: img,
            keyPrefix,
            fileName: `qwen-image-edit-ref-${i + 1}`,
          });
          resolvedImages.push(uploaded.publicUrl);
          continue;
        } catch (e) {
          // keep going to final error
        }

        throw new ApiError(`Invalid image uri for qwen-image-edit: ${img}`, 400);
      }

      if (resolvedImages.length === 0) {
        throw new ApiError('image is required for qwen-image-edit', 400);
      }

      // Replicate Qwen Image Edit schema expects a single image URI.
      // The frontend may send multiple uploadedImages; use the first as the primary edit source.
      input.image = resolvedImages[0];

      // Prefer explicit aspect_ratio; fallback to frameSize mapping
      const aspect = rest.aspect_ratio ?? aspectRatio ?? 'match_input_image';
      input.aspect_ratio = String(aspect);

      // Qwen schema uses output_format values: webp | jpg | png
      if (rest.output_format != null) {
        const f = String(rest.output_format);
        input.output_format = f === 'jpeg' ? 'jpg' : f;
      }

      if (rest.output_quality != null && Number.isFinite(Number(rest.output_quality))) {
        input.output_quality = Math.max(1, Math.min(100, Number(rest.output_quality)));
      }

      if (typeof rest.go_fast === 'boolean') input.go_fast = rest.go_fast;
      if (typeof rest.disable_safety_checker === 'boolean') input.disable_safety_checker = rest.disable_safety_checker;
      if (rest.seed != null && Number.isInteger(Number(rest.seed))) input.seed = Number(rest.seed);
    }

    // Seedream 4.5 mapping removed – model now handled via FAL.
    // Seedream schema mapping
    if (modelBase === "bytedance/seedream-4") {
      // size handling
      const size = rest.size || "2K";
      if (["1K", "2K", "4K", "custom"].includes(String(size)))
        input.size = size;
      if (input.size === "custom") {
        if (rest.width) input.width = clamp(rest.width, 1024, 4096);
        if (rest.height) input.height = clamp(rest.height, 1024, 4096);
      }
      // aspect ratio (ignored if size=custom)
      if (rest.aspect_ratio) input.aspect_ratio = String(rest.aspect_ratio);
      // sequential image generation
      if (rest.sequential_image_generation)
        input.sequential_image_generation = String(
          rest.sequential_image_generation
        );
      // max_images
      if (rest.max_images != null)
        input.max_images = Math.max(1, Math.min(15, Number(rest.max_images)));
      // If user requests multiple images, Seedream requires sequential generation to be 'auto'
      if (
        (input.max_images ?? 1) > 1 &&
        input.sequential_image_generation !== "auto"
      ) {
        input.sequential_image_generation = "auto";
      }
      // multi-image input: ensure HTTP(S) URLs; upload data URIs to Zata first
      const username = creator?.username || uid;
      let images: string[] = Array.isArray(rest.image_input)
        ? rest.image_input.slice(0, 10)
        : [];
      if (!images.length && typeof rest.image === "string" && rest.image.length)
        images = [rest.image];
      // Track input images for saving to database
      const inputPersisted: any[] = [];
      if (images.length > 0) {
        const resolved: string[] = [];
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          try {
            if (typeof img === "string" && img.startsWith("data:")) {
              const uploaded = await uploadDataUriToZata({
                dataUri: img,
                keyPrefix: `users/${username}/input/${historyId}`,
                fileName: `seedream-ref-${i + 1}`,
              });
              resolved.push(uploaded.publicUrl);
              // Track for database persistence
              inputPersisted.push({
                id: `in-${i + 1}`,
                url: uploaded.publicUrl,
                storagePath: (uploaded as any).key,
                originalUrl: img,
              });
            } else if (typeof img === "string") {
              resolved.push(img);
              // Track external URLs (will be normalized and potentially re-uploaded)
              inputPersisted.push({
                id: `in-${i + 1}`,
                url: img,
                originalUrl: img,
              });
            }
          } catch {
            if (typeof img === "string") {
              resolved.push(img);
              inputPersisted.push({
                id: `in-${i + 1}`,
                url: img,
                originalUrl: img,
              });
            }
          }
        }
        // Normalize any out-of-range aspect ratios to Seedream's allowed bounds (0.33–3.0)
        async function normalizeIfNeeded(
          url: string,
          idx: number
        ): Promise<string> {
          try {
            let buf: Buffer | null = null;
            if (url.startsWith("data:")) {
              const comma = url.indexOf(",");
              const b64 = comma >= 0 ? url.slice(comma + 1) : "";
              buf = Buffer.from(b64, "base64");
            } else {
              const resp = await fetch(url as any);
              if (!resp.ok) return url;
              const ab = await resp.arrayBuffer();
              buf = Buffer.from(new Uint8Array(ab));
            }
            if (!buf) return url;
            const meta = await sharp(buf).metadata();
            const w = Number(meta.width || 0);
            const h = Number(meta.height || 0);
            if (!w || !h) return url;
            const ratio = w / h;
            const minR = 0.33;
            const maxR = 3.0;
            if (ratio >= minR && ratio <= maxR) return url; // already OK
            // Pad to nearest bound to avoid cropping content
            if (ratio > maxR) {
              const targetH = Math.ceil(w / maxR);
              const pad = Math.max(0, targetH - h);
              if (pad <= 0) return url;
              const top = Math.floor(pad / 2);
              const bottom = pad - top;
              const padded = await sharp(buf)
                .extend({
                  top,
                  bottom,
                  left: 0,
                  right: 0,
                  background: { r: 0, g: 0, b: 0 },
                })
                .toBuffer();
              const uploaded = await uploadDataUriToZata({
                dataUri: `data:image/jpeg;base64,${padded.toString("base64")}`,
                keyPrefix: `users/${username}/input/${historyId}`,
                fileName: `seedream-ref-fixed-${idx + 1}.jpg`,
              });
              // Update tracked input image with fixed version
              if (inputPersisted[idx]) {
                inputPersisted[idx] = {
                  id: `in-${idx + 1}`,
                  url: uploaded.publicUrl,
                  storagePath: (uploaded as any).key,
                  originalUrl: inputPersisted[idx].originalUrl || url,
                };
              }
              return uploaded.publicUrl;
            } else {
              // ratio < minR => too tall; pad width
              const targetW = Math.ceil(h * minR);
              const pad = Math.max(0, targetW - w);
              if (pad <= 0) return url;
              const left = Math.floor(pad / 2);
              const right = pad - left;
              const padded = await sharp(buf)
                .extend({
                  top: 0,
                  bottom: 0,
                  left,
                  right,
                  background: { r: 0, g: 0, b: 0 },
                })
                .toBuffer();
              const uploaded = await uploadDataUriToZata({
                dataUri: `data:image/jpeg;base64,${padded.toString("base64")}`,
                keyPrefix: `users/${username}/input/${historyId}`,
                fileName: `seedream-ref-fixed-${idx + 1}.jpg`,
              });
              // Update tracked input image with fixed version
              if (inputPersisted[idx]) {
                inputPersisted[idx] = {
                  id: `in-${idx + 1}`,
                  url: uploaded.publicUrl,
                  storagePath: (uploaded as any).key,
                  originalUrl: inputPersisted[idx].originalUrl || url,
                };
              }
              return uploaded.publicUrl;
            }
          } catch {
            return url;
          }
        }
        const fixed: string[] = [];
        for (let i = 0; i < resolved.length; i++) {
          // eslint-disable-next-line no-await-in-loop
          const fixedUrl = await normalizeIfNeeded(resolved[i], i);
          fixed.push(fixedUrl);
          // Update URL in tracked input if it was normalized
          if (inputPersisted[i] && fixedUrl !== resolved[i]) {
            inputPersisted[i].url = fixedUrl;
          }
        }
        if (fixed.length > 0) input.image_input = fixed;
        // Save input images to database
        if (inputPersisted.length > 0) {
          try {
            await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
            console.log('[replicateService.generateImage] Saved inputImages to database', { historyId, count: inputPersisted.length });
          } catch (e) {
            console.warn('[replicateService.generateImage] Failed to save inputImages:', e);
          }
        }
      }
      // Enforce total images cap when auto: input_count + max_images <= 15
      if (input.sequential_image_generation === "auto") {
        const inputCount = Array.isArray(input.image_input)
          ? input.image_input.length
          : 0;
        const requested =
          typeof input.max_images === "number" ? input.max_images : 1;
        if (inputCount + requested > 15) {
          input.max_images = Math.max(1, 15 - inputCount);
        }
      }
    }
    // Leonardo Phoenix 1.0 mapping
    if (modelBase === "leonardoai/phoenix-1.0") {
      if (rest.aspect_ratio) input.aspect_ratio = String(rest.aspect_ratio);
      if (rest.style) input.style = String(rest.style);
      if (rest.contrast) input.contrast = String(rest.contrast);
      if (rest.num_images != null)
        input.num_images = Math.max(1, Math.min(8, Number(rest.num_images)));
      if (typeof rest.prompt_enhance === "boolean")
        input.prompt_enhance = rest.prompt_enhance;
      if (rest.generation_mode)
        input.generation_mode = String(rest.generation_mode);
    }
    if (modelBase === "fermatresearch/magic-image-refiner") {
      if (input.hdr != null) input.hdr = clamp(input.hdr, 0, 1);
      if (input.creativity != null)
        input.creativity = clamp(input.creativity, 0, 1);
      if (input.resemblance != null)
        input.resemblance = clamp(input.resemblance, 0, 1);
      if (input.guidance_scale != null)
        input.guidance_scale = clamp(input.guidance_scale, 0.1, 30);
      if (input.steps != null)
        input.steps = Math.max(1, Math.min(100, Number(input.steps)));
      if (!input.resolution) input.resolution = "1024";
      // Magic Image Refiner uses input.image - save it as inputImages
      if (rest.image && typeof rest.image === 'string') {
        try {
          const username = creator?.username || uid;
          const keyPrefix = `users/${username}/input/${historyId}`;
          const inputPersisted: any[] = [];
          const stored = /^data:/i.test(rest.image)
            ? await uploadDataUriToZata({ dataUri: rest.image, keyPrefix, fileName: 'input-1' })
            : await uploadFromUrlToZata({ sourceUrl: rest.image, keyPrefix, fileName: 'input-1' });
          inputPersisted.push({ id: 'in-1', url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: rest.image });
          if (inputPersisted.length > 0) {
            await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
            console.log('[replicateService.generateImage] Saved inputImages for Magic Image Refiner', { historyId });
          }
        } catch (e) {
          console.warn('[replicateService.generateImage] Failed to save inputImages for Magic Image Refiner:', e);
        }
      }
    }
    // Ideogram v3 (Turbo/Quality) mapping
    // Replicate has separate models for quality and turbo, not a single model with mode parameter
    if (
      modelBase === "ideogram-ai/ideogram-v3-quality" ||
      modelBase === "ideogram-ai/ideogram-v3-turbo"
    ) {
      // Map supported fields from provided schema
      if (rest.aspect_ratio) input.aspect_ratio = String(rest.aspect_ratio);
      if (rest.resolution) input.resolution = String(rest.resolution);
      if (rest.magic_prompt_option)
        input.magic_prompt_option = String(rest.magic_prompt_option);
      if (rest.style_type) input.style_type = String(rest.style_type);
      if (rest.style_preset) input.style_preset = String(rest.style_preset);
      if (rest.image) input.image = String(rest.image);
      if (rest.mask) input.mask = String(rest.mask);
      if (rest.seed != null && Number.isInteger(rest.seed))
        input.seed = rest.seed;
      if (
        Array.isArray(rest.style_reference_images) &&
        rest.style_reference_images.length
      )
        input.style_reference_images = rest.style_reference_images
          .slice(0, 10)
          .map(String);
      // Use the model name directly - Replicate has separate models for quality and turbo
      // No need to set mode parameter, just use the correct model name
      replicateModelBase = modelBase; // Use the model name as-is: ideogram-ai/ideogram-v3-quality or ideogram-ai/ideogram-v3-turbo
      // Save input images for Ideogram (rest.image and rest.style_reference_images)
      try {
        const username = creator?.username || uid;
        const keyPrefix = `users/${username}/input/${historyId}`;
        const inputPersisted: any[] = [];
        let idx = 0;
        // Save main input image
        if (rest.image && typeof rest.image === 'string') {
          try {
            const stored = /^data:/i.test(rest.image)
              ? await uploadDataUriToZata({ dataUri: rest.image, keyPrefix, fileName: `input-${++idx}` })
              : await uploadFromUrlToZata({ sourceUrl: rest.image, keyPrefix, fileName: `input-${++idx}` });
            inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: rest.image });
          } catch { }
        }
        // Save style reference images
        if (Array.isArray(rest.style_reference_images) && rest.style_reference_images.length > 0) {
          for (const refImg of rest.style_reference_images.slice(0, 10)) {
            if (!refImg || typeof refImg !== 'string') continue;
            try {
              const stored = /^data:/i.test(refImg)
                ? await uploadDataUriToZata({ dataUri: refImg, keyPrefix, fileName: `input-${++idx}` })
                : await uploadFromUrlToZata({ sourceUrl: refImg, keyPrefix, fileName: `input-${++idx}` });
              inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: refImg });
            } catch { }
          }
        }
        if (inputPersisted.length > 0) {
          await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
          console.log('[replicateService.generateImage] Saved inputImages for Ideogram', { historyId, count: inputPersisted.length });
        }
      } catch (e) {
        console.warn('[replicateService.generateImage] Failed to save inputImages for Ideogram:', e);
      }
      // No additional clamping required; validator enforces enumerations and limits
    }
    // P-Image mapping (prunaai/p-image)
    if (modelBase === "prunaai/p-image" || modelBase === "p-image") {
      const allowedAspect = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', 'custom']);
      const aspect = allowedAspect.has(String(rest.aspect_ratio)) ? String(rest.aspect_ratio) : '16:9';
      input.aspect_ratio = aspect;
      if (rest.num_images != null) {
        const n = Number(rest.num_images);
        if (Number.isFinite(n)) {
          input.num_images = Math.max(1, Math.min(4, Math.round(n)));
          (body as any).__num_images = input.num_images;
        }
      }

      const roundTo16 = (v: number) => Math.round(v / 16) * 16;
      const clampDim = (v: number) => {
        const rounded = roundTo16(v);
        return Math.max(256, Math.min(1440, rounded));
      };

      // Default width/height to max 1440 while respecting aspect ratio
      const setDefaultDims = (ratio: string) => {
        const [wStr, hStr] = ratio.split(':');
        const w = Number(wStr) || 1;
        const h = Number(hStr) || 1;
        const aspectVal = w / h;
        let width: number;
        let height: number;
        if (aspectVal >= 1) {
          width = 1440;
          height = roundTo16(1440 / aspectVal);
        } else {
          height = 1440;
          width = roundTo16(1440 * aspectVal);
        }
        input.width = clampDim(width);
        input.height = clampDim(height);
      };

      if (rest.width != null) input.width = clampDim(Number(rest.width));
      if (rest.height != null) input.height = clampDim(Number(rest.height));

      // If custom aspect ratio selected but width/height not provided, default to max 1440 each
      if (aspect === 'custom') {
        if (input.width == null) input.width = 1440;
        if (input.height == null) input.height = 1440;
        input.width = clampDim(input.width);
        input.height = clampDim(input.height);
      } else {
        // Non-custom: if width/height not provided, derive from aspect with max 1440 edge
        if (input.width == null || input.height == null) {
          setDefaultDims(aspect);
        }
      }

      if (rest.seed != null && Number.isInteger(rest.seed)) input.seed = rest.seed;
      if (typeof rest.prompt_upsampling === 'boolean') input.prompt_upsampling = rest.prompt_upsampling;
      if (typeof rest.disable_safety_checker === 'boolean') input.disable_safety_checker = rest.disable_safety_checker;

      // Handle image-to-image: P-Image supports image_input parameter for image-to-image generation
      if (rest.image_input && Array.isArray(rest.image_input) && rest.image_input.length > 0) {
        // P-Image uses 'image' parameter (single image) for image-to-image, not 'image_input'
        // Take the first image from image_input array
        input.image = rest.image_input[0];
        console.log('[replicateService] P-Image: Using image-to-image mode with source image');
      } else if (rest.image && typeof rest.image === 'string' && rest.image.length > 0) {
        // Also support direct 'image' parameter
        input.image = rest.image;
        console.log('[replicateService] P-Image: Using image-to-image mode with direct image parameter');
      }
    }
    // P-Image-Edit mapping (prunaai/p-image-edit) - image-to-image only
    if (modelBase === "prunaai/p-image-edit" || modelBase === "p-image-edit") {
      const images = Array.isArray(rest.images) ? rest.images.filter((i: any) => typeof i === 'string') : [];
      if (images.length === 0) {
        throw new ApiError("P-Image-Edit requires at least one image", 400);
      }
      input.images = images;
      if (rest.num_images != null) {
        const n = Number(rest.num_images);
        if (Number.isFinite(n)) {
          input.num_images = Math.max(1, Math.min(4, Math.round(n)));
          (body as any).__num_images = input.num_images;
        }
      }
      const allowedAspect = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']);
      const aspect = allowedAspect.has(String(rest.aspect_ratio)) ? String(rest.aspect_ratio) : '1:1';
      input.aspect_ratio = aspect;

      // Clamp width/height to <=1024 and divisible by 16; if missing, derive from aspect with max edge 1024
      const round16 = (v: number) => Math.round(v / 16) * 16;
      const clamp = (v: number) => Math.max(256, Math.min(1024, round16(v)));
      const deriveDims = (ratio: string) => {
        const [wStr, hStr] = ratio.split(':');
        const w = Number(wStr) || 1;
        const h = Number(hStr) || 1;
        const aspectVal = w / h;
        let width: number;
        let height: number;
        if (aspectVal >= 1) {
          width = 1024;
          height = round16(1024 / aspectVal);
        } else {
          height = 1024;
          width = round16(1024 * aspectVal);
        }
        // ensure ~1MP cap
        while (width * height > 1048576) {
          width = clamp(width - 16);
          height = clamp(Math.round(width / aspectVal));
        }
        return { width: clamp(width), height: clamp(height) };
      };

      if (rest.width != null) input.width = clamp(Number(rest.width));
      if (rest.height != null) input.height = clamp(Number(rest.height));
      if (input.width == null || input.height == null) {
        const dims = deriveDims(aspect);
        input.width = input.width ?? dims.width;
        input.height = input.height ?? dims.height;
      }

      if (rest.seed != null && Number.isInteger(rest.seed)) input.seed = rest.seed;
      if (typeof rest.turbo === 'boolean') input.turbo = rest.turbo;
      if (typeof rest.disable_safety_checker === 'boolean') input.disable_safety_checker = rest.disable_safety_checker;

      // Persist input images to history for edit flows
      try {
        const username = creator?.username || uid;
        const keyPrefix = `users/${username}/input/${historyId}`;
        const inputPersisted: any[] = [];
        let idx = 0;
        for (const img of images) {
          if (!img || typeof img !== 'string') continue;
          try {
            const stored = /^data:/i.test(img)
              ? await uploadDataUriToZata({ dataUri: img, keyPrefix, fileName: `p-image-edit-${++idx}` })
              : await uploadFromUrlToZata({ sourceUrl: img, keyPrefix, fileName: `p-image-edit-${++idx}` });
            inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: img });
          } catch { }
        }
        if (inputPersisted.length > 0) {
          await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
        }
      } catch { }
    }
    // New Turbo Model mapping (z-image-turbo)
    // Using actual Replicate model identifier: prunaai/z-image-turbo with version hash
    if (modelBase === "z-image-turbo" || modelBase === "new-turbo-model" || modelBase === "placeholder-model-name") {
      console.log('[replicateService] Z Image Turbo request:', {
        width: rest.width,
        height: rest.height,
        num_inference_steps: rest.num_inference_steps,
        guidance_scale: rest.guidance_scale,
        image_input: !!rest.image_input,
        image: !!rest.image
      });

      // Map all supported parameters from schema
      // z-image-turbo requires width and height to be divisible by 16
      // Schema: width/height max 1440, min 64, default 1024
      if (rest.width != null) {
        const w = Number(rest.width);
        const rounded = Math.round(w / 16) * 16; // Round to nearest multiple of 16
        input.width = Math.max(64, Math.min(1440, rounded));
      } else {
        input.width = 1024; // Schema default
      }
      if (rest.height != null) {
        const h = Number(rest.height);
        const rounded = Math.round(h / 16) * 16; // Round to nearest multiple of 16
        input.height = Math.max(64, Math.min(1440, rounded));
      } else {
        input.height = 1024; // Schema default
      }
      if (rest.num_inference_steps != null) {
        input.num_inference_steps = Math.max(1, Math.min(50, Number(rest.num_inference_steps)));
      }

      if (rest.guidance_scale != null) {
        input.guidance_scale = Math.max(0, Math.min(20, Number(rest.guidance_scale)));
      }
      if (rest.seed != null && Number.isInteger(rest.seed)) input.seed = rest.seed;
      if (rest.output_format && ['png', 'jpg', 'webp'].includes(String(rest.output_format))) {
        input.output_format = String(rest.output_format);
      }
      if (rest.output_quality != null) input.output_quality = Math.max(0, Math.min(100, Number(rest.output_quality)));
      // Support num_images parameter for multiple image generation
      // If num_images is provided, we'll handle it by making multiple calls internally
      const numImages = rest.num_images != null ? Math.max(1, Math.min(4, Number(rest.num_images))) : 1;
      // Map frontend model name to actual Replicate model identifier
      // Actual Replicate model: prunaai/z-image-turbo with version hash from DEFAULT_VERSION_BY_MODEL
      const ACTUAL_REPLICATE_MODEL = "prunaai/z-image-turbo";

      replicateModelBase = ACTUAL_REPLICATE_MODEL;
      // Ensure version is used from DEFAULT_VERSION_BY_MODEL if not provided
      // This ensures the model spec includes the required version hash
      if (!body.version && DEFAULT_VERSION_BY_MODEL[ACTUAL_REPLICATE_MODEL]) {
        body.version = DEFAULT_VERSION_BY_MODEL[ACTUAL_REPLICATE_MODEL];
      }

      // Store num_images for later use in the generation logic
      (body as any).__num_images = numImages;

      // Handle image input for image-to-image generation
      if (rest.image_input && Array.isArray(rest.image_input) && rest.image_input.length > 0) {
        input.image = rest.image_input[0];
      } else if (rest.image) {
        input.image = rest.image;
      }
    }
    // GPT Image 1.5 mapping
    if (modelBase === "openai/gpt-image-1.5") {
      // Map all supported parameters from schema
      if (rest.quality && ['low', 'medium', 'high', 'auto'].includes(String(rest.quality))) {
        input.quality = String(rest.quality);
      } else {
        input.quality = 'low'; // Default to low quality
      }
      if (rest.aspect_ratio && ['1:1', '3:2', '2:3'].includes(String(rest.aspect_ratio))) {
        input.aspect_ratio = String(rest.aspect_ratio);
      } else {
        input.aspect_ratio = '1:1'; // Default per schema
      }
      // The frontend commonly sends `n`; schema uses `number_of_images`.
      const requestedImagesRaw =
        rest.number_of_images != null ? rest.number_of_images : rest.n != null ? rest.n : undefined;
      if (requestedImagesRaw != null) {
        input.number_of_images = Math.max(1, Math.min(10, Number(requestedImagesRaw)));
      } else {
        input.number_of_images = 1; // Default per schema
      }
      if (rest.output_format && ['png', 'jpeg', 'webp', 'jpg'].includes(String(rest.output_format))) {
        // Map 'jpg' to 'jpeg' (API expects 'jpeg')
        const format = String(rest.output_format);
        input.output_format = format === 'jpg' ? 'jpeg' : format;
      } else {
        input.output_format = 'jpeg'; // Default to jpeg (jpg)
      }
      if (rest.background && ['auto', 'transparent', 'opaque'].includes(String(rest.background))) {
        input.background = String(rest.background);
      } else {
        input.background = 'auto'; // Default per schema
      }
      if (rest.moderation && ['auto', 'low'].includes(String(rest.moderation))) {
        input.moderation = String(rest.moderation);
      } else {
        input.moderation = 'auto'; // Default per schema
      }
      if (rest.output_compression != null) {
        input.output_compression = Math.max(0, Math.min(100, Number(rest.output_compression)));
      } else {
        input.output_compression = 90; // Default per schema
      }
      // Handle input_images for I2I - map from uploadedImages if present
      const inputImagesSource = rest.input_images || rest.uploadedImages;
      if (inputImagesSource && Array.isArray(inputImagesSource) && inputImagesSource.length > 0) {
        const username = creator?.username || uid;
        const keyPrefix = `users/${username}/input/${historyId}`;
        const inputPersisted: any[] = [];
        const resolvedImages: string[] = [];
        for (let i = 0; i < Math.min(inputImagesSource.length, 10); i++) {
          const img = inputImagesSource[i];
          try {
            if (typeof img === "string" && img.startsWith("data:")) {
              // Handle data URIs
              const uploaded = await uploadDataUriToZata({
                dataUri: img,
                keyPrefix,
                fileName: `gpt-image-1.5-ref-${i + 1}`,
              });
              resolvedImages.push(uploaded.publicUrl);
              inputPersisted.push({
                id: `in-${i + 1}`,
                url: uploaded.publicUrl,
                storagePath: uploaded.key,
              });
            } else if (typeof img === "string") {
              // Check if it's a proxy URL, Zata URL, or absolute URL
              const isProxyUrl = /^\/api\/proxy\/resource\//i.test(img) || /^\/proxy\/resource\//i.test(img);
              const isZataUrl = env.zataPrefix && img.startsWith(env.zataPrefix);
              const isAbsoluteUrl = img.startsWith("http://") || img.startsWith("https://");

              if (isProxyUrl) {
                // Extract storage path from proxy URL and construct Zata URL
                try {
                  // Match proxy URL pattern: /api/proxy/resource/... or /proxy/resource/...
                  // Extract everything after /proxy/resource/ or /api/proxy/resource/
                  const storagePathMatch = img.match(/\/proxy\/resource\/(.+)$/i);
                  if (storagePathMatch && storagePathMatch[1]) {
                    // Decode URL-encoded path (e.g., users%2Fvivek -> users/vivek)
                    const storagePath = decodeURIComponent(storagePathMatch[1]);

                    // Construct Zata URL using zataPrefix
                    if (env.zataPrefix) {
                      const zataUrl = env.zataPrefix.replace(/\/$/, '') + '/' + storagePath;
                      resolvedImages.push(zataUrl);
                      inputPersisted.push({
                        id: `in-${i + 1}`,
                        url: zataUrl,
                        storagePath: storagePath,
                      });
                    } else {
                      console.warn(`[gpt-image-1.5] zataPrefix not configured, cannot convert proxy URL for image ${i + 1}`);
                      throw new Error('Zata prefix not configured');
                    }
                  } else {
                    throw new Error('Failed to extract storage path from proxy URL');
                  }
                } catch (uploadErr) {
                  console.error(`[gpt-image-1.5] Failed to process proxy URL ${i + 1}:`, uploadErr);
                  // If we can't convert, we must fail - proxy URLs can't be used directly with Replicate
                  throw new ApiError(`Failed to convert proxy URL to accessible URL for image ${i + 1}: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`, 400);
                }
              } else if (isZataUrl) {
                // Already a Zata URL, use directly
                resolvedImages.push(img);
                inputPersisted.push({
                  id: `in-${i + 1}`,
                  url: img,
                  storagePath: img.substring(env.zataPrefix!.length),
                });
              } else if (isAbsoluteUrl) {
                // Absolute HTTP/HTTPS URL, use directly (Replicate can fetch these)
                resolvedImages.push(img);
                inputPersisted.push({
                  id: `in-${i + 1}`,
                  url: img,
                });
              } else {
                // Relative or unknown URL format, try uploadFromUrlToZata
                try {
                  const uploaded = await uploadFromUrlToZata({
                    sourceUrl: img,
                    keyPrefix,
                    fileName: `gpt-image-1.5-ref-${i + 1}`,
                  });
                  resolvedImages.push(uploaded.publicUrl);
                  inputPersisted.push({
                    id: `in-${i + 1}`,
                    url: uploaded.publicUrl,
                    storagePath: uploaded.key,
                  });
                } catch (uploadErr) {
                  console.warn(`[gpt-image-1.5] Failed to process URL ${i + 1}:`, uploadErr);
                }
              }
            }
          } catch (e) {
            console.warn(`[gpt-image-1.5] Failed to process input image ${i + 1}:`, e);
          }
        }
        if (resolvedImages.length > 0) {
          input.input_images = resolvedImages;
        }
        if (inputPersisted.length > 0) {
          await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
        }
      }
      replicateModelBase = "openai/gpt-image-1.5";

      // Handle num_images for multiple image generation
      const numImages = input.number_of_images || 1;
      if (numImages > 1) {
        // Store num_images for later use in the generation logic
        (body as any).__num_images = numImages;

        // When we fan-out internally, each upstream call should generate 1 image.
        // This avoids accidental multiplication if the provider starts honoring number_of_images.
        input.number_of_images = 1;
      }
    }
    const modelSpec = composeModelSpec(replicateModelBase, body.version);
    // eslint-disable-next-line no-console
    console.log("[replicateService.generateImage] run", {
      requestedModel: modelBase,
      replicateModelBase,
      bodyVersion: body.version,
      resolvedModelSpec: modelSpec,
      hasImage: !!rest.image,
      inputKeys: Object.keys(input),
      modelSpecIncludesVersion: modelSpec.includes(':'),
    });
    if (modelBase === "bytedance/seedream-4") {
      try {
        const preDump = {
          incoming_image_input_count: Array.isArray(rest.image_input)
            ? rest.image_input.length
            : 0,
          incoming_first_is_data_uri: Array.isArray(rest.image_input)
            ? typeof rest.image_input[0] === "string" &&
            rest.image_input[0]?.startsWith("data:")
            : false,
        };
        console.debug(
          "[seedream] incoming image_input summary",
          JSON.stringify(preDump)
        );
      } catch { }
    }
    if (modelBase === "bytedance/seedream-4") {
      try {
        // Deep print for Seedream I2I debugging
        const dump = {
          prompt: input.prompt,
          size: input.size,
          aspect_ratio: input.aspect_ratio,
          sequential_image_generation: input.sequential_image_generation,
          max_images: input.max_images,
          image_input_count: Array.isArray(input.image_input)
            ? input.image_input.length
            : 0,
          image_input_sample: Array.isArray(input.image_input)
            ? input.image_input.slice(0, 2)
            : [],
          model: modelBase,
          isPublic: body.isPublic === true,
        };
        // eslint-disable-next-line no-console
        console.debug("[seedream] input dump", JSON.stringify(dump, null, 2));
      } catch { }
    }
    // Handle num_images fan-out for models that need parallel calls
    // Supported: z-image-turbo, P-Image / P-Image-Edit, and GPT Image 1.5
    let output: any;
    const numImages = (body as any).__num_images || 1;
    const isZTurbo = (modelBase === "new-turbo-model" || modelBase === "placeholder-model-name");
    const isPImage = replicateModelBase === "prunaai/p-image";
    const isPImageEdit = replicateModelBase === "prunaai/p-image-edit";
    const isGptImage15 = replicateModelBase === "openai/gpt-image-1.5";

    if ((isZTurbo || isPImage || isPImageEdit || isGptImage15) && numImages > 1) {
      // Make multiple parallel calls
      const outputPromises = Array.from({ length: numImages }, async () => {
        return await replicate.run(modelSpec as any, { input });
      });
      const outputs = await Promise.all(outputPromises);
      const allResolvedUrls: string[] = [];
      for (const out of outputs) {
        const urls = await resolveOutputUrls(out);
        if (urls && urls.length > 0) {
          allResolvedUrls.push(...urls);
        }
      }
      outputUrls = allResolvedUrls;
      output = [];
    } else {
      // Single image generation (default behavior)
      output = await replicate.run(modelSpec as any, { input });
    }

    // eslint-disable-next-line no-console
    console.log(
      "[replicateService.generateImage] output",
      typeof output,
      Array.isArray(output) ? output.length : "n/a"
    );
    console.log("[replicateService.generateImage] output", output);
    if (modelBase === "bytedance/seedream-4") {
      try {
        if (Array.isArray(output)) {
          const first = output[0];
          const firstInfo = first
            ? typeof first === "string"
              ? first
              : typeof first?.url === "function"
                ? "[function url()]"
                : Object.keys(first || {})
            : null;
          // eslint-disable-next-line no-console
          console.debug("[seedream] output array[0] info", firstInfo);
          // Deep inspect entire array with safe depth
          console.debug(
            "[seedream] output full inspect",
            util.inspect(output, { depth: 4, maxArrayLength: 50 })
          );
          // Attempt to resolve urls for each item with logging
          for (let i = 0; i < output.length; i++) {
            try {
              const val = output[i];
              const url = await resolveItemUrl(val);
              console.debug(
                `[seedream] output[${i}] typeof=${typeof val} hasUrlFn=${typeof val?.url === "function"
                } resolvedUrl=${url || "<none>"}`
              );
            } catch (e) {
              console.debug(
                `[seedream] output[${i}] resolve error`,
                (e as any)?.message || e
              );
            }
          }
        } else if (output && typeof output === "object") {
          // eslint-disable-next-line no-console
          console.debug("[seedream] output object keys", Object.keys(output));
          console.debug(
            "[seedream] output full inspect",
            util.inspect(output, { depth: 4 })
          );
        }
      } catch { }
    }
    // Seedream returns an array of urls per schema; handle multiple
    // Skip if outputUrls already set (for z-turbo num_images handling)
    if (outputUrls.length === 0) {
      outputUrls = await resolveOutputUrls(output);
    }
    // If fewer images returned than requested, fall back to sequential reruns
    if (modelBase === "bytedance/seedream-4") {
      const requested =
        typeof input.max_images === "number" ? input.max_images : 1;
      if (requested > 1 && outputUrls.length < requested) {
        // eslint-disable-next-line no-console
        console.warn(
          `[seedream] provider returned ${outputUrls.length
          }/${requested}; running additional ${requested - outputUrls.length
          } times sequentially`
        );
        const runsNeeded = Math.max(
          0,
          Math.min(15, requested - outputUrls.length)
        );
        for (let i = 0; i < runsNeeded; i++) {
          try {
            const rerunInput = {
              ...input,
              max_images: 1,
              sequential_image_generation: "disabled",
            };
            const more: any = await replicate.run(modelSpec as any, {
              input: rerunInput,
            });
            const moreUrls = await resolveOutputUrls(more);
            if (moreUrls && moreUrls.length)
              outputUrls.push(...moreUrls.slice(0, 1));
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error(
              "[seedream] sequential fallback run failed",
              (e as any)?.message || e
            );
          }
          if (outputUrls.length >= requested) break;
        }
      }
    }
    if (!outputUrls.length && Array.isArray(output)) {
      // Fallback: Replicate returned file-like streams; read and upload to Zata directly
      // eslint-disable-next-line no-console
      console.warn(
        "[replicateService.generateImage] no URL strings; attempting stream->buffer->Zata fallback"
      );
      const username = creator?.username || uid;
      const uploadedUrls: string[] = [];
      for (let i = 0; i < output.length; i++) {
        const item = output[i];
        try {
          let arrayBuffer: ArrayBuffer | null = null;
          if (item && typeof item.arrayBuffer === "function") {
            arrayBuffer = await item.arrayBuffer();
          } else if (typeof Response !== "undefined") {
            // Wrap in Response to consume web ReadableStream
            const resp = new Response(item as any);
            arrayBuffer = await resp.arrayBuffer();
          }
          if (arrayBuffer) {
            const buffer = Buffer.from(new Uint8Array(arrayBuffer));
            const b64 = buffer.toString("base64");
            const dataUri = `data:image/png;base64,${b64}`; // best-effort default; Replicate images are typically PNG/JPG
            const uploaded = await uploadDataUriToZata({
              dataUri,
              keyPrefix: storageKeyPrefixOverride || `users/${username}/image/${historyId}`,
              fileName: `${buildReplicateImageFileName(historyId, i)}.png`,
            });
            uploadedUrls.push(uploaded.publicUrl);
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(
            "[replicateService.generateImage] stream fallback upload failed",
            (e as any)?.message || e
          );
        }
      }
      if (uploadedUrls.length) outputUrls = uploadedUrls;
    }
    if (!outputUrls.length) {
      try {
        // eslint-disable-next-line no-console
        console.error(
          "[replicateService.generateImage] no urls – raw output dump (truncated)",
          JSON.stringify(output, null, 2).slice(0, 2000)
        );
      } catch { }
      throw new Error("No output URL returned by Replicate");
    }
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[replicateService.generateImage] error", e?.message || e);
    console.error("[replicateService.generateImage] error details", {
      modelBase,
      replicateModelBase: replicateModelBase || modelBase,
      errorMessage: e?.message,
      errorDetails: e?.response?.data || e?.data || e,
    });

    // Extract more detailed error message
    let errorMessage = "Replicate generation failed";
    if (e?.message) {
      errorMessage = e.message;
    } else if (e?.response?.data?.detail) {
      errorMessage = e.response.data.detail;
    } else if (e?.response?.data?.error) {
      errorMessage = e.response.data.error;
    } else if (typeof e === 'string') {
      errorMessage = e;
    }

    try {
      await replicateRepository.updateGenerationRecord(legacyId, {
        status: "failed",
        error: errorMessage || "Replicate failed",
      });
    } catch { }
    await generationHistoryRepository.update(uid, historyId, {
      status: "failed",
      error: errorMessage || "Replicate failed",
    } as any);
    throw new ApiError(errorMessage || "Replicate generation failed", 502, e);
  }

  // Upload possibly multiple output URLs
  const uploadedImages: Array<{
    id: string;
    url: string;
    storagePath?: string;
    originalUrl: string;
  }> = [];
  try {
    const username = creator?.username || uid;
    let idx = 1;
    for (const out of outputUrls) {
      try {
        const uploaded = await uploadFromUrlToZata({
          sourceUrl: out,
          keyPrefix: storageKeyPrefixOverride || `users/${username}/image/${historyId}`,
          fileName: buildReplicateImageFileName(historyId, idx - 1),
        });
        uploadedImages.push({
          id: `replicate-${Date.now()}-${idx}`,
          url: uploaded.publicUrl,
          storagePath: uploaded.key,
          originalUrl: out,
        });
      } catch {
        uploadedImages.push({
          id: `replicate-${Date.now()}-${idx}`,
          url: out,
          originalUrl: out,
        });
      }
      idx++;
    }
  } catch {
    // Fallback: store raw urls
    uploadedImages.push(
      ...outputUrls.map((out, i) => ({
        id: `replicate-${Date.now()}-${i + 1}`,
        url: out,
        originalUrl: out,
      }))
    );
  }

  // Score the images for aesthetic quality (generateImage function)
  const scoredImages = await aestheticScoreService.scoreImages(uploadedImages);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);
  // Preserve inputImages if they were already saved (don't overwrite them)
  const existing = await generationHistoryRepository.get(uid, historyId);
  const updateData: any = {
    status: "completed",
    images: scoredImages as any,
    aestheticScore: highestScore,
  };
  // Preserve inputImages if they exist
  if (existing && Array.isArray((existing as any).inputImages) && (existing as any).inputImages.length > 0) {
    updateData.inputImages = (existing as any).inputImages;
  }
  await generationHistoryRepository.update(uid, historyId, updateData);
  try { console.log('[Replicate.generateImage] History updated with scores', { historyId, imageCount: scoredImages.length, highestScore }); } catch { }
  try {
    await replicateRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      images: scoredImages as any,
    });
  } catch { }
  // Trigger optimization and re-enqueue mirror update (non-blocking)
  try {
    console.log(
      "[replicateService.generateImage] triggering markGenerationCompleted",
      { uid, historyId, isPublic: body?.isPublic === true }
    );
    markGenerationCompleted(uid, historyId, {
      status: "completed",
      images: scoredImages as any,
      isPublic: body?.isPublic === true,
    }).catch((e: any) =>
      console.error(
        "[replicateService.generateImage] markGenerationCompleted failed",
        e
      )
    );
  } catch (e) {
    console.warn(
      "[replicateService.generateImage] markGenerationCompleted call error",
      e
    );
  }
  // Robust mirror sync with retry logic
  await syncToMirror(uid, historyId);
  return {
    images: scoredImages,
    aestheticScore: highestScore,
    historyId,
    model: modelBase,
    status: "completed",
  } as any;
}

export async function qwenImageEditSubmit(
  uid: string,
  body: any
): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError("prompt is required", 400);
  if (!body?.image) throw new ApiError("image is required", 400);

  const key = env.replicateApiKey as string;
  if (!key) {
    console.error("[replicateService.qwenImageEditSubmit] Missing REPLICATE_API_TOKEN");
    throw new ApiError("Replicate API key not configured", 500);
  }

  const replicate = new Replicate({ auth: key });
  const modelBase = 'qwen/qwen-image-edit-2511';
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);

  const aspect = ((): string => {
    const a = String(body?.aspect_ratio ?? 'match_input_image');
    const allowed = ['1:1','16:9','9:16','4:3','3:4','match_input_image'];
    return allowed.includes(a) ? a : 'match_input_image';
  })();

  const outFormat = ((): string => {
    const f = String(body?.output_format ?? 'webp');
    return ['webp','jpg','png'].includes(f) ? f : 'webp';
  })();

  const outputQuality = Number.isFinite(Number(body?.output_quality)) ? Number(body.output_quality) : 95;
  const goFast = typeof body.go_fast === 'boolean' ? body.go_fast : true;
  const disableSafety = typeof body.disable_safety_checker === 'boolean' ? body.disable_safety_checker : false;

  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: 'image-to-image',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy,
    aspect_ratio: aspect,
    output_format: outFormat,
    output_quality: outputQuality,
    go_fast: goFast,
    disable_safety_checker: disableSafety,
  } as any);

  // Persist input images for preview/storage (if any)
  try {
    const username = creator?.username || uid;
    const keyPrefix = `users/${username}/input/${historyId}`;
    const urls: string[] = [];
    if (Array.isArray(body.image)) {
      for (const it of body.image.slice(0, 8)) if (typeof it === 'string' && it.length > 5) urls.push(it);
    } else if (typeof body.image === 'string' && body.image.length > 5) {
      urls.push(body.image);
    }
    const inputPersisted: any[] = [];
    let idx = 0;
    for (const src of urls) {
      try {
        const stored = /^data:/i.test(src)
          ? await uploadDataUriToZata({ dataUri: src, keyPrefix, fileName: `input-${++idx}` })
          : await uploadFromUrlToZata({ sourceUrl: src, keyPrefix, fileName: `input-${++idx}` });
        inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: src });
      } catch (e) { /* ignore upload failures */ }
    }
    if (inputPersisted.length > 0) await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
  } catch { }

  // Build replicate input
  const input: any = {
    prompt: body.prompt,
    // Replicate Qwen Image Edit schema expects a single image URI.
    image: Array.isArray(body.image) ? String(body.image[0] || '') : String(body.image),
    aspect_ratio: aspect,
    output_format: outFormat,
    output_quality: outputQuality,
    go_fast: goFast,
    disable_safety_checker: disableSafety,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed))) input.seed = Number(body.seed);

  // Submit prediction to Replicate (queue-style)
  let predictionId = '';
  try {
    let version: string | null = null;
    try { version = await getLatestModelVersion(replicate, modelBase); } catch (vErr) { /* ignore */ }
    const pred = await replicate.predictions.create(version ? { version, input } : { model: modelBase, input });
    predictionId = (pred as any)?.id || '';
    if (!predictionId) throw new Error('Missing prediction id');
  } catch (e: any) {
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate submit failed' } as any);
    throw new ApiError(`Failed to submit Qwen image edit job: ${e?.message || e}`, 502, e);
  }

  await generationHistoryRepository.update(uid, historyId, { provider: 'replicate', providerTaskId: predictionId } as any);

  return {
    requestId: predictionId,
    historyId,
    model: modelBase,
    status: 'submitted',
  } as any;
}

export const replicateService = {
  removeBackground,
  upscale,
  generateImage,
  multiangle,
  wanI2V,
  wanT2V,
  nextScene,
  qwenImageEditSubmit,
};
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
    ? "wan-video/wan-2.5-i2v-fast"
    : "wan-video/wan-2.5-i2v";
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "image-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    // Save params for potential delayed debit
    duration: ((): any => {
      const s = String(body?.duration ?? "5").toLowerCase();
      const m = s.match(/(5|10)/);
      return m ? Number(m[1]) : 5;
    })(),
    resolution: ((): any => {
      const s = String(body?.resolution ?? "720p").toLowerCase();
      const m = s.match(/(480|720|1080)/);
      return m ? `${m[1]}p` : "720p";
    })(),
  } as any);
  const legacyId = await replicateRepository.createGenerationRecord(
    { prompt: body.prompt, model: modelBase, isPublic: body.isPublic === true },
    createdBy
  );

  // Prepare input mapping
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

export const _wan = { wanI2V };
Object.assign(replicateService, { wanI2V });

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
Object.assign(replicateService, { wanT2V });

// ============ Queue-style API for Replicate WAN 2.5 ============

type SubmitReturn = {
  requestId: string;
  historyId: string;
  model: string;
  status: "submitted";
};

async function resolveWanModelFast(body: any): Promise<boolean> {
  const s = (body?.speed ?? "").toString().toLowerCase();
  const m = (body?.model ?? "").toString().toLowerCase();
  const speedFast =
    s === "fast" || s === "true" || s.includes("fast") || body?.speed === true;
  const modelFast = m.includes("fast");
  return speedFast || modelFast;
}

function ensureReplicate(): any {
  // env.replicateApiKey already handles REPLICATE_API_TOKEN as fallback in env.ts
  const key = env.replicateApiKey as string;
  if (!key) {
    // eslint-disable-next-line no-console
    console.error("[replicateQueue] Missing REPLICATE_API_TOKEN");
    throw new ApiError("Replicate API key not configured", 500);
  }
  return new Replicate({ auth: key });
}

async function getLatestModelVersion(
  replicate: any,
  modelBase: string
): Promise<string | null> {
  try {
    // Prefer model slug with latest version lookup; fallback to using model slug directly in predictions.create
    const [owner, name] = modelBase.split("/");
    if (!owner || !name) return null;
    const model = await replicate.models.get(`${owner}/${name}`);
    const latestVersion =
      (model as any)?.latest_version?.id ||
      (Array.isArray((model as any)?.versions)
        ? (model as any).versions[0]?.id
        : null);
    return latestVersion || null;
  } catch {
    return null;
  }
}

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
      status: e?.status || e?.statusCode,
      response: e?.response?.data,
    });

    // Handle 404 specifically - prediction not found
    const statusCode = e?.status || e?.statusCode || e?.response?.status;
    if (statusCode === 404) {
      throw new ApiError(
        `Prediction not found. The prediction ID "${requestId}" may be invalid, expired, or the prediction may have been deleted.`,
        404,
        e
      );
    }

    // Extract error message from response
    let errorMessage = e?.message || "Failed to fetch Replicate status";
    if (e?.response?.data) {
      if (typeof e.response.data === 'string') {
        errorMessage = e.response.data;
      } else if (e.response.data.detail) {
        errorMessage = e.response.data.detail;
      } else if (e.response.data.message) {
        errorMessage = e.response.data.message;
      }
    }

    throw new ApiError(errorMessage, statusCode || 502, e);
  }
}

/**
 * Polls a prediction until it completes (succeeded, failed, canceled) or times out.
 * @param predictionId ID of the prediction to poll
 * @param timeoutMs Max wait time in ms (default 5 mins)
 * @param intervalMs Polling interval in ms (default 2s)
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
    const inputFromPrediction = (result as any)?.input || {};
    const audioFromPrediction =
      typeof inputFromPrediction?.generate_audio === "boolean"
        ? inputFromPrediction.generate_audio
        : typeof inputFromPrediction?.generateAudio === "boolean"
          ? inputFromPrediction.generateAudio
          : undefined;
    const aspectFromPrediction =
      typeof inputFromPrediction?.aspect_ratio === "string"
        ? inputFromPrediction.aspect_ratio
        : undefined;
    await generationHistoryRepository.update(uid, historyId, {
      status: "completed",
      videos: scoredVideos,
      aestheticScore: highestScore,
      // Preserve duration and resolution from original history if they exist
      ...(currentHistory && (currentHistory as any)?.duration ? { duration: (currentHistory as any).duration } : {}),
      ...(currentHistory && (currentHistory as any)?.resolution ? { resolution: (currentHistory as any).resolution } : {}),
      // Preserve quality field (for PixVerse models)
      ...(currentHistory && (currentHistory as any)?.quality ? { quality: (currentHistory as any).quality } : {}),
      // Preserve Seedance 1.5 fields if we have them (needed for correct pricing)
      ...(currentHistory && typeof (currentHistory as any)?.generate_audio === "boolean"
        ? { generate_audio: (currentHistory as any).generate_audio }
        : typeof audioFromPrediction === "boolean"
          ? { generate_audio: audioFromPrediction }
          : {}),
      ...(currentHistory && typeof (currentHistory as any)?.aspect_ratio === "string"
        ? { aspect_ratio: (currentHistory as any).aspect_ratio }
        : typeof aspectFromPrediction === "string"
          ? { aspect_ratio: aspectFromPrediction }
          : {}),
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
        const audioFromPredictionInput = (result as any)?.input?.generate_audio ?? (result as any)?.input?.generateAudio;
        const fakeReq = {
          body: {
            kind: kindFromHistory,
            duration: duration,
            resolution: resolution,
            model: (fresh as any)?.model,
            // Preserve audio flag from stored history so pricing uses correct SKU (Audio On/Off)
            generate_audio:
              typeof (fresh as any)?.generate_audio === "boolean"
                ? (fresh as any).generate_audio
                : typeof (fresh as any)?.generateAudio === "boolean"
                  ? (fresh as any).generateAudio
                  : typeof audioFromPredictionInput === "boolean"
                    ? audioFromPredictionInput
                    : false,
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
  const isSeedance15 = modelStr.includes('seedance-1.5') || speed.includes('1.5');
  const isLite =
    modelStr.includes("lite") || speed === "lite" || speed.includes("lite");
  // Correct model names on Replicate: bytedance/seedance-1-pro and bytedance/seedance-1-lite (not 1.0)
  // Seedance 1.5: bytedance/seedance-1.5-pro
  const modelBase = isSeedance15
    ? 'bytedance/seedance-1.5-pro'
    : (isLite ? "bytedance/seedance-1-lite" : "bytedance/seedance-1-pro");
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const d = Number(body?.duration ?? 5);
    const minAllowed = isSeedance15 ? 4 : 2;
    return Math.max(minAllowed, Math.min(12, Math.round(d)));
  })();
  const aspect = ((): string => {
    const a = String(body?.aspect_ratio ?? "16:9");
    return ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"].includes(a)
      ? a
      : "16:9";
  })();
  const res = isSeedance15
    ? undefined
    : (((): string => {
      const r = String(body?.resolution ?? "1080p").toLowerCase();
      const m = r.match(/(480|720|1080)/);
      return m ? `${m[1]}p` : "1080p";
    })());
  const audioFlag =
    typeof body.generate_audio === "boolean"
      ? body.generate_audio
      : typeof body.generateAudio === "boolean"
      ? body.generateAudio
      : undefined;

  const createPayload: any = {
    prompt: body.prompt,
    model: modelBase,
    generationType: "text-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    ...(res ? { resolution: res as any } : {}),
  };

  if (isSeedance15) {
    createPayload.aspect_ratio = aspect;
    if (typeof audioFlag === "boolean") createPayload.generate_audio = audioFlag;
  }

  const { historyId } = await generationHistoryRepository.create(uid, createPayload as any);

  // Seedance 1.5 fields were persisted during create above; no-op here.

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
    fps: 24,
  };
  if (!isSeedance15) {
    input.resolution = res;
    input.aspect_ratio = aspect;
  } else {
    // Seedance 1.5 uses aspect_ratio for T2V
    input.aspect_ratio = aspect;
    // Seedance 1.5 supports audio generation
    if (typeof body.generate_audio === 'boolean') input.generate_audio = body.generate_audio;
    else if (typeof body.generateAudio === 'boolean') input.generate_audio = body.generateAudio;
  }
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
  if (!isSeedance15) {
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
  const isSeedance15 = modelStr.includes('seedance-1.5') || speed.includes('1.5');
  const isLite =
    modelStr.includes("lite") || speed === "lite" || speed.includes("lite");
  // Correct model names on Replicate: bytedance/seedance-1-pro and bytedance/seedance-1-lite (not 1.0)
  // Seedance 1.5: bytedance/seedance-1.5-pro
  const modelBase = isSeedance15
    ? 'bytedance/seedance-1.5-pro'
    : (isLite ? "bytedance/seedance-1-lite" : "bytedance/seedance-1-pro");
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator
    ? { uid, username: creator.username, email: (creator as any)?.email }
    : ({ uid } as any);
  const durationSec = ((): number => {
    const d = Number(body?.duration ?? 5);
    const minAllowed = isSeedance15 ? 4 : 2;
    return Math.max(minAllowed, Math.min(12, Math.round(d)));
  })();
  const aspect = ((): string => {
    const a = String(body?.aspect_ratio ?? "16:9");
    return ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"].includes(a)
      ? a
      : "16:9";
  })();
  const res = isSeedance15
    ? undefined
    : (((): string => {
      const r = String(body?.resolution ?? "1080p").toLowerCase();
      const m = r.match(/(480|720|1080)/);
      return m ? `${m[1]}p` : "1080p";
    })());
  const audioFlag =
    typeof body.generate_audio === "boolean"
      ? body.generate_audio
      : typeof body.generateAudio === "boolean"
      ? body.generateAudio
      : undefined;

  const createPayloadImg: any = {
    prompt: body.prompt,
    model: modelBase,
    generationType: "image-to-video",
    visibility: body.isPublic ? "public" : "private",
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    ...(res ? { resolution: res as any } : {}),
  };

  if (isSeedance15) {
    createPayloadImg.aspect_ratio = aspect;
    if (typeof audioFlag === "boolean") createPayloadImg.generate_audio = audioFlag;
  }

  const { historyId } = await generationHistoryRepository.create(uid, createPayloadImg as any);
  const input: any = {
    prompt: body.prompt,
    duration: durationSec,
    fps: 24,
    image: String(body.image),
    aspect_ratio: aspect,
  };
  if (!isSeedance15) {
    input.resolution = res;
  } else {
    // Seedance 1.5 supports audio generation
    if (typeof body.generate_audio === 'boolean') input.generate_audio = body.generate_audio;
    else if (typeof body.generateAudio === 'boolean') input.generate_audio = body.generateAudio;
  }

  if (body.seed != null && Number.isInteger(Number(body.seed))) input.seed = Number(body.seed);
  if (typeof body.camera_fixed === 'boolean') input.camera_fixed = body.camera_fixed;
  if (typeof body.last_frame_image === 'string' && body.last_frame_image.length > 5) {
    input.last_frame_image = String(body.last_frame_image);
  }

  if (!isSeedance15) {
    // Reference images (1-4 images) for guiding video generation
    // Note: Cannot be used with 1080p resolution or first/last frame images
    if (
      Array.isArray(body.reference_images) &&
      body.reference_images.length > 0 &&
      body.reference_images.length <= 4
    ) {
      // In I2V, `image` is always present (acts as first frame image), so reference_images are incompatible.
      const hasFirstFrame = true;
      const hasLastFrame = body.last_frame_image && String(body.last_frame_image).length > 5;
      if (res === '1080p') {
        console.warn(
          '[seedanceI2vSubmit] reference_images cannot be used with 1080p resolution or first/last frame images, ignoring'
        );
      } else if (hasFirstFrame || hasLastFrame) {
        console.warn(
          '[seedanceI2vSubmit] reference_images cannot be used with 1080p resolution or first/last frame images, ignoring'
        );
      } else {
        input.reference_images = body.reference_images.slice(0, 4);
      }
    }
  }

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
      : "pixverse/pixverse-v5";
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
      : "pixverse/pixverse-v5";
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


