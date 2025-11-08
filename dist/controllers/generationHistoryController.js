"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generationHistoryController = void 0;
const generationHistoryService_1 = require("../services/generationHistoryService");
const formatApiResponse_1 = require("../utils/formatApiResponse");
async function create(req, res, next) {
    try {
        const uid = req.uid;
        const result = await generationHistoryService_1.generationHistoryService.startGeneration(uid, req.body);
        return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Generation started', result));
    }
    catch (err) {
        return next(err);
    }
}
async function updateStatus(req, res, next) {
    try {
        const uid = req.uid;
        const { historyId } = req.params;
        const { status } = req.body;
        if (status === 'completed') {
            await generationHistoryService_1.generationHistoryService.markGenerationCompleted(uid, historyId, req.body);
            return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Generation marked completed', {}));
        }
        if (status === 'failed') {
            await generationHistoryService_1.generationHistoryService.markGenerationFailed(uid, historyId, req.body);
            return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Generation marked failed', {}));
        }
        return res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', 'Invalid status', {}));
    }
    catch (err) {
        return next(err);
    }
}
async function get(req, res, next) {
    try {
        const uid = req.uid;
        const { historyId } = req.params;
        const item = await generationHistoryService_1.generationHistoryService.getUserGeneration(uid, historyId);
        if (!item)
            return res.status(404).json((0, formatApiResponse_1.formatApiResponse)('error', 'Not found', {}));
        return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'OK', { item }));
    }
    catch (err) {
        return next(err);
    }
}
async function listMine(req, res, next) {
    try {
        const uid = req.uid;
        const { limit = 20, cursor, status, generationType, sortBy, sortOrder, mode, dateStart, dateEnd, search } = req.query;
        // Support grouped mode for convenience (e.g., mode=video)
        let generationTypeFilter = generationType;
        if (typeof mode === 'string' && mode.toLowerCase() === 'video') {
            generationTypeFilter = ['text-to-video', 'image-to-video', 'video-to-video'];
        }
        const result = await generationHistoryService_1.generationHistoryService.listUserGenerations(uid, {
            limit: Number(limit),
            cursor,
            status,
            generationType: generationTypeFilter,
            sortBy: sortBy || 'createdAt',
            sortOrder: sortOrder || 'desc',
            dateStart,
            dateEnd,
            search,
        });
        return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'OK', result));
    }
    catch (err) {
        return next(err);
    }
}
async function softDelete(req, res, next) {
    try {
        const uid = req.uid;
        const { historyId } = req.params;
        await generationHistoryService_1.generationHistoryService.softDelete(uid, historyId);
        return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Deleted', {}));
    }
    catch (err) {
        return next(err);
    }
}
async function update(req, res, next) {
    try {
        const uid = req.uid;
        const { historyId } = req.params;
        const updates = req.body;
        // Allow per-media privacy updates: image/video payloads are forwarded verbatim
        await generationHistoryService_1.generationHistoryService.update(uid, historyId, updates);
        return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Updated', {}));
    }
    catch (err) {
        return next(err);
    }
}
exports.generationHistoryController = {
    create,
    updateStatus,
    get,
    listMine,
    softDelete,
    update,
};
