"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runwayController = void 0;
const formatApiResponse_1 = require("../utils/formatApiResponse");
const runwayService_1 = require("../services/runwayService");
const generationHistoryRepository_1 = require("../repository/generationHistoryRepository");
async function textToImage(req, res, next) {
    try {
        const uid = req.uid;
        const ctx = req.context || {};
        const result = await runwayService_1.runwayService.textToImage(uid, req.body);
        // Only a task is created here; actual outputs are attached on status success.
        // We can debit now against the historyId to reserve post-charge on success; instead, we debit at completion in getStatus.
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Runway task created', { ...result, expectedDebit: ctx.creditCost }));
    }
    catch (err) {
        next(err);
    }
}
async function getStatus(req, res, next) {
    try {
        const id = String(req.params.id || '');
        const uid = req.uid;
        const result = await runwayService_1.runwayService.getStatus(uid, id);
        if (result?.status === 'SUCCEEDED') {
            try {
                const located = await generationHistoryRepository_1.generationHistoryRepository.findByProviderTaskId(uid, 'runway', id);
                if (located) {
                    const item = located.item;
                    const payload = {
                        historyId: located.id,
                        model: item?.model,
                        status: 'completed',
                    };
                    if (Array.isArray(item?.images) && item.images.length > 0)
                        payload.images = item.images;
                    if (Array.isArray(item?.videos) && item.videos.length > 0)
                        payload.videos = item.videos;
                    return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Runway status', payload));
                }
            }
            catch { }
        }
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Runway status', result));
    }
    catch (err) {
        next(err);
    }
}
async function videoGenerate(req, res, next) {
    try {
        const uid = req.uid;
        const result = await runwayService_1.runwayService.videoGenerate(uid, req.body);
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Runway video task created', result));
    }
    catch (err) {
        next(err);
    }
}
exports.runwayController = {
    textToImage,
    getStatus,
    videoGenerate
};
