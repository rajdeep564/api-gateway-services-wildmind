"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replicateController = void 0;
const replicateService_1 = require("../services/replicateService");
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
exports.replicateController = { removeBackground, upscale, generateImage };
