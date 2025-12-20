/**
 * Replicate Image Service
 * Handles all image generation operations via Replicate API
 * Functions: removeBackground, upscale, generateImage, multiangle, nextScene
 */

// Use dynamic import signature to avoid type requirement during build-time
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Replicate = require("replicate");
import sharp from "sharp";
import util from "util";
import { ApiError } from "../../utils/errorHandler";
import { env } from "../../config/env";
import { generationHistoryRepository } from "../../repository/generationHistoryRepository";
import { authRepository } from "../../repository/auth/authRepository";
import {
  uploadFromUrlToZata,
  uploadDataUriToZata,
} from "../../utils/storage/zataUpload";
import { replicateRepository } from "../../repository/replicateRepository";
import { syncToMirror } from "../../utils/mirrorHelper";
import { aestheticScoreService } from "../aestheticScoreService";
import { markGenerationCompleted } from "../generationHistoryService";
import {
  DEFAULT_BG_MODEL_A,
  DEFAULT_VERSION_BY_MODEL,
  composeModelSpec,
  clamp,
  downloadToDataUri,
  extractFirstUrl,
  resolveOutputUrls,
  buildReplicateImageFileName,
  resolveItemUrl,
} from "./replicateUtils";

// Constants
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

/**
 * Remove background from an image using Replicate
 */
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

/**
 * Upscale an image using Replicate
 */
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

/**
 * Generate image using Replicate
 * Supports multiple models: Seedream, Leonardo Phoenix, Ideogram, P-Image, GPT Image 1.5, etc.
 */
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
  const modelBase = (
    body.model && body.model.length > 0
      ? String(body.model)
      : "bytedance/seedream-4"
  ).trim();
  const creator = await authRepository.getUserById(uid);
  const storageKeyPrefixOverride: string | undefined = (body as any)?.storageKeyPrefixOverride;
  const aspectRatio = body.aspect_ratio || body.frameSize || null;
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: "text-to-image",
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
      const clampDim = (v: number) => Math.max(256, Math.min(1024, round16(v)));
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
          width = clampDim(width - 16);
          height = clampDim(Math.round(width / aspectVal));
        }
        return { width: clampDim(width), height: clampDim(height) };
      };

      if (rest.width != null) input.width = clampDim(Number(rest.width));
      if (rest.height != null) input.height = clampDim(Number(rest.height));
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
      if (rest.number_of_images != null) {
        input.number_of_images = Math.max(1, Math.min(10, Number(rest.number_of_images)));
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

/**
 * Generate multiple angles of an image using Replicate
 */
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

/**
 * Generate next scene from an image using Replicate
 */
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
