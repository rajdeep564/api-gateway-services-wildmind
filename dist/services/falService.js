"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.falQueueService = exports.falService = void 0;
const errorHandler_1 = require("../utils/errorHandler");
const client_1 = require("@fal-ai/client");
const generationHistoryRepository_1 = require("../repository/generationHistoryRepository");
const generationsMirrorRepository_1 = require("../repository/generationsMirrorRepository");
const authRepository_1 = require("../repository/auth/authRepository");
const env_1 = require("../config/env");
const zataUpload_1 = require("../utils/storage/zataUpload");
const falRepository_1 = require("../repository/falRepository");
const creditsRepository_1 = require("../repository/creditsRepository");
const falPricing_1 = require("../utils/pricing/falPricing");
async function generate(uid, payload) {
    const { prompt, userPrompt, model, 
    // Support both old (n) and new (num_images)
    n, num_images, 
    // New schema: aspect_ratio (fallback to frameSize)
    aspect_ratio, frameSize, uploadedImages = [], output_format = "jpeg", generationType, tags, nsfw, visibility, isPublic, } = payload;
    const imagesRequested = Number.isFinite(num_images) && num_images > 0 ? num_images : (Number.isFinite(n) && n > 0 ? n : 1);
    const resolvedAspect = (aspect_ratio || frameSize || '1:1');
    const falKey = env_1.env.falKey;
    if (!falKey)
        throw new errorHandler_1.ApiError("FAL AI API key not configured", 500);
    if (!prompt)
        throw new errorHandler_1.ApiError("Prompt is required", 400);
    client_1.fal.config({ credentials: falKey });
    // Resolve creator info up-front
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: creator?.email };
    // Create history first (source of truth)
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt,
        model,
        generationType: payload.generationType || 'text-to-image',
        visibility: payload.visibility || 'private',
        tags: payload.tags,
        nsfw: payload.nsfw,
        isPublic: payload.isPublic === true,
        frameSize: resolvedAspect,
        createdBy,
    });
    // Persist any user-uploaded input images to Zata
    try {
        const username = creator?.username || uid;
        const keyPrefix = `users/${username}/input/${historyId}`;
        const inputPersisted = [];
        let idx = 0;
        for (const src of (uploadedImages || [])) {
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
        if (inputPersisted.length > 0)
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted });
    }
    catch { }
    // Create public generations record for FAL (like BFL)
    const legacyId = await falRepository_1.falRepository.createGenerationRecord({ prompt, model, n: imagesRequested, isPublic: payload.isPublic === true }, createdBy);
    // Map our model key to FAL endpoints
    let modelEndpoint;
    if ((model || '').toLowerCase().includes('seedream')) {
        modelEndpoint = 'fal-ai/bytedance/seedream/v4/text-to-image';
    }
    else {
        modelEndpoint = uploadedImages.length > 0
            ? 'fal-ai/gemini-25-flash-image/edit'
            : 'fal-ai/gemini-25-flash-image';
    }
    try {
        const imagePromises = Array.from({ length: imagesRequested }, async (_, index) => {
            const input = { prompt, output_format, num_images: 1 };
            // Seedream expects image_size instead of aspect_ratio; allow explicit image_size override
            if (modelEndpoint.includes('seedream')) {
                const explicit = payload.image_size;
                if (explicit) {
                    input.image_size = explicit;
                }
                else {
                    // Map common aspect ratios to Seedream enums
                    const map = {
                        '1:1': 'square',
                        '4:3': 'landscape_4_3',
                        '3:4': 'portrait_4_3',
                        '16:9': 'landscape_16_9',
                        '9:16': 'portrait_16_9',
                    };
                    input.image_size = map[String(resolvedAspect)] || 'square';
                }
            }
            else if (resolvedAspect) {
                input.aspect_ratio = resolvedAspect;
            }
            if (modelEndpoint.endsWith("/edit")) {
                input.image_urls = uploadedImages.slice(0, 4);
            }
            // Debug log for final body
            try {
                console.log('[falService.generate] request', { modelEndpoint, input });
            }
            catch { }
            const result = await client_1.fal.subscribe(modelEndpoint, { input, logs: true });
            let imageUrl = "";
            if (result?.data?.images?.length > 0) {
                imageUrl = result.data.images[0].url;
            }
            if (!imageUrl)
                throw new errorHandler_1.ApiError("No image URL returned from FAL API", 502);
            return {
                url: imageUrl,
                originalUrl: imageUrl,
                id: result.requestId || `fal-${Date.now()}-${index}`,
            };
        });
        const images = await Promise.all(imagePromises);
        // Upload to Zata and keep both links
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
            catch {
                return { id: img.id, url: img.url, originalUrl: img.originalUrl || img.url };
            }
        }));
        await falRepository_1.falRepository.updateGenerationRecord(legacyId, { status: 'completed', images: storedImages });
        // Update authoritative history and mirror
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, {
            status: 'completed',
            images: storedImages,
            frameSize: resolvedAspect,
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
        // Return Zata URLs to client
        return { images: storedImages, historyId, model, status: "completed" };
    }
    catch (err) {
        const message = err?.message || "Failed to generate images with FAL API";
        try {
            await falRepository_1.falRepository.updateGenerationRecord(legacyId, { status: 'failed', error: message });
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message });
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh) {
                await generationsMirrorRepository_1.generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
            }
        }
        catch { }
        throw new errorHandler_1.ApiError(message, 500);
    }
}
// Veo3 Text-to-Video (standard)
async function veoTextToVideo(uid, payload) {
    const falKey = env_1.env.falKey;
    if (!falKey)
        throw new errorHandler_1.ApiError('FAL AI API key not configured', 500);
    if (!payload.prompt)
        throw new errorHandler_1.ApiError('Prompt is required', 400);
    client_1.fal.config({ credentials: falKey });
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt: payload.prompt,
        model: 'fal-ai/veo3',
        generationType: 'text-to-video',
        visibility: payload.isPublic ? 'public' : 'private',
        isPublic: payload.isPublic ?? false,
        createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
    });
    try {
        const result = await client_1.fal.subscribe('fal-ai/veo3', { input: {
                prompt: payload.prompt,
                aspect_ratio: payload.aspect_ratio ?? '16:9',
                duration: payload.duration ?? '8s',
                negative_prompt: payload.negative_prompt,
                enhance_prompt: payload.enhance_prompt ?? true,
                seed: payload.seed,
                auto_fix: payload.auto_fix ?? true,
                resolution: payload.resolution ?? '720p',
                generate_audio: payload.generate_audio ?? true,
            }, logs: true });
        const videoUrl = result?.data?.video?.url;
        if (!videoUrl)
            throw new errorHandler_1.ApiError('No video URL returned from FAL API', 502);
        const videos = [
            { id: result.requestId || `fal-${Date.now()}`, url: videoUrl, storagePath: '', thumbUrl: undefined },
        ];
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'completed', videos });
        try {
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh)
                await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
                    uid,
                    username: creator?.username,
                    displayName: creator?.displayName,
                    photoURL: creator?.photoURL,
                });
        }
        catch { }
        return { videos, historyId, model: 'fal-ai/veo3', status: 'completed' };
    }
    catch (err) {
        const message = err?.message || 'Failed to generate video with FAL API';
        try {
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message });
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh)
                await generationsMirrorRepository_1.generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
        }
        catch { }
        throw new errorHandler_1.ApiError(message, 500);
    }
}
// Veo3 Text-to-Video (fast)
async function veoTextToVideoFast(uid, payload) {
    const falKey = env_1.env.falKey;
    if (!falKey)
        throw new errorHandler_1.ApiError('FAL AI API key not configured', 500);
    if (!payload.prompt)
        throw new errorHandler_1.ApiError('Prompt is required', 400);
    client_1.fal.config({ credentials: falKey });
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt: payload.prompt,
        model: 'fal-ai/veo3/fast',
        generationType: 'text-to-video',
        visibility: payload.isPublic ? 'public' : 'private',
        isPublic: payload.isPublic ?? false,
        createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
    });
    try {
        const result = await client_1.fal.subscribe('fal-ai/veo3/fast', { input: {
                prompt: payload.prompt,
                aspect_ratio: payload.aspect_ratio ?? '16:9',
                duration: payload.duration ?? '8s',
                negative_prompt: payload.negative_prompt,
                enhance_prompt: payload.enhance_prompt ?? true,
                seed: payload.seed,
                auto_fix: payload.auto_fix ?? true,
                resolution: payload.resolution ?? '720p',
                generate_audio: payload.generate_audio ?? true,
            }, logs: true });
        const videoUrl = result?.data?.video?.url;
        if (!videoUrl)
            throw new errorHandler_1.ApiError('No video URL returned from FAL API', 502);
        const videos = [
            { id: result.requestId || `fal-${Date.now()}`, url: videoUrl, storagePath: '', thumbUrl: undefined },
        ];
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'completed', videos });
        try {
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh)
                await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
                    uid,
                    username: creator?.username,
                    displayName: creator?.displayName,
                    photoURL: creator?.photoURL,
                });
        }
        catch { }
        return { videos, historyId, model: 'fal-ai/veo3/fast', status: 'completed' };
    }
    catch (err) {
        const message = err?.message || 'Failed to generate video with FAL API';
        try {
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message });
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh)
                await generationsMirrorRepository_1.generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
        }
        catch { }
        throw new errorHandler_1.ApiError(message, 500);
    }
}
// Veo3 Image-to-Video (standard)
async function veoImageToVideo(uid, payload) {
    const falKey = env_1.env.falKey;
    if (!falKey)
        throw new errorHandler_1.ApiError('FAL AI API key not configured', 500);
    if (!payload.prompt)
        throw new errorHandler_1.ApiError('Prompt is required', 400);
    if (!payload.image_url)
        throw new errorHandler_1.ApiError('image_url is required', 400);
    client_1.fal.config({ credentials: falKey });
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt: payload.prompt,
        model: 'fal-ai/veo3/image-to-video',
        generationType: 'text-to-video',
        visibility: payload.isPublic ? 'public' : 'private',
        isPublic: payload.isPublic ?? false,
        createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
    });
    try {
        const result = await client_1.fal.subscribe('fal-ai/veo3/image-to-video', { input: {
                prompt: payload.prompt,
                image_url: payload.image_url,
                aspect_ratio: payload.aspect_ratio ?? 'auto',
                duration: payload.duration ?? '8s',
                generate_audio: payload.generate_audio ?? true,
                resolution: payload.resolution ?? '720p',
            }, logs: true });
        const videoUrl = result?.data?.video?.url;
        if (!videoUrl)
            throw new errorHandler_1.ApiError('No video URL returned from FAL API', 502);
        const videos = [
            { id: result.requestId || `fal-${Date.now()}`, url: videoUrl, storagePath: '', thumbUrl: undefined },
        ];
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'completed', videos });
        try {
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh)
                await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
                    uid,
                    username: creator?.username,
                    displayName: creator?.displayName,
                    photoURL: creator?.photoURL,
                });
        }
        catch { }
        return { videos, historyId, model: 'fal-ai/veo3/image-to-video', status: 'completed' };
    }
    catch (err) {
        const message = err?.message || 'Failed to generate video with FAL API';
        try {
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message });
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh)
                await generationsMirrorRepository_1.generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
        }
        catch { }
        throw new errorHandler_1.ApiError(message, 500);
    }
}
// Veo3 Image-to-Video (fast)
async function veoImageToVideoFast(uid, payload) {
    const falKey = env_1.env.falKey;
    if (!falKey)
        throw new errorHandler_1.ApiError('FAL AI API key not configured', 500);
    if (!payload.prompt)
        throw new errorHandler_1.ApiError('Prompt is required', 400);
    if (!payload.image_url)
        throw new errorHandler_1.ApiError('image_url is required', 400);
    client_1.fal.config({ credentials: falKey });
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt: payload.prompt,
        model: 'fal-ai/veo3/fast/image-to-video',
        generationType: 'text-to-video',
        visibility: payload.isPublic ? 'public' : 'private',
        isPublic: payload.isPublic ?? false,
        createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
    });
    try {
        const result = await client_1.fal.subscribe('fal-ai/veo3/fast/image-to-video', { input: {
                prompt: payload.prompt,
                image_url: payload.image_url,
                aspect_ratio: payload.aspect_ratio ?? 'auto',
                duration: payload.duration ?? '8s',
                generate_audio: payload.generate_audio ?? true,
                resolution: payload.resolution ?? '720p',
            }, logs: true });
        const videoUrl = result?.data?.video?.url;
        if (!videoUrl)
            throw new errorHandler_1.ApiError('No video URL returned from FAL API', 502);
        const videos = [
            { id: result.requestId || `fal-${Date.now()}`, url: videoUrl, storagePath: '', thumbUrl: undefined },
        ];
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'completed', videos });
        try {
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh)
                await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
                    uid,
                    username: creator?.username,
                    displayName: creator?.displayName,
                    photoURL: creator?.photoURL,
                });
        }
        catch { }
        return { videos, historyId, model: 'fal-ai/veo3/fast/image-to-video', status: 'completed' };
    }
    catch (err) {
        const message = err?.message || 'Failed to generate video with FAL API';
        try {
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message });
            const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
            if (fresh)
                await generationsMirrorRepository_1.generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
        }
        catch { }
        throw new errorHandler_1.ApiError(message, 500);
    }
}
exports.falService = {
    generate,
};
async function queueCreateHistory(uid, data) {
    const creator = await authRepository_1.authRepository.getUserById(uid);
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
        prompt: data.prompt,
        model: data.model,
        generationType: 'text-to-video',
        visibility: data.isPublic ? 'public' : 'private',
        isPublic: data.isPublic ?? false,
        createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
    });
    return { historyId, creator };
}
async function veoTtvSubmit(uid, body, fast = false) {
    const falKey = env_1.env.falKey;
    if (!falKey)
        throw new errorHandler_1.ApiError('FAL AI API key not configured', 500);
    client_1.fal.config({ credentials: falKey });
    if (!body?.prompt)
        throw new errorHandler_1.ApiError('Prompt is required', 400);
    const model = fast ? 'fal-ai/veo3/fast' : 'fal-ai/veo3';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await client_1.fal.queue.submit(model, {
        input: {
            prompt: body.prompt,
            aspect_ratio: body.aspect_ratio ?? '16:9',
            duration: body.duration ?? '8s',
            negative_prompt: body.negative_prompt,
            enhance_prompt: body.enhance_prompt ?? true,
            seed: body.seed,
            auto_fix: body.auto_fix ?? true,
            resolution: body.resolution ?? '720p',
            generate_audio: body.generate_audio ?? true,
        },
    });
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id });
    return { requestId: request_id, historyId, model, status: 'submitted' };
}
async function veoI2vSubmit(uid, body, fast = false) {
    const falKey = env_1.env.falKey;
    if (!falKey)
        throw new errorHandler_1.ApiError('FAL AI API key not configured', 500);
    client_1.fal.config({ credentials: falKey });
    if (!body?.prompt)
        throw new errorHandler_1.ApiError('Prompt is required', 400);
    if (!body?.image_url)
        throw new errorHandler_1.ApiError('image_url is required', 400);
    const model = fast ? 'fal-ai/veo3/fast/image-to-video' : 'fal-ai/veo3/image-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await client_1.fal.queue.submit(model, {
        input: {
            prompt: body.prompt,
            image_url: body.image_url,
            aspect_ratio: body.aspect_ratio ?? 'auto',
            duration: body.duration ?? '8s',
            generate_audio: body.generate_audio ?? true,
            resolution: body.resolution ?? '720p',
        },
    });
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id });
    return { requestId: request_id, historyId, model, status: 'submitted' };
}
async function queueStatus(_uid, model, requestId) {
    const falKey = env_1.env.falKey;
    if (!falKey)
        throw new errorHandler_1.ApiError('FAL AI API key not configured', 500);
    client_1.fal.config({ credentials: falKey });
    const status = await client_1.fal.queue.status(model, { requestId, logs: true });
    return status;
}
async function queueResult(uid, model, requestId) {
    const falKey = env_1.env.falKey;
    if (!falKey)
        throw new errorHandler_1.ApiError('FAL AI API key not configured', 500);
    client_1.fal.config({ credentials: falKey });
    const result = await client_1.fal.queue.result(model, { requestId });
    const located = await generationHistoryRepository_1.generationHistoryRepository.findByProviderTaskId(uid, 'fal', requestId);
    if (result?.data?.video?.url && located) {
        const providerUrl = result.data.video.url;
        let videos = [];
        try {
            const username = (await authRepository_1.authRepository.getUserById(uid))?.username || uid;
            const keyPrefix = `users/${username}/video/${located.id}`;
            const uploaded = await (0, zataUpload_1.uploadFromUrlToZata)({
                sourceUrl: providerUrl,
                keyPrefix,
                fileName: 'video-1',
            });
            videos = [{ id: requestId, url: uploaded.publicUrl, storagePath: uploaded.key }];
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, located.id, { status: 'completed', videos: [{ id: requestId, url: uploaded.publicUrl, storagePath: uploaded.key, originalUrl: providerUrl }] });
        }
        catch (e) {
            // Fallback to provider URL if Zata upload fails
            videos = [{ id: requestId, url: providerUrl, storagePath: '' }];
            await generationHistoryRepository_1.generationHistoryRepository.update(uid, located.id, { status: 'completed', videos: [{ id: requestId, url: providerUrl, storagePath: '', originalUrl: providerUrl }] });
        }
        const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, located.id);
        if (fresh) {
            const creator = await authRepository_1.authRepository.getUserById(uid);
            await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, located.id, fresh, {
                uid,
                username: creator?.username,
                displayName: creator?.displayName,
                photoURL: creator?.photoURL,
            });
        }
        // Build enriched response with Zata and original URLs
        const enrichedVideos = (fresh?.videos && Array.isArray(fresh.videos) ? fresh.videos : videos).map((v) => ({
            id: v.id,
            url: v.url,
            storagePath: v.storagePath,
            originalUrl: v.originalUrl || providerUrl,
        }));
        try {
            const { cost, pricingVersion, meta } = (0, falPricing_1.computeFalVeoCostFromModel)(model);
            await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, located.id, cost, 'fal.queue.veo', { ...meta, historyId: located.id, provider: 'fal', pricingVersion });
        }
        catch { }
        return { videos: enrichedVideos, historyId: located.id, model, requestId, status: 'completed' };
    }
    // Handle image outputs (T2I/I2I)
    if (located && (result?.data?.images?.length || result?.data?.image?.url)) {
        const username = (await authRepository_1.authRepository.getUserById(uid))?.username || uid;
        const keyPrefix = `users/${username}/image/${located.id}`;
        const providerImages = Array.isArray(result?.data?.images)
            ? result.data.images
            : result?.data?.image?.url
                ? [{ url: result.data.image.url }]
                : [];
        const stored = await Promise.all(providerImages.map(async (img, index) => {
            try {
                const up = await (0, zataUpload_1.uploadFromUrlToZata)({ sourceUrl: img.url, keyPrefix, fileName: `image-${index + 1}` });
                return { id: `${requestId}-${index + 1}`, url: up.publicUrl, storagePath: up.key, originalUrl: img.url };
            }
            catch {
                return { id: `${requestId}-${index + 1}`, url: img.url, originalUrl: img.url };
            }
        }));
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, located.id, { status: 'completed', images: stored });
        try {
            const { cost, pricingVersion, meta } = (0, falPricing_1.computeFalVeoCostFromModel)(model);
            await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, located.id, cost, 'fal.queue.image', { ...meta, historyId: located.id, provider: 'fal', pricingVersion });
        }
        catch { }
        const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, located.id);
        if (fresh) {
            const creator = await authRepository_1.authRepository.getUserById(uid);
            await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, located.id, fresh, {
                uid,
                username: creator?.username,
                displayName: creator?.displayName,
                photoURL: creator?.photoURL,
            });
        }
        return { images: stored, historyId: located.id, model, requestId, status: 'completed' };
    }
    return result;
}
exports.falQueueService = {
    veoTtvSubmit,
    veoI2vSubmit,
    queueStatus,
    queueResult,
};
