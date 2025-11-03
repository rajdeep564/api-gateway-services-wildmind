"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generationHistoryService = void 0;
exports.startGeneration = startGeneration;
exports.markGenerationCompleted = markGenerationCompleted;
exports.markGenerationFailed = markGenerationFailed;
exports.getUserGeneration = getUserGeneration;
exports.listUserGenerations = listUserGenerations;
exports.softDelete = softDelete;
exports.update = update;
const generationHistoryRepository_1 = require("../repository/generationHistoryRepository");
const generationsMirrorRepository_1 = require("../repository/generationsMirrorRepository");
const generate_1 = require("../types/generate");
const authRepository_1 = require("../repository/auth/authRepository");
const errorHandler_1 = require("../utils/errorHandler");
async function startGeneration(uid, payload) {
    const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, payload);
    const item = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
    if (!item)
        throw new errorHandler_1.ApiError("Failed to read created history item", 500);
    try {
        const creator = await authRepository_1.authRepository.getUserById(uid);
        await generationsMirrorRepository_1.generationsMirrorRepository.upsertFromHistory(uid, historyId, item, {
            uid,
            username: creator?.username,
            displayName: creator?.displayName,
            photoURL: creator?.photoURL,
        });
    }
    catch { }
    return { historyId, item };
}
async function markGenerationCompleted(uid, historyId, updates) {
    const existing = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
    if (!existing)
        throw new errorHandler_1.ApiError("History item not found", 404);
    if (existing.status !== generate_1.GenerationStatus.Generating)
        throw new errorHandler_1.ApiError("Invalid status transition", 400);
    const next = {
        status: generate_1.GenerationStatus.Completed,
        images: updates.images,
        videos: updates.videos,
        isPublic: updates.isPublic ?? existing.isPublic ?? false,
        tags: updates.tags ?? existing.tags,
        nsfw: updates.nsfw ?? existing.nsfw,
    };
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, next);
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
}
async function markGenerationFailed(uid, historyId, payload) {
    const existing = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
    if (!existing)
        throw new errorHandler_1.ApiError("History item not found", 404);
    if (existing.status !== generate_1.GenerationStatus.Generating)
        throw new errorHandler_1.ApiError("Invalid status transition", 400);
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, {
        status: generate_1.GenerationStatus.Failed,
        error: payload.error,
    });
    try {
        const fresh = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
        if (fresh) {
            await generationsMirrorRepository_1.generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
        }
    }
    catch { }
}
async function getUserGeneration(uid, historyId) {
    return generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
}
async function listUserGenerations(uid, params) {
    // Delegate to repository; it handles optional in-memory date-range fallback when indexes are missing
    return generationHistoryRepository_1.generationHistoryRepository.list(uid, params);
}
async function softDelete(uid, historyId) {
    const existing = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
    if (!existing)
        throw new errorHandler_1.ApiError('History item not found', 404);
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, { isDeleted: true, isPublic: false });
    try {
        await generationsMirrorRepository_1.generationsMirrorRepository.updateFromHistory(uid, historyId, { isDeleted: true, isPublic: false });
    }
    catch (e) {
        try {
            await generationsMirrorRepository_1.generationsMirrorRepository.remove(historyId);
        }
        catch { }
    }
}
async function update(uid, historyId, updates) {
    const existing = await generationHistoryRepository_1.generationHistoryRepository.get(uid, historyId);
    if (!existing)
        throw new errorHandler_1.ApiError('History item not found', 404);
    // Support per-media privacy updates
    let nextDoc = { ...updates };
    // If client sends { image: { id, isPublic } } then update matching image in arrays
    const anyImageUpdate = updates?.image;
    if (anyImageUpdate && typeof anyImageUpdate === 'object') {
        const imgUpd = anyImageUpdate;
        const images = Array.isArray(existing.images) ? [...existing.images] : [];
        const idx = images.findIndex((im) => (imgUpd.id && im.id === imgUpd.id) || (imgUpd.url && im.url === imgUpd.url) || (imgUpd.storagePath && im.storagePath === imgUpd.storagePath));
        if (idx >= 0) {
            images[idx] = { ...images[idx], ...imgUpd };
            nextDoc.images = images;
        }
    }
    // If client sends { video: { id, isPublic } } then update matching video in arrays
    const anyVideoUpdate = updates?.video;
    if (anyVideoUpdate && typeof anyVideoUpdate === 'object') {
        const vdUpd = anyVideoUpdate;
        const videos = Array.isArray(existing.videos) ? [...existing.videos] : [];
        const idx = videos.findIndex((vd) => (vdUpd.id && vd.id === vdUpd.id) || (vdUpd.url && vd.url === vdUpd.url) || (vdUpd.storagePath && vd.storagePath === vdUpd.storagePath));
        if (idx >= 0) {
            videos[idx] = { ...videos[idx], ...vdUpd };
            nextDoc.videos = videos;
        }
    }
    // Recompute document-level isPublic as true if any media item is explicitly public
    if (nextDoc.images || nextDoc.videos || typeof updates?.isPublic === 'boolean') {
        const imgs = (nextDoc.images || existing.images || []);
        const vds = (nextDoc.videos || existing.videos || []);
        const anyPublic = imgs.some((im) => im?.isPublic === true) || vds.some((vd) => vd?.isPublic === true);
        nextDoc.isPublic = anyPublic;
    }
    await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, nextDoc);
    try {
        await generationsMirrorRepository_1.generationsMirrorRepository.updateFromHistory(uid, historyId, nextDoc);
    }
    catch (e) {
        console.warn('Failed to update mirror repository:', e);
    }
}
exports.generationHistoryService = {
    startGeneration,
    markGenerationCompleted,
    markGenerationFailed,
    getUserGeneration,
    listUserGenerations,
    softDelete,
    update,
};
