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
    const response = await axios_1.default.post(endpoint, body, {
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
exports.bflService = {
    generate,
    pollForResults,
    fill,
    expand,
    canny,
    depth,
};
