"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generationHistoryService = void 0;
exports.startGeneration = startGeneration;
exports.markGenerationCompleted = markGenerationCompleted;
exports.markGenerationFailed = markGenerationFailed;
exports.getUserGeneration = getUserGeneration;
exports.listUserGenerations = listUserGenerations;
exports.softDelete = softDelete;
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
exports.generationHistoryService = {
    startGeneration,
    markGenerationCompleted,
    markGenerationFailed,
    getUserGeneration,
    listUserGenerations,
    softDelete,
};
