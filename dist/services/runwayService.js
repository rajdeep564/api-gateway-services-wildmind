"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runwayService = void 0;
const errorHandler_1 = require("../utils/errorHandler");
const runwayRepository_1 = require("../repository/runwayRepository");
const env_1 = require("../config/env");
const generationHistoryRepository_1 = require("../repository/generationHistoryRepository");
const generationsMirrorRepository_1 = require("../repository/generationsMirrorRepository");
const authRepository_1 = require("../repository/auth/authRepository");
const zataUpload_1 = require("../utils/storage/zataUpload");
const creditsRepository_1 = require("../repository/creditsRepository");
const runwayPricing_1 = require("../utils/pricing/runwayPricing");
//
// (SDK handles base/version internally)
let RunwayMLCtor = null;
function getRunwayClient() {
    const apiKey = env_1.env.runwayApiKey;
    if (!apiKey)
        throw new errorHandler_1.ApiError("Runway API key not configured", 500);
    if (!RunwayMLCtor) {
        try {
            // Defer module resolution to runtime so missing SDK doesn't crash boot
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require("@runwayml/sdk");
            RunwayMLCtor = mod?.default || mod;
        }
        catch (_e) {
            throw new errorHandler_1.ApiError("Runway SDK not installed on server", 500);
        }
    }
    return new RunwayMLCtor({ apiKey });
}
async function textToImage(uid, payload) {
    const { promptText, ratio, model, seed, uploadedImages, contentModeration } = payload;
    if (!promptText || !ratio || !model)
        throw new errorHandler_1.ApiError("Missing required fields: promptText, ratio, model", 400);
    if (!["gen4_image", "gen4_image_turbo"].includes(model))
        throw new errorHandler_1.ApiError("Invalid model", 400);
    if (model === "gen4_image_turbo" &&
        (!uploadedImages || uploadedImages.length === 0)) {
        throw new errorHandler_1.ApiError("gen4_image_turbo requires at least one reference image", 400);
    }
    // Prefer SDK
    const client = getRunwayClient();
    // SDK expects referenceImages, not uploadedImages
    const referenceImages = (uploadedImages || []).map((uri, i) => ({ uri, tag: `ref_${i + 1}` }));
    const created = await client.textToImage.create({
        model,
        promptText,
        ratio: ratio,
        ...(seed !== undefined ? { seed } : {}),
        ...(referenceImages.length > 0 ? { referenceImages } : {}),
        ...(contentModeration
            ? {
                contentModeration: {
                    publicFigureThreshold: contentModeration.publicFigureThreshold,
                },
            }
            : {}),
    });
    // Create authoritative history first
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: creator?.email };
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt: promptText,
        model,
        generationType: payload.generationType || 'text-to-image',
        visibility: payload.visibility || 'private',
        tags: payload.tags,
        nsfw: payload.nsfw,
        isPublic: payload.isPublic === true,
        createdBy,
    });
    try {
        await runwayRepository_1.runwayRepository.createTaskRecord({
            mode: "text_to_image",
            model,
            ratio,
            promptText,
            seed,
            taskId: created.id,
            isPublic: payload.isPublic === true,
            createdBy,
        });
    }
    catch { }
    // Store provider identifiers on history
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id });
    return { taskId: created.id, status: "pending", historyId };
}
async function getStatus(uid, id) {
    if (!id)
        throw new errorHandler_1.ApiError("Task ID is required", 400);
    const client = getRunwayClient();
    try {
        const task = await client.tasks.retrieve(id);
        // Optionally persist status progression
        try {
            await runwayRepository_1.runwayRepository.updateTaskRecord(id, {
                status: task.status,
                outputs: Array.isArray(task.output)
                    ? task.output
                    : undefined,
            });
        }
        catch { }
        // When completed, attach outputs into history and mirror
        if (task.status === 'SUCCEEDED') {
            // Find history by providerTaskId (requires uid-scoped search)
            const found = await generationHistoryRepository_1.generationHistoryRepository.findByProviderTaskId(uid, 'runway', id);
            if (found) {
                const outputs = task.output || [];
                const creator = await authRepository_1.authRepository.getUserById(uid);
                const username = creator?.username || uid;
                // Upload each output to Zata (assume images for text_to_image; videos for others)
                const isImage = task?.type === 'text_to_image' || (found.item?.generationType === 'text-to-image');
                if (isImage) {
                    const storedImages = await Promise.all(outputs.map(async (u, i) => {
                        try {
                            const { key, publicUrl } = await (0, zataUpload_1.uploadFromUrlToZata)({
                                sourceUrl: u,
                                keyPrefix: `users/${username}/image/${found.id}`,
                                fileName: `image-${i + 1}`,
                            });
                            return { id: `${id}-${i}`, url: publicUrl, storagePath: key, originalUrl: u };
                        }
                        catch {
                            return { id: `${id}-${i}`, url: u, originalUrl: u };
                        }
                    }));
                    await generationHistoryRepository_1.generationHistoryRepository.update(uid, found.id, { status: 'completed', images: storedImages });
                    try {
                        const { cost, pricingVersion, meta } = (0, runwayPricing_1.computeRunwayCostFromHistoryModel)(found.item.model);
                        await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, found.id, cost, 'runway.generate', { ...meta, historyId: found.id, provider: 'runway', pricingVersion });
                    }
                    catch { }
                }
                else {
                    const storedVideos = await Promise.all(outputs.map(async (u, i) => {
                        try {
                            const { key, publicUrl } = await (0, zataUpload_1.uploadFromUrlToZata)({
                                sourceUrl: u,
                                keyPrefix: `users/${username}/video/${found.id}`,
                                fileName: `video-${i + 1}`,
                            });
                            return { id: `${id}-${i}`, url: publicUrl, storagePath: key, originalUrl: u };
                        }
                        catch {
                            return { id: `${id}-${i}`, url: u, originalUrl: u };
                        }
                    }));
                    await generationHistoryRepository_1.generationHistoryRepository.update(uid, found.id, { status: 'completed', videos: storedVideos });
                    try {
                        const { cost, pricingVersion, meta } = (0, runwayPricing_1.computeRunwayCostFromHistoryModel)(found.item.model);
                        await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, found.id, cost, 'runway.video', { ...meta, historyId: found.id, provider: 'runway', pricingVersion });
                    }
                    catch { }
                }
                try {
                    const creator = await authRepository_1.authRepository.getUserById(uid);
                    const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, found.id);
                    if (fresh) {
                        await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, found.id, fresh, {
                            uid,
                            username: creator?.username,
                            displayName: creator?.displayName,
                            photoURL: creator?.photoURL,
                        });
                    }
                }
                catch { }
            }
        }
        return task;
    }
    catch (e) {
        if (e?.status === 404)
            throw new errorHandler_1.ApiError("Task not found or was deleted/canceled", 404);
        throw new errorHandler_1.ApiError("Runway API request failed", 500, e);
    }
}
async function videoGenerate(uid, body) {
    const client = getRunwayClient();
    const { mode, imageToVideo, videoToVideo, textToVideo, videoUpscale } = body || {};
    if (mode === "image_to_video") {
        const created = await client.imageToVideo.create(imageToVideo);
        const prompt = imageToVideo?.promptText || (imageToVideo && imageToVideo.prompts && imageToVideo.prompts[0]?.text) || '';
        const historyModel = imageToVideo?.model || body?.model || 'runway_video';
        const generationType = body?.generationType || 'image-to-video';
        const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
            prompt,
            model: historyModel,
            generationType,
            visibility: body?.visibility || 'private',
            tags: body?.tags,
            nsfw: body?.nsfw,
            ...(imageToVideo?.duration !== undefined ? { duration: imageToVideo.duration } : {}),
            ...(imageToVideo?.ratio !== undefined ? { ratio: imageToVideo.ratio } : {}),
        });
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id });
        // Persist input images
        try {
            const creator = await authRepository_1.authRepository.getUserById(uid);
            const username = (creator?.username || uid);
            const keyPrefix = `users/${username}/input/${historyId}`;
            const srcs = [];
            if (imageToVideo && imageToVideo.promptImage) {
                const p = imageToVideo.promptImage;
                if (typeof p === 'string')
                    srcs.push(p);
                else if (Array.isArray(p)) {
                    for (const obj of p) {
                        if (obj && typeof obj.uri === 'string')
                            srcs.push(obj.uri);
                    }
                }
            }
            const imgs = [];
            let i = 0;
            for (const src of srcs) {
                try {
                    const stored = /^data:/i.test(src)
                        ? await (0, zataUpload_1.uploadDataUriToZata)({ dataUri: src, keyPrefix, fileName: `input-${++i}` })
                        : await (0, zataUpload_1.uploadFromUrlToZata)({ sourceUrl: src, keyPrefix, fileName: `input-${++i}` });
                    imgs.push({ id: `${created.id}-in-${i}`, url: stored.publicUrl, storagePath: stored.key, originalUrl: src });
                }
                catch { }
            }
            if (imgs.length > 0)
                await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { inputImages: imgs });
        }
        catch { }
        return {
            success: true,
            taskId: created.id,
            mode,
            endpoint: "/v1/image_to_video",
            historyId,
        };
    }
    if (mode === "text_to_video") {
        const created = await client.textToVideo.create(textToVideo);
        const prompt = textToVideo?.promptText || '';
        const historyModel = textToVideo?.model || body?.model || 'runway_video';
        const generationType = body?.generationType || 'text-to-video';
        const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
            prompt,
            model: historyModel,
            generationType,
            visibility: body?.visibility || 'private',
            tags: body?.tags,
            nsfw: body?.nsfw,
            ...(textToVideo?.duration !== undefined ? { duration: textToVideo.duration } : {}),
            ...(textToVideo?.ratio !== undefined ? { ratio: textToVideo.ratio } : {}),
        });
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id });
        return {
            success: true,
            taskId: created.id,
            mode,
            endpoint: "/v1/text_to_video",
            historyId,
        };
    }
    if (mode === "video_to_video") {
        const created = await client.videoToVideo.create(videoToVideo);
        const prompt = videoToVideo?.promptText || (videoToVideo && videoToVideo.prompts && videoToVideo.prompts[0]?.text) || '';
        const historyModel = videoToVideo?.model || body?.model || 'runway_video';
        const generationType = body?.generationType || 'video-to-video';
        const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
            prompt,
            model: historyModel,
            generationType,
            visibility: body?.visibility || 'private',
            tags: body?.tags,
            nsfw: body?.nsfw,
            ...(videoToVideo?.duration !== undefined ? { duration: videoToVideo.duration } : {}),
            ...(videoToVideo?.ratio !== undefined ? { ratio: videoToVideo.ratio } : {}),
        });
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id });
        // Persist input video and references
        try {
            const creator = await authRepository_1.authRepository.getUserById(uid);
            const username = (creator?.username || uid);
            const base = `users/${username}/input/${historyId}`;
            const videos = [];
            const refs = [];
            if (videoToVideo && videoToVideo.videoUri) {
                const v = videoToVideo.videoUri;
                try {
                    const stored = /^data:/i.test(v)
                        ? await (0, zataUpload_1.uploadDataUriToZata)({ dataUri: v, keyPrefix: base, fileName: 'input-video-1' })
                        : await (0, zataUpload_1.uploadFromUrlToZata)({ sourceUrl: v, keyPrefix: base, fileName: 'input-video-1' });
                    videos.push({ id: `${created.id}-vin-1`, url: stored.publicUrl, storagePath: stored.key, originalUrl: v });
                }
                catch { }
            }
            if (videoToVideo && Array.isArray(videoToVideo.references)) {
                let i = 0;
                for (const r of videoToVideo.references) {
                    const uri = r?.uri;
                    if (!uri || typeof uri !== 'string')
                        continue;
                    try {
                        const stored = /^data:/i.test(uri)
                            ? await (0, zataUpload_1.uploadDataUriToZata)({ dataUri: uri, keyPrefix: base, fileName: `input-ref-${++i}` })
                            : await (0, zataUpload_1.uploadFromUrlToZata)({ sourceUrl: uri, keyPrefix: base, fileName: `input-ref-${++i}` });
                        refs.push({ id: `${created.id}-iin-${i}`, url: stored.publicUrl, storagePath: stored.key, originalUrl: uri });
                    }
                    catch { }
                }
            }
            const updates = {};
            if (videos.length > 0)
                updates.inputVideos = videos;
            if (refs.length > 0)
                updates.inputImages = refs;
            if (Object.keys(updates).length > 0)
                await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, updates);
        }
        catch { }
        return {
            success: true,
            taskId: created.id,
            mode,
            endpoint: "/v1/video_to_video",
            historyId,
        };
    }
    if (mode === "video_upscale") {
        const created = await client.videoUpscale.create(videoUpscale);
        const prompt = '';
        const historyModel = videoUpscale?.model || body?.model || 'runway_video_upscale';
        const generationType = body?.generationType || 'text-to-video';
        const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
            prompt,
            model: historyModel,
            generationType,
            visibility: body?.visibility || 'private',
            tags: body?.tags,
            nsfw: body?.nsfw,
            ...(videoUpscale?.duration !== undefined ? { duration: videoUpscale.duration } : {}),
            ...(videoUpscale?.ratio !== undefined ? { ratio: videoUpscale.ratio } : {}),
        });
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id });
        return {
            success: true,
            taskId: created.id,
            mode,
            endpoint: "/v1/video_upscale",
            historyId,
        };
    }
    throw new errorHandler_1.ApiError("Invalid mode. Must be one of image_to_video, text_to_video, video_to_video, video_upscale", 400);
}
exports.runwayService = {
    textToImage,
    getStatus,
    videoGenerate,
};
