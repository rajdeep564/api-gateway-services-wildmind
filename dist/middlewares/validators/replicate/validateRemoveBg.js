"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRemoveBg = validateRemoveBg;
const errorHandler_1 = require("../../../utils/errorHandler");
// Unified validator for background removal and bria/eraser object removal
// Supports legacy models (lucataco/remove-bg, 851-labs/background-remover) and new bria/eraser
function validateRemoveBg(req, _res, next) {
    const { image, image_url, mask, mask_url, mask_type, preserve_alpha, content_moderation, sync, format, reverse, threshold, background_type, model, } = req.body || {};
    if (model && typeof model !== 'string')
        return next(new errorHandler_1.ApiError('model must be string', 400));
    const m = String(model || '').toLowerCase();
    const isEraser = m.includes('bria/eraser');
    // For eraser: require at least one of image or image_url
    // For legacy remove-bg: require image
    if (isEraser) {
        const hasImage = (typeof image === 'string' && image.length > 0) || (typeof image_url === 'string' && image_url.length > 0);
        if (!hasImage)
            return next(new errorHandler_1.ApiError('image or image_url is required for bria/eraser', 400));
    }
    else {
        if (!image || typeof image !== 'string')
            return next(new errorHandler_1.ApiError('image is required (url or data URI)', 400));
    }
    // Legacy model specific options
    if (format && !['png', 'jpg', 'jpeg', 'webp'].includes(String(format).toLowerCase()))
        return next(new errorHandler_1.ApiError('Invalid format', 400));
    if (reverse != null && typeof reverse !== 'boolean')
        return next(new errorHandler_1.ApiError('reverse must be boolean', 400));
    if (threshold != null && (typeof threshold !== 'number' || threshold < 0 || threshold > 1))
        return next(new errorHandler_1.ApiError('threshold must be 0.0-1.0', 400));
    if (background_type != null && typeof background_type !== 'string')
        return next(new errorHandler_1.ApiError('background_type must be string', 400));
    // Eraser-specific options
    if (isEraser) {
        if (mask != null && typeof mask !== 'string')
            return next(new errorHandler_1.ApiError('mask must be a string (url or data URI)', 400));
        if (mask_url != null && typeof mask_url !== 'string')
            return next(new errorHandler_1.ApiError('mask_url must be a string (url)', 400));
        if (image_url != null && typeof image_url !== 'string')
            return next(new errorHandler_1.ApiError('image_url must be a string (url)', 400));
        if (mask_type != null && !['manual', 'automatic'].includes(String(mask_type).toLowerCase()))
            return next(new errorHandler_1.ApiError('mask_type must be "manual" or "automatic"', 400));
        if (preserve_alpha != null && typeof preserve_alpha !== 'boolean')
            return next(new errorHandler_1.ApiError('preserve_alpha must be boolean', 400));
        if (content_moderation != null && typeof content_moderation !== 'boolean')
            return next(new errorHandler_1.ApiError('content_moderation must be boolean', 400));
        if (sync != null && typeof sync !== 'boolean')
            return next(new errorHandler_1.ApiError('sync must be boolean', 400));
    }
    next();
}
