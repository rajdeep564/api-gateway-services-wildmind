"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateUpscale = validateUpscale;
const errorHandler_1 = require("../../../utils/errorHandler");
function validateUpscale(req, _res, next) {
    const { image, model, scale, face_enhance, task } = req.body || {};
    if (!image || typeof image !== 'string')
        return next(new errorHandler_1.ApiError('image is required (url)', 400));
    if (model && typeof model !== 'string')
        return next(new errorHandler_1.ApiError('model must be string', 400));
    if (scale != null && (typeof scale !== 'number' || scale < 0 || scale > 10))
        return next(new errorHandler_1.ApiError('scale must be 0-10', 400));
    if (face_enhance != null && typeof face_enhance !== 'boolean')
        return next(new errorHandler_1.ApiError('face_enhance must be boolean', 400));
    if (task != null) {
        if (typeof task !== 'string')
            return next(new errorHandler_1.ApiError('task must be string', 400));
        const allowed = new Set(['classical_sr', 'real_sr', 'compressed_sr']);
        if (!allowed.has(String(task)))
            return next(new errorHandler_1.ApiError("task must be one of 'classical_sr' | 'real_sr' | 'compressed_sr'", 400));
    }
    next();
}
