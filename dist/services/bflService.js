"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bflService = void 0;
const errorHandler_1 = require("../utils/errorHandler");
const validateBflGenerate_1 = require("../middlewares/validators/bfl/validateBflGenerate");
const bflRepository_1 = require("../repository/bflRepository");
const bflutils_1 = require("../utils/bflutils");
const axios_1 = __importDefault(require("axios"));
const generationHistoryRepository_1 = require("../repository/generationHistoryRepository");
const generationsMirrorRepository_1 = require("../repository/generationsMirrorRepository");
const authRepository_1 = require("../repository/auth/authRepository");
const zataUpload_1 = require("../utils/storage/zataUpload");
const env_1 = require("../config/env");
const sharp_1 = __importDefault(require("sharp"));
// Normalize input (URL | data URI | raw base64) to a base64 string without a data URI prefix
// Returns base64 plus metadata (mime, width, height)
async function normalizeToBase64(src) {
    if (!src || typeof src !== "string") {
        throw new errorHandler_1.ApiError("image/mask must be a non-empty string", 400);
    }
    let buf;
    let inferredMime;
    const trimmed = src.trim();
    // Attempt strict data URI parse first
    const dataUriMatch = /^data:([^;]+);base64,(.*)$/i.exec(trimmed);
    if (dataUriMatch) {
        inferredMime = dataUriMatch[1];
        const b64 = dataUriMatch[2];
        try {
            buf = Buffer.from(b64, "base64");
            if (!buf || buf.length === 0)
                throw new Error("empty buffer");
        }
        catch {
            throw new errorHandler_1.ApiError("Invalid base64 data URI provided", 400);
        }
    }
    // If not a strict data URI, maybe it's a URL to fetch
    if (!buf && /^https?:\/\//i.test(trimmed)) {
        try {
            const resp = await axios_1.default.get(trimmed, { responseType: "arraybuffer", validateStatus: () => true });
            if (resp.status < 200 || resp.status >= 300) {
                throw new errorHandler_1.ApiError(`Failed to download image: HTTP ${resp.status}`, resp.status);
            }
            buf = Buffer.from(resp.data);
            if (!buf || buf.length === 0)
                throw new errorHandler_1.ApiError("Downloaded image is empty", 400);
            // Try to infer mime from response headers
            const ct = (resp.headers && (resp.headers["content-type"] || resp.headers["Content-Type"]));
            if (ct)
                inferredMime = ct.split(";")[0];
        }
        catch (e) {
            const msg = e?.message || "Failed to fetch image for base64 conversion";
            throw new errorHandler_1.ApiError(msg, 400);
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
            if (!candidateBuf || candidateBuf.length === 0)
                throw new Error("empty buffer");
            buf = candidateBuf;
        }
        catch {
            throw new errorHandler_1.ApiError("Invalid base64 encoding for image/mask", 400);
        }
    }
    // Use sharp to probe image metadata (mime, width, height) when possible
    try {
        const meta = await (0, sharp_1.default)(buf).metadata();
        if (meta && meta.format) {
            inferredMime = inferredMime || `image/${meta.format}`;
        }
        const width = meta.width;
        const height = meta.height;
        return { base64: buf.toString("base64"), mime: inferredMime, width, height };
    }
    catch (e) {
        // Not an image or sharp failed -> still return the base64 so provider can decide
        return { base64: buf.toString("base64"), mime: inferredMime };
    }
}
async function pollForResults(pollingUrl, apiKey) {
    const intervalMs = env_1.env.bflPollIntervalMs ?? 1000; // default 1s
    const maxLoops = env_1.env.bflPollMaxLoops ?? 180; // default ~3 minutes
    for (let i = 0; i < maxLoops; i++) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        const pollResponse = await axios_1.default.get(pollingUrl, {
            headers: { accept: "application/json", "x-key": apiKey },
            validateStatus: () => true,
        });
        if (pollResponse.status < 200 || pollResponse.status >= 300) {
            let errorPayload = undefined;
            try {
                errorPayload = pollResponse.data;
            }
            catch (_) {
                try {
                    const text = String(pollResponse.data);
                    errorPayload = { message: text };
                }
                catch { }
            }
            const reason = (errorPayload && (errorPayload.message || errorPayload.error)) ||
                "Unknown error";
            throw new errorHandler_1.ApiError(`Polling failed: ${reason}`, pollResponse.status, errorPayload);
        }
        const result = pollResponse.data;
        if (result.status === "Ready") {
            return result.result.sample;
        }
        if (result.status === "Error" || result.status === "Failed") {
            throw new errorHandler_1.ApiError("Generation failed", 500, result);
        }
    }
    throw new errorHandler_1.ApiError("Timeout waiting for image generation", 504);
}
async function generate(uid, payload) {
    const { prompt, model, n = 1, frameSize = "1:1", uploadedImages: inputImages = [], width, height, generationType, tags, nsfw, visibility, isPublic, } = payload;
    const apiKey = env_1.env.bflApiKey;
    if (!apiKey)
        throw new errorHandler_1.ApiError("API key not configured", 500);
    if (!prompt)
        throw new errorHandler_1.ApiError("Prompt is required", 400);
    if (!validateBflGenerate_1.ALLOWED_MODELS.includes(model))
        throw new errorHandler_1.ApiError("Unsupported model", 400);
    // create legacy generation record (existing repo)
    const creator = await authRepository_1.authRepository.getUserById(uid);
    console.log("creator", creator);
    const createdBy = { uid, username: creator?.username, email: creator?.email };
    const legacyId = await bflRepository_1.bflRepository.createGenerationRecord({ ...payload, isPublic: payload.isPublic === true }, createdBy);
    // create authoritative history first
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt,
        model,
        generationType: payload.generationType || "text-to-image",
        visibility: payload.visibility || "private",
        tags: payload.tags,
        nsfw: payload.nsfw,
        isPublic: payload.isPublic === true,
        createdBy,
    });
    // Persist user uploaded input images (if any)
    try {
        const username = creator?.username || uid;
        const keyPrefix = `users/${username}/input/${historyId}`;
        const inputPersisted = [];
        let idx = 0;
        for (const src of (inputImages || [])) {
            if (!src || typeof src !== 'string')
                continue;
            try {
                const stored = /^data:/i.test(src)
                    ? await (0, zataUpload_1.uploadDataUriToZata)({ dataUri: src, keyPrefix, fileName: `input-${++idx}` })
                    : await (0, zataUpload_1.uploadFromUrlToZata)({ sourceUrl: src, keyPrefix, fileName: `input-${++idx}` });
                inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: stored.key, originalUrl: src });
            }
            catch { }
        }
        if (inputPersisted.length > 0) {
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted });
        }
    }
    catch { }
    try {
        const imagePromises = Array.from({ length: n }, async () => {
            const normalizedModel = model
                .toLowerCase()
                .replace(/\s+/g, "-");
            const endpoint = `https://api.bfl.ai/v1/${normalizedModel}`;
            let body = { prompt };
            if (normalizedModel.includes("kontext")) {
                body.aspect_ratio = frameSize;
                body.output_format = payload.output_format || "png";
                if (payload.prompt_upsampling !== undefined)
                    body.prompt_upsampling = payload.prompt_upsampling;
                if (Array.isArray(inputImages) && inputImages.length > 0) {
                    const [img1, img2, img3, img4] = inputImages;
                    if (img1)
                        body.input_image = img1;
                    if (img2)
                        body.input_image_2 = img2;
                    if (img3)
                        body.input_image_3 = img3;
                    if (img4)
                        body.input_image_4 = img4;
                }
            }
            else if (normalizedModel === "flux-pro" ||
                normalizedModel === "flux-pro-1.1" ||
                normalizedModel === "flux-pro-1.1-ultra") {
                if (width && height) {
                    body.width = width;
                    body.height = height;
                }
                else {
                    const { width: convertedWidth, height: convertedHeight } = bflutils_1.bflutils.getDimensions(frameSize);
                    body.width = convertedWidth;
                    body.height = convertedHeight;
                }
                body.output_format = payload.output_format || "jpeg";
                if (payload.prompt_upsampling !== undefined)
                    body.prompt_upsampling = payload.prompt_upsampling;
            }
            else if (normalizedModel === "flux-dev") {
                const { width: convertedWidth, height: convertedHeight } = bflutils_1.bflutils.getDimensions(frameSize);
                body.width = convertedWidth;
                body.height = convertedHeight;
                body.output_format = payload.output_format || "jpeg";
                if (payload.prompt_upsampling !== undefined)
                    body.prompt_upsampling = payload.prompt_upsampling;
            }
            else {
                body.aspect_ratio = frameSize;
                body.output_format = payload.output_format || "jpeg";
                if (payload.prompt_upsampling !== undefined)
                    body.prompt_upsampling = payload.prompt_upsampling;
            }
            const response = await axios_1.default.post(endpoint, body, {
                headers: {
                    accept: "application/json",
                    "x-key": apiKey,
                    "Content-Type": "application/json",
                },
                validateStatus: () => true,
            });
            if (response.status < 200 || response.status >= 300) {
                let errorPayload = undefined;
                try {
                    errorPayload = response.data;
                }
                catch (_) {
                    try {
                        const text = String(response.data);
                        errorPayload = { message: text };
                    }
                    catch { }
                }
                const reason = (errorPayload && (errorPayload.message || errorPayload.error)) ||
                    "Unknown error";
                throw new errorHandler_1.ApiError(`Failed to initiate image generation: ${reason}`, response.status, errorPayload);
            }
            const data = response.data;
            if (!data.polling_url)
                throw new errorHandler_1.ApiError("No polling URL received", 502);
            const imageUrl = await pollForResults(data.polling_url, apiKey);
            return {
                url: imageUrl,
                originalUrl: imageUrl,
                id: data.id,
            };
        });
        const images = await Promise.all(imagePromises);
        // Upload provider images to Zata and keep both links
        const storedImages = await Promise.all(images.map(async (img, index) => {
            try {
                const { key, publicUrl } = await (0, zataUpload_1.uploadFromUrlToZata)({
                    sourceUrl: img.url,
                    // Username-scoped minimal layout
                    keyPrefix: `users/${(await authRepository_1.authRepository.getUserById(uid))?.username || uid}/image/${historyId}`,
                    fileName: `image-${index + 1}`,
                });
                return {
                    id: img.id,
                    url: publicUrl,
                    storagePath: key,
                    originalUrl: img.originalUrl || img.url,
                };
            }
            catch (e) {
                // Soft fallback: continue with provider URL if Zata fails
                // eslint-disable-next-line no-console
                console.warn("[BFL] Zata upload failed, falling back to provider URL:", e?.message || e);
                return {
                    id: img.id,
                    url: img.url,
                    originalUrl: img.originalUrl || img.url,
                };
            }
        }));
        await bflRepository_1.bflRepository.updateGenerationRecord(legacyId, {
            status: "completed",
            images: storedImages,
            frameSize,
        });
        // update authoritative history and mirror
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, {
            status: "completed",
            images: storedImages,
            // persist optional fields
            ...(frameSize ? { frameSize: frameSize } : {}),
        });
        try {
            const creator = await authRepository_1.authRepository.getUserById(uid);
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh) {
                await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
                    uid,
                    username: creator?.username,
                    displayName: creator?.displayName,
                    photoURL: creator?.photoURL,
                });
            }
        }
        catch { }
        return {
            historyId,
            prompt,
            model,
            generationType: payload.generationType || "text-to-image",
            visibility: payload.visibility || "private",
            isPublic: payload.isPublic === true,
            createdBy,
            images: storedImages,
            status: "completed",
        };
    }
    catch (err) {
        const message = err?.message || "Failed to generate images";
        // eslint-disable-next-line no-console
        console.error("[BFL] Generation error:", message, err?.data || "");
        await bflRepository_1.bflRepository.updateGenerationRecord(legacyId, {
            status: "failed",
            error: message,
        });
        try {
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, {
                status: "failed",
                error: message,
            });
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh) {
                await generationsMirrorRepository_1.generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
            }
        }
        catch { }
        throw err;
    }
}
async function fill(uid, body) {
    const apiKey = env_1.env.bflApiKey;
    if (!apiKey)
        throw new errorHandler_1.ApiError("API key not configured", 500);
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: creator?.email };
    const endpoint = `https://api.bfl.ai/v1/flux-pro-1.0-fill`;
    // Normalize inputs to pure base64 strings as required by BFL Fill API
    const normalizedPayload = { ...body };
    try {
        if (!body?.image)
            throw new errorHandler_1.ApiError("image is required", 400);
        const imgNorm = await normalizeToBase64(body.image);
        normalizedPayload.image = imgNorm.base64;
        // If mask provided, normalize and validate dimensions if available
        if (body?.mask) {
            const maskNorm = await normalizeToBase64(body.mask);
            // If we have dimensions for both, ensure they match
            if (imgNorm.width && imgNorm.height && maskNorm.width && maskNorm.height) {
                if (imgNorm.width !== maskNorm.width || imgNorm.height !== maskNorm.height) {
                    throw new errorHandler_1.ApiError(`Mask dimensions (${maskNorm.width}x${maskNorm.height}) do not match image dimensions (${imgNorm.width}x${imgNorm.height})`, 400);
                }
            }
            normalizedPayload.mask = maskNorm.base64;
        }
    }
    catch (err) {
        // Surface validation/normalization errors clearly
        throw err;
    }
    const response = await axios_1.default.post(endpoint, normalizedPayload, {
        headers: {
            accept: "application/json",
            "x-key": apiKey,
            "Content-Type": "application/json",
        },
        validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300)
        throw new errorHandler_1.ApiError("Failed to start fill", response.status, response.data);
    const { polling_url, id } = response.data || {};
    if (!polling_url)
        throw new errorHandler_1.ApiError("No polling URL received", 502);
    const imageUrl = await pollForResults(polling_url, apiKey);
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt: body?.prompt || "",
        model: "flux-pro-1.0-fill",
        generationType: body?.generationType || "text-to-image",
        visibility: "private",
        isPublic: body?.isPublic === true,
        createdBy,
    });
    const { key, publicUrl } = await (0, zataUpload_1.uploadFromUrlToZata)({
        sourceUrl: imageUrl,
        keyPrefix: `users/${(await authRepository_1.authRepository.getUserById(uid))?.username || uid}/image/${historyId}`,
        fileName: "image-1",
    });
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, {
        status: "completed",
        images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
    });
    try {
        const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
        if (fresh)
            await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, { uid, username: (await authRepository_1.authRepository.getUserById(uid))?.username });
    }
    catch { }
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
    };
}
async function expand(uid, body) {
    const apiKey = env_1.env.bflApiKey;
    if (!apiKey)
        throw new errorHandler_1.ApiError("API key not configured", 500);
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: creator?.email };
    const endpoint = `https://api.bfl.ai/v1/flux-pro-1.0-expand`;
    const response = await axios_1.default.post(endpoint, body, {
        headers: {
            accept: "application/json",
            "x-key": apiKey,
            "Content-Type": "application/json",
        },
        validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300)
        throw new errorHandler_1.ApiError("Failed to start expand", response.status, response.data);
    const { polling_url, id } = response.data || {};
    if (!polling_url)
        throw new errorHandler_1.ApiError("No polling URL received", 502);
    const imageUrl = await pollForResults(polling_url, apiKey);
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt: body?.prompt || "",
        model: "flux-pro-1.0-expand",
        generationType: body?.generationType || "text-to-image",
        visibility: "private",
        isPublic: body?.isPublic === true,
        createdBy,
    });
    const { key, publicUrl } = await (0, zataUpload_1.uploadFromUrlToZata)({
        sourceUrl: imageUrl,
        keyPrefix: `users/${(await authRepository_1.authRepository.getUserById(uid))?.username || uid}/image/${historyId}`,
        fileName: "image-1",
    });
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, {
        status: "completed",
        images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
    });
    try {
        const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
        if (fresh)
            await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, { uid, username: (await authRepository_1.authRepository.getUserById(uid))?.username });
    }
    catch { }
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
    };
}
async function canny(uid, body) {
    const apiKey = env_1.env.bflApiKey;
    if (!apiKey)
        throw new errorHandler_1.ApiError("API key not configured", 500);
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: creator?.email };
    const endpoint = `https://api.bfl.ai/v1/flux-pro-1.0-canny`;
    const response = await axios_1.default.post(endpoint, body, {
        headers: {
            accept: "application/json",
            "x-key": apiKey,
            "Content-Type": "application/json",
        },
        validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300)
        throw new errorHandler_1.ApiError("Failed to start canny", response.status, response.data);
    const { polling_url, id } = response.data || {};
    if (!polling_url)
        throw new errorHandler_1.ApiError("No polling URL received", 502);
    const imageUrl = await pollForResults(polling_url, apiKey);
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt: body?.prompt || "",
        model: "flux-pro-1.0-canny",
        generationType: body?.generationType || "text-to-image",
        visibility: "private",
        isPublic: body?.isPublic === true,
        createdBy,
    });
    const { key, publicUrl } = await (0, zataUpload_1.uploadFromUrlToZata)({
        sourceUrl: imageUrl,
        keyPrefix: `users/${(await authRepository_1.authRepository.getUserById(uid))?.username || uid}/image/${historyId}`,
        fileName: "image-1",
    });
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, {
        status: "completed",
        images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
    });
    try {
        const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
        if (fresh)
            await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, { uid, username: (await authRepository_1.authRepository.getUserById(uid))?.username });
    }
    catch { }
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
    };
}
async function depth(uid, body) {
    const apiKey = env_1.env.bflApiKey;
    if (!apiKey)
        throw new errorHandler_1.ApiError("API key not configured", 500);
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: creator?.email };
    const endpoint = `https://api.bfl.ai/v1/flux-pro-1.0-depth`;
    const response = await axios_1.default.post(endpoint, body, {
        headers: {
            accept: "application/json",
            "x-key": apiKey,
            "Content-Type": "application/json",
        },
        validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300)
        throw new errorHandler_1.ApiError("Failed to start depth", response.status, response.data);
    const { polling_url, id } = response.data || {};
    if (!polling_url)
        throw new errorHandler_1.ApiError("No polling URL received", 502);
    const imageUrl = await pollForResults(polling_url, apiKey);
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt: body?.prompt || "",
        model: "flux-pro-1.0-depth",
        generationType: body?.generationType || "text-to-image",
        visibility: "private",
        isPublic: body?.isPublic === true,
        createdBy,
    });
    const { key, publicUrl } = await (0, zataUpload_1.uploadFromUrlToZata)({
        sourceUrl: imageUrl,
        keyPrefix: `users/${(await authRepository_1.authRepository.getUserById(uid))?.username || uid}/image/${historyId}`,
        fileName: "image-1",
    });
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, {
        status: "completed",
        images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
    });
    try {
        const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
        if (fresh)
            await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, { uid, username: (await authRepository_1.authRepository.getUserById(uid))?.username });
    }
    catch { }
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
    };
}
// Expansion using FLUX Fill - generates mask from expansion margins
async function expandWithFill(uid, body) {
    const apiKey = env_1.env.bflApiKey;
    if (!apiKey)
        throw new errorHandler_1.ApiError("API key not configured", 500);
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: creator?.email };
    if (!body?.image)
        throw new errorHandler_1.ApiError("image is required", 400);
    if (!body?.canvas_size || !Array.isArray(body.canvas_size) || body.canvas_size.length !== 2) {
        throw new errorHandler_1.ApiError("canvas_size [width, height] is required", 400);
    }
    if (!body?.original_image_size || !Array.isArray(body.original_image_size) || body.original_image_size.length !== 2) {
        throw new errorHandler_1.ApiError("original_image_size [width, height] is required", 400);
    }
    const canvasW = Number(body.canvas_size[0]);
    const canvasH = Number(body.canvas_size[1]);
    const origW = Number(body.original_image_size[0]);
    const origH = Number(body.original_image_size[1]);
    const origX = Number(body.original_image_location?.[0] || 0);
    const origY = Number(body.original_image_location?.[1] || 0);
    if (canvasW <= 0 || canvasH <= 0 || origW <= 0 || origH <= 0) {
        throw new errorHandler_1.ApiError("Invalid canvas or original image dimensions", 400);
    }
    // Normalize image to base64
    const imgNorm = await normalizeToBase64(body.image);
    if (!imgNorm.width || !imgNorm.height) {
        throw new errorHandler_1.ApiError("Could not determine image dimensions", 400);
    }
    // Create expanded canvas with original image placed at specified position
    // Then generate mask: white for expansion areas, black for original image
    const imgBuffer = Buffer.from(imgNorm.base64, "base64");
    // Create expanded canvas with transparent background
    const expandedCanvasBuffer = Buffer.alloc(canvasW * canvasH * 4); // RGBA
    expandedCanvasBuffer.fill(0); // Transparent black
    const expandedCanvas = await (0, sharp_1.default)(expandedCanvasBuffer, {
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
    const maskBuffer = await (0, sharp_1.default)(whiteCanvasBuffer, {
        raw: {
            width: canvasW,
            height: canvasH,
            channels: 1
        }
    })
        .composite([
        {
            input: await (0, sharp_1.default)(blackRectBuffer, {
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
    const normalizedPayload = {
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
    const response = await axios_1.default.post(endpoint, normalizedPayload, {
        headers: {
            accept: "application/json",
            "x-key": apiKey,
            "Content-Type": "application/json",
        },
        validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300)
        throw new errorHandler_1.ApiError("Failed to start fill expansion", response.status, response.data);
    const { polling_url, id } = response.data || {};
    if (!polling_url)
        throw new errorHandler_1.ApiError("No polling URL received", 502);
    const imageUrl = await pollForResults(polling_url, apiKey);
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt: body?.prompt || "FLUX Fill Expansion",
        model: "flux-pro-1.0-fill",
        generationType: "image-outpaint",
        visibility: body?.isPublic ? "public" : "private",
        isPublic: body?.isPublic === true,
        createdBy,
    });
    const { key, publicUrl } = await (0, zataUpload_1.uploadFromUrlToZata)({
        sourceUrl: imageUrl,
        keyPrefix: `users/${creator?.username || uid}/image/${historyId}`,
        fileName: "image-1",
    });
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, {
        status: "completed",
        images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
    });
    try {
        const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
        if (fresh)
            await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, { uid, username: creator?.username });
    }
    catch { }
    return {
        historyId,
        prompt: body?.prompt || "FLUX Fill Expansion",
        model: "flux-pro-1.0-fill",
        generationType: "image-outpaint",
        visibility: body?.isPublic ? "public" : "private",
        isPublic: body?.isPublic === true,
        createdBy,
        images: [{ id, url: publicUrl, storagePath: key, originalUrl: imageUrl }],
        status: "completed",
    };
}
exports.bflService = {
    generate,
    pollForResults,
    fill,
    expand,
    expandWithFill,
    canny,
    depth,
};
