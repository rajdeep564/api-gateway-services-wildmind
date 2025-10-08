"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRemoveBg = validateRemoveBg;
exports.validateUpscale = validateUpscale;
exports.validateReplicateGenerate = validateReplicateGenerate;
const errorHandler_1 = require("../../../utils/errorHandler");
function validateRemoveBg(req, _res, next) {
    const { image, format, reverse, threshold, background_type, model } = req.body || {};
    if (!image || typeof image !== 'string')
        return next(new errorHandler_1.ApiError('image is required (url)', 400));
    if (format && !['png', 'jpg', 'jpeg', 'webp'].includes(String(format).toLowerCase()))
        return next(new errorHandler_1.ApiError('Invalid format', 400));
    if (reverse != null && typeof reverse !== 'boolean')
        return next(new errorHandler_1.ApiError('reverse must be boolean', 400));
    if (threshold != null && (typeof threshold !== 'number' || threshold < 0 || threshold > 1))
        return next(new errorHandler_1.ApiError('threshold must be 0.0-1.0', 400));
    if (background_type != null && typeof background_type !== 'string')
        return next(new errorHandler_1.ApiError('background_type must be string', 400));
    if (model && typeof model !== 'string')
        return next(new errorHandler_1.ApiError('model must be string', 400));
    next();
}
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
function validateReplicateGenerate(req, _res, next) {
    const { prompt, model, size, width, height, aspect_ratio, max_images, image_input, sequential_image_generation, image } = req.body || {};
    if (!prompt || typeof prompt !== 'string')
        return next(new errorHandler_1.ApiError('prompt is required', 400));
    if (model && typeof model !== 'string')
        return next(new errorHandler_1.ApiError('model must be string', 400));
    // Seedream-specific validations (soft)
    if (size != null && !['1K', '2K', '4K', 'custom'].includes(String(size)))
        return next(new errorHandler_1.ApiError("size must be one of '1K' | '2K' | '4K' | 'custom'", 400));
    if (width != null && (typeof width !== 'number' || width < 1024 || width > 4096))
        return next(new errorHandler_1.ApiError('width must be 1024-4096', 400));
    if (height != null && (typeof height !== 'number' || height < 1024 || height > 4096))
        return next(new errorHandler_1.ApiError('height must be 1024-4096', 400));
    if (aspect_ratio != null && !['match_input_image', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'].includes(String(aspect_ratio)))
        return next(new errorHandler_1.ApiError('invalid aspect_ratio', 400));
    if (max_images != null && (typeof max_images !== 'number' || max_images < 1 || max_images > 15))
        return next(new errorHandler_1.ApiError('max_images must be 1-15', 400));
    if (sequential_image_generation != null && !['disabled', 'auto'].includes(String(sequential_image_generation)))
        return next(new errorHandler_1.ApiError("sequential_image_generation must be 'disabled' | 'auto'", 400));
    if (image_input != null) {
        if (!Array.isArray(image_input))
            return next(new errorHandler_1.ApiError('image_input must be array of urls', 400));
        if (image_input.length > 10)
            return next(new errorHandler_1.ApiError('image_input supports up to 10 images', 400));
        for (const u of image_input) {
            if (typeof u !== 'string')
                return next(new errorHandler_1.ApiError('image_input must contain url strings', 400));
        }
    }
    // Enforce total images cap when sequential generation is 'auto': input_count + max_images <= 15
    if (String(sequential_image_generation) === 'auto') {
        const inputCount = Array.isArray(image_input) ? image_input.length : (typeof image === 'string' ? 1 : 0);
        const requested = typeof max_images === 'number' ? max_images : 1;
        if (inputCount + requested > 15) {
            return next(new errorHandler_1.ApiError('input images + max_images must be  15', 400));
        }
    }
    next();
}
