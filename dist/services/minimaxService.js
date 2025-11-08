"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.minimaxService = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
const errorHandler_1 = require("../utils/errorHandler");
const minimaxRepository_1 = require("../repository/minimaxRepository");
const generationHistoryRepository_1 = require("../repository/generationHistoryRepository");
const generationsMirrorRepository_1 = require("../repository/generationsMirrorRepository");
const authRepository_1 = require("../repository/auth/authRepository");
const zataUpload_1 = require("../utils/storage/zataUpload");
const creditsRepository_1 = require("../repository/creditsRepository");
const minimaxPricing_1 = require("../utils/pricing/minimaxPricing");
const MINIMAX_API_BASE = "https://api.minimax.io/v1";
const MINIMAX_MODEL = "image-01";
function mapMiniMaxCodeToHttp(statusCode) {
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
function assertMiniMaxOk(baseResp) {
    if (!baseResp)
        return;
    const code = Number(baseResp.status_code);
    if (!isNaN(code) && code !== 0) {
        const http = mapMiniMaxCodeToHttp(code);
        throw new errorHandler_1.ApiError(baseResp.status_msg || `MiniMax error ${code}`, http, baseResp);
    }
}
async function generate(uid, payload) {
    const { prompt, aspect_ratio, width, height, response_format = "url", seed, n = 1, prompt_optimizer = false, subject_reference, style, generationType, } = payload;
    if (!prompt)
        throw new errorHandler_1.ApiError("Missing required field: prompt is required", 400);
    if (prompt.length > 1500)
        throw new errorHandler_1.ApiError("Prompt exceeds 1500 characters limit", 400);
    if (n < 1 || n > 9)
        throw new errorHandler_1.ApiError("n must be between 1 and 9", 400);
    const apiKey = env_1.env.minimaxApiKey;
    if (!apiKey)
        throw new errorHandler_1.ApiError("MiniMax API key not configured", 500);
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: creator?.email };
    const legacyId = await minimaxRepository_1.minimaxRepository.createGenerationRecord({ ...payload, isPublic: payload.isPublic === true }, createdBy);
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt,
        model: MINIMAX_MODEL,
        generationType: payload.generationType || 'text-to-image',
        visibility: payload.visibility || 'private',
        tags: payload.tags,
        nsfw: payload.nsfw,
        isPublic: payload.isPublic === true,
        createdBy,
    });
    // Persist subject_reference (if provided) as inputImages
    try {
        const keyPrefix = `users/${creator?.username || uid}/input/${historyId}`;
        const inputPersisted = [];
        let idx = 0;
        if (Array.isArray(subject_reference)) {
            for (const ref of subject_reference) {
                const file = ref?.image_file || (Array.isArray(ref?.image) ? ref.image[0] : undefined);
                if (!file || typeof file !== 'string')
                    continue;
                try {
                    if (/^data:/i.test(file)) {
                        // Inline data URIs need to be converted to Buffer; uploadBufferToZata requires content-type
                        const match = /^data:([^;]+);base64,(.*)$/.exec(file);
                        if (match) {
                            const contentType = match[1];
                            const base64 = match[2];
                            const buffer = Buffer.from(base64, 'base64');
                            const name = `input-${++idx}.${contentType.includes('png') ? 'png' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'bin'}`;
                            const { key, publicUrl } = await (0, zataUpload_1.uploadBufferToZata)(`${keyPrefix}/${name}`, buffer, contentType);
                            inputPersisted.push({ id: `in-${idx}`, url: publicUrl, storagePath: key, originalUrl: file });
                        }
                    }
                    else {
                        const stored = await (0, zataUpload_1.uploadFromUrlToZata)({ sourceUrl: file, keyPrefix, fileName: `input-${++idx}` });
                        inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: stored.key, originalUrl: file });
                    }
                }
                catch { }
            }
        }
        if (inputPersisted.length > 0)
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted });
    }
    catch { }
    const requestPayload = {
        model: MINIMAX_MODEL,
        prompt,
        response_format,
        n,
        prompt_optimizer,
    };
    if (aspect_ratio)
        requestPayload.aspect_ratio = aspect_ratio;
    if (width !== undefined && height !== undefined) {
        requestPayload.width = width;
        requestPayload.height = height;
    }
    if (seed !== undefined)
        requestPayload.seed = seed;
    if (subject_reference)
        requestPayload.subject_reference = subject_reference;
    try {
        const response = await axios_1.default.post(`${MINIMAX_API_BASE}/image_generation`, requestPayload, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            validateStatus: () => true,
        });
        if (response.status < 200 || response.status >= 300) {
            throw new errorHandler_1.ApiError("MiniMax API request failed", response.status, response.data);
        }
        const data = response.data;
        assertMiniMaxOk(data.base_resp);
        if (!data.data)
            throw new errorHandler_1.ApiError("MiniMax API response missing data field", 400, data);
        let imageUrls = [];
        if (Array.isArray(data.data.image_urls))
            imageUrls = data.data.image_urls;
        else if (Array.isArray(data.data.images))
            imageUrls = data.data.images;
        else if (Array.isArray(data.data.urls))
            imageUrls = data.data.urls;
        else if (Array.isArray(data.data))
            imageUrls = data.data;
        if (imageUrls.length === 0)
            throw new errorHandler_1.ApiError("No image URLs returned from MiniMax API", 400, data.data);
        const images = imageUrls.map((url, index) => ({
            id: `${data.id || Date.now()}-${index}`,
            url,
            originalUrl: url,
        }));
        // Upload to Zata and preserve originalUrl
        const storedImages = await Promise.all(images.map(async (img, index) => {
            try {
                const username = creator?.username || uid;
                const { key, publicUrl } = await (0, zataUpload_1.uploadFromUrlToZata)({
                    sourceUrl: img.url,
                    keyPrefix: `users/${username}/image/${historyId}`,
                    fileName: `image-${index + 1}`,
                });
                return { id: img.id, url: publicUrl, storagePath: key, originalUrl: img.originalUrl || img.url };
            }
            catch (e) {
                // eslint-disable-next-line no-console
                console.warn('[MiniMax] Zata upload failed, using provider URL:', e?.message || e);
                return { id: img.id, url: img.url, originalUrl: img.originalUrl || img.url };
            }
        }));
        await minimaxRepository_1.minimaxRepository.updateGenerationRecord(legacyId, {
            status: "completed",
            images: storedImages,
        });
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, {
            status: 'completed',
            images: storedImages,
            provider: 'minimax',
        });
        try {
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
        return { images: storedImages, historyId, id: data.id };
    }
    catch (err) {
        const message = err?.message || "Failed to generate images with MiniMax";
        await minimaxRepository_1.minimaxRepository.updateGenerationRecord(legacyId, {
            status: "failed",
            error: message,
        });
        try {
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message });
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh) {
                await generationsMirrorRepository_1.generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
            }
        }
        catch { }
        throw err;
    }
}
// Video
async function generateVideo(apiKey, _groupId, body) {
    if (!apiKey)
        throw new errorHandler_1.ApiError("MiniMax API not configured", 500);
    // The video_generation POST does not require GroupId; only file retrieval does
    const res = await axios_1.default.post(`${MINIMAX_API_BASE}/video_generation`, body, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300)
        throw new errorHandler_1.ApiError("MiniMax video request failed", res.status, res.data);
    const data = res.data || {};
    assertMiniMaxOk(data.base_resp);
    const taskId = data?.result?.task_id || data?.task_id || data?.id;
    if (!taskId)
        throw new errorHandler_1.ApiError("MiniMax service returned undefined taskId", 502, data);
    return { taskId };
}
async function getVideoStatus(apiKey, taskId) {
    const res = await axios_1.default.get(`${MINIMAX_API_BASE}/query/video_generation?task_id=${taskId}`, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300)
        throw new errorHandler_1.ApiError(`MiniMax API error: ${res.status}`, res.status, res.data);
    const data = res.data || {};
    // Some responses embed base_resp at root
    assertMiniMaxOk(data.base_resp || (data.result && data.result.base_resp));
    return data;
}
async function getFile(apiKey, groupId, fileId) {
    const res = await axios_1.default.get(`${MINIMAX_API_BASE}/files/retrieve?GroupId=${groupId}&file_id=${fileId}`, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300)
        throw new errorHandler_1.ApiError(`MiniMax API error: ${res.status}`, res.status, res.data);
    const data = res.data || {};
    // Surface group mismatch case clearly
    if (data.base_resp &&
        Number(data.base_resp.status_code) === 1004 &&
        /token not match group/i.test(String(data.base_resp.status_msg))) {
        throw new errorHandler_1.ApiError("MiniMax 1004: token not match group. Ensure MINIMAX_GROUP_ID matches API key account group.", 401, data.base_resp);
    }
    assertMiniMaxOk(data.base_resp);
    return data;
}
function extractDownloadUrl(data) {
    if (!data)
        return undefined;
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
    for (const c of candidates)
        if (typeof c === 'string' && /^https?:\/\//.test(c))
            return c;
    try {
        const stack = [data];
        while (stack.length) {
            const cur = stack.pop();
            if (!cur || typeof cur !== 'object')
                continue;
            for (const v of Object.values(cur)) {
                if (typeof v === 'string' && /^https?:\/\//.test(v))
                    return v;
                if (v && typeof v === 'object')
                    stack.push(v);
            }
        }
    }
    catch { }
    return undefined;
}
// Music
async function generateMusic(apiKey, body) {
    if (!apiKey)
        throw new errorHandler_1.ApiError("MiniMax API not configured", 500);
    const res = await axios_1.default.post(`${MINIMAX_API_BASE}/music_generation`, body, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) {
        throw new errorHandler_1.ApiError(`MiniMax music error: ${res.status}`, res.status, res.data);
    }
    return res.data;
}
// Post-processing helpers to store provider files into Zata and update history/mirror
async function processVideoFile(uid, fileId, historyId) {
    const apiKey = env_1.env.minimaxApiKey;
    const groupId = env_1.env.minimaxGroupId;
    const data = await getFile(apiKey, groupId, fileId);
    const providerUrl = extractDownloadUrl(data);
    if (!providerUrl)
        return { file: data };
    if (!historyId) {
        return { videos: [{ id: fileId, url: providerUrl, originalUrl: providerUrl }], status: 'completed' };
    }
    try {
        const creator = await authRepository_1.authRepository.getUserById(uid);
        const username = creator?.username || uid;
        const { key, publicUrl } = await (0, zataUpload_1.uploadFromUrlToZata)({
            sourceUrl: providerUrl,
            keyPrefix: `users/${username}/video/${historyId}`,
            fileName: 'video-1',
        });
        const videoItem = { id: fileId, url: publicUrl, storagePath: key, originalUrl: providerUrl };
        // Update existing history entry
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, {
            status: 'completed',
            videos: [videoItem],
            provider: 'minimax',
        });
        // Attempt debit using stored params on history (model/duration/resolution)
        try {
            const freshForCost = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            const model = freshForCost?.model || 'MiniMax-Hailuo-02';
            const duration = freshForCost?.duration;
            const resolution = freshForCost?.resolution;
            const { cost, pricingVersion, meta } = await (0, minimaxPricing_1.computeMinimaxVideoCostFromParams)(model, duration, resolution);
            await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, historyId, cost, 'minimax.video', { ...meta, historyId, provider: 'minimax', pricingVersion });
        }
        catch { }
        try {
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
        return { videos: [videoItem], historyId, status: 'completed' };
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[MiniMax] Video Zata upload failed; using provider URL');
        const creator = await authRepository_1.authRepository.getUserById(uid);
        const videoItem = { id: fileId, url: providerUrl, originalUrl: providerUrl };
        // Update existing history entry
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, {
            status: 'completed',
            videos: [videoItem],
            provider: 'minimax',
        });
        // Attempt debit even if we used provider URL
        try {
            const freshForCost = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            const model = freshForCost?.model || 'MiniMax-Hailuo-02';
            const { cost, pricingVersion, meta } = await (0, minimaxPricing_1.computeMinimaxVideoCostFromParams)(model, freshForCost?.duration, freshForCost?.resolution);
            await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, historyId, cost, 'minimax.video', { ...meta, historyId, provider: 'minimax', pricingVersion });
        }
        catch { }
        try {
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh)
                await generationsMirrorRepository_1.generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
        }
        catch { }
        return { videos: [videoItem], historyId, status: 'completed' };
    }
}
async function musicGenerateAndStore(uid, body) {
    const apiKey = env_1.env.minimaxApiKey;
    if (!apiKey)
        throw new errorHandler_1.ApiError('MiniMax API not configured', 500);
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: creator?.email };
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt: body?.prompt || body?.lyrics || '',
        model: String(body?.model || 'MiniMax-Music'),
        generationType: body?.generationType || 'text-to-music',
        visibility: body?.visibility || 'private',
        isPublic: body?.isPublic === true,
        createdBy,
    });
    const result = await generateMusic(apiKey, body);
    const providerUrl = extractDownloadUrl(result);
    if (providerUrl) {
        try {
            const username = creator?.username || uid;
            const { key, publicUrl } = await (0, zataUpload_1.uploadFromUrlToZata)({
                sourceUrl: providerUrl,
                keyPrefix: `users/${username}/music/${historyId}`,
                fileName: 'music-1',
            });
            const audioItem = { id: 'music-1', url: publicUrl, storagePath: key, originalUrl: providerUrl };
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'completed', audios: [audioItem], provider: 'minimax' });
            try {
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
            return { historyId, audios: [audioItem], status: 'completed' };
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[MiniMax] Music Zata upload failed; using provider URL');
            const audioItem = { id: 'music-1', url: providerUrl, originalUrl: providerUrl };
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'completed', audios: [audioItem], provider: 'minimax' });
            try {
                const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
                if (fresh)
                    await generationsMirrorRepository_1.generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
            }
            catch { }
            return { historyId, audios: [audioItem], status: 'completed' };
        }
    }
    // Fallback: hex data in result
    const hexAudio = result?.data?.audio || result?.audio;
    if (!hexAudio || typeof hexAudio !== 'string') {
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'failed', error: 'No audio URL or hex from MiniMax' });
        throw new errorHandler_1.ApiError('MiniMax music response missing downloadable URL or audio hex', 502, result);
    }
    const format = body?.audio_setting?.format || 'mp3';
    const ext = format.toLowerCase() === 'wav' ? 'wav' : format.toLowerCase() === 'pcm' ? 'pcm' : 'mp3';
    const contentType = ext === 'wav' ? 'audio/wav' : ext === 'pcm' ? 'audio/pcm' : 'audio/mpeg';
    const buffer = Buffer.from(hexAudio, 'hex');
    const username = creator?.username || uid;
    const key = `users/${username}/music/${historyId}/music-1.${ext}`;
    const { publicUrl } = await (0, zataUpload_1.uploadBufferToZata)(key, buffer, contentType);
    const audioItem = { id: 'music-1', url: publicUrl, storagePath: key };
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'completed', audios: [audioItem], provider: 'minimax' });
    try {
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
    return { historyId, audios: [audioItem], status: 'completed' };
}
exports.minimaxService = {
    generate,
    generateVideo,
    getVideoStatus,
    getFile,
    generateMusic,
    processVideoFile,
    musicGenerateAndStore,
};
