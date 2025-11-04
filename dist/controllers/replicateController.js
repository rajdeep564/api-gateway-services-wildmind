"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replicateController = void 0;
exports.wanT2vSubmit = wanT2vSubmit;
exports.wanI2vSubmit = wanI2vSubmit;
exports.queueStatus = queueStatus;
exports.queueResult = queueResult;
exports.klingT2vSubmit = klingT2vSubmit;
exports.klingI2vSubmit = klingI2vSubmit;
exports.seedanceT2vSubmit = seedanceT2vSubmit;
exports.seedanceI2vSubmit = seedanceI2vSubmit;
exports.pixverseT2vSubmit = pixverseT2vSubmit;
exports.pixverseI2vSubmit = pixverseI2vSubmit;
const replicateService_1 = require("../services/replicateService");
const formatApiResponse_1 = require("../utils/formatApiResponse");
async function removeBackground(req, res, next) {
    try {
        const uid = req.uid;
        const data = await replicateService_1.replicateService.removeBackground(uid, req.body || {});
        res.locals = { ...res.locals, success: true };
        res.json({ responseStatus: 'success', message: 'OK', data });
    }
    catch (e) {
        next(e);
        return;
    }
}
async function upscale(req, res, next) {
    try {
        const uid = req.uid;
        const data = await replicateService_1.replicateService.upscale(uid, req.body || {});
        res.locals = { ...res.locals, success: true };
        res.json({ responseStatus: 'success', message: 'OK', data });
    }
    catch (e) {
        next(e);
        return;
    }
}
async function generateImage(req, res, next) {
    try {
        const uid = req.uid;
        const data = await replicateService_1.replicateService.generateImage(uid, req.body || {});
        res.locals = { ...res.locals, success: true };
        res.json({ responseStatus: 'success', message: 'OK', data });
    }
    catch (e) {
        next(e);
        return;
    }
}
async function wanI2V(req, res, next) {
    try {
        const uid = req.uid;
        const data = await replicateService_1.replicateService.wanI2V(uid, req.body || {});
        res.locals = { ...res.locals, success: true };
        res.json({ responseStatus: 'success', message: 'OK', data });
    }
    catch (e) {
        next(e);
        return;
    }
}
async function wanT2V(req, res, next) {
    try {
        const uid = req.uid;
        const data = await replicateService_1.replicateService.wanT2V(uid, req.body || {});
        res.locals = { ...res.locals, success: true };
        res.json({ responseStatus: 'success', message: 'OK', data });
    }
    catch (e) {
        next(e);
        return;
    }
}
exports.replicateController = { removeBackground, upscale, generateImage, wanI2V, wanT2V };
// Queue-style handlers for Replicate WAN 2.5
async function wanT2vSubmit(req, res, next) {
    try {
        const uid = req.uid;
        const result = await replicateService_1.replicateService.wanT2vSubmit(uid, req.body || {});
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', result));
    }
    catch (e) {
        next(e);
    }
}
async function wanI2vSubmit(req, res, next) {
    try {
        const uid = req.uid;
        const result = await replicateService_1.replicateService.wanI2vSubmit(uid, req.body || {});
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', result));
    }
    catch (e) {
        next(e);
    }
}
async function queueStatus(req, res, next) {
    try {
        const uid = req.uid;
        const requestId = req.query.requestId || req.body?.requestId;
        if (!requestId)
            return res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', 'requestId is required', null));
        const result = await replicateService_1.replicateService.replicateQueueStatus(uid, requestId);
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Status', result));
    }
    catch (e) {
        next(e);
    }
}
async function queueResult(req, res, next) {
    try {
        const uid = req.uid;
        const requestId = req.query.requestId || req.body?.requestId;
        if (!requestId)
            return res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', 'requestId is required', null));
        const result = await replicateService_1.replicateService.replicateQueueResult(uid, requestId);
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Result', result));
    }
    catch (e) {
        next(e);
    }
}
Object.assign(exports.replicateController, { wanT2vSubmit, wanI2vSubmit, queueStatus, queueResult });
// Kling queue handlers
async function klingT2vSubmit(req, res, next) {
    try {
        const uid = req.uid;
        const result = await replicateService_1.replicateService.klingT2vSubmit(uid, req.body || {});
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', result));
    }
    catch (e) {
        next(e);
    }
}
async function klingI2vSubmit(req, res, next) {
    try {
        const uid = req.uid;
        const result = await replicateService_1.replicateService.klingI2vSubmit(uid, req.body || {});
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', result));
    }
    catch (e) {
        next(e);
    }
}
Object.assign(exports.replicateController, { klingT2vSubmit, klingI2vSubmit });
// Seedance queue handlers
async function seedanceT2vSubmit(req, res, next) {
    try {
        const uid = req.uid;
        const result = await replicateService_1.replicateService.seedanceT2vSubmit(uid, req.body || {});
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', result));
    }
    catch (e) {
        next(e);
    }
}
async function seedanceI2vSubmit(req, res, next) {
    try {
        const uid = req.uid;
        const result = await replicateService_1.replicateService.seedanceI2vSubmit(uid, req.body || {});
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', result));
    }
    catch (e) {
        next(e);
    }
}
Object.assign(exports.replicateController, { seedanceT2vSubmit, seedanceI2vSubmit });
// PixVerse queue handlers
async function pixverseT2vSubmit(req, res, next) {
    try {
        const uid = req.uid;
        const result = await replicateService_1.replicateService.pixverseT2vSubmit(uid, req.body || {});
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', result));
    }
    catch (e) {
        next(e);
    }
}
async function pixverseI2vSubmit(req, res, next) {
    try {
        const uid = req.uid;
        const result = await replicateService_1.replicateService.pixverseI2vSubmit(uid, req.body || {});
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', result));
    }
    catch (e) {
        next(e);
    }
}
Object.assign(exports.replicateController, { pixverseT2vSubmit, pixverseI2vSubmit });
