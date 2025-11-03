"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateReplicateGenerate = validateReplicateGenerate;
const errorHandler_1 = require("../../../utils/errorHandler");
function validateReplicateGenerate(req, _res, next) {
    const { prompt, model, size, width, height, aspect_ratio, max_images, image_input, sequential_image_generation, image } = req.body || {};
    if (!prompt || typeof prompt !== 'string')
        return next(new errorHandler_1.ApiError('prompt is required', 400));
    if (model && typeof model !== 'string')
        return next(new errorHandler_1.ApiError('model must be string', 400));
    const m = String(model || '').toLowerCase();
    const isSeedream = m.includes('bytedance/seedream-4');
    const isIdeogram = m.includes('ideogram-ai/ideogram-v3');
    const isLucidOrigin = m.includes('leonardoai/lucid-origin');
    const isPhoenix = m.includes('leonardoai/phoenix-1.0');
    if (isSeedream) {
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
        if (String(sequential_image_generation) === 'auto') {
            const inputCount = Array.isArray(image_input) ? image_input.length : (typeof image === 'string' ? 1 : 0);
            const requested = typeof max_images === 'number' ? max_images : 1;
            if (inputCount + requested > 15) {
                return next(new errorHandler_1.ApiError('input images + max_images must be <= 15', 400));
            }
        }
    }
    if (isIdeogram) {
        const allowedAspect = new Set([
            '1:3', '3:1', '1:2', '2:1', '9:16', '16:9', '10:16', '16:10', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '1:1'
        ]);
        const allowedResolution = new Set([
            'None', '512x1536', '576x1408', '576x1472', '576x1536', '640x1344', '640x1408', '640x1472', '640x1536', '704x1152', '704x1216', '704x1280', '704x1344', '704x1408', '704x1472', '736x1312', '768x1088', '768x1216', '768x1280', '768x1344', '800x1280', '832x960', '832x1024', '832x1088', '832x1152', '832x1216', '832x1248', '864x1152', '896x960', '896x1024', '896x1088', '896x1120', '896x1152', '960x832', '960x896', '960x1024', '960x1088', '1024x832', '1024x896', '1024x960', '1024x1024', '1088x768', '1088x832', '1088x896', '1088x960', '1120x896', '1152x704', '1152x832', '1152x864', '1152x896', '1216x704', '1216x768', '1216x832', '1248x832', '1280x704', '1280x768', '1280x800', '1312x736', '1344x640', '1344x704', '1344x768', '1408x576', '1408x640', '1408x704', '1472x576', '1472x640', '1472x704', '1536x512', '1536x576', '1536x640'
        ]);
        const allowedStyleType = new Set(['None', 'Auto', 'General', 'Realistic', 'Design']);
        const allowedMagic = new Set(['Auto', 'On', 'Off']);
        if (aspect_ratio != null && !allowedAspect.has(String(aspect_ratio)))
            return next(new errorHandler_1.ApiError('invalid aspect_ratio for ideogram v3', 400));
        if (req.body.resolution != null && !allowedResolution.has(String(req.body.resolution)))
            return next(new errorHandler_1.ApiError('invalid resolution for ideogram v3', 400));
        if (req.body.style_type != null && !allowedStyleType.has(String(req.body.style_type)))
            return next(new errorHandler_1.ApiError('invalid style_type for ideogram v3', 400));
        if (req.body.magic_prompt_option != null && !allowedMagic.has(String(req.body.magic_prompt_option)))
            return next(new errorHandler_1.ApiError('invalid magic_prompt_option for ideogram v3', 400));
        if (req.body.seed != null) {
            if (!Number.isInteger(req.body.seed) || req.body.seed > 2147483647)
                return next(new errorHandler_1.ApiError('seed must be integer <= 2147483647', 400));
        }
        if (req.body.image != null && typeof req.body.image !== 'string')
            return next(new errorHandler_1.ApiError('image must be uri string', 400));
        if (req.body.mask != null && typeof req.body.mask !== 'string')
            return next(new errorHandler_1.ApiError('mask must be uri string', 400));
        if (req.body.style_reference_images != null) {
            if (!Array.isArray(req.body.style_reference_images))
                return next(new errorHandler_1.ApiError('style_reference_images must be array', 400));
            for (const u of req.body.style_reference_images) {
                if (typeof u !== 'string')
                    return next(new errorHandler_1.ApiError('style_reference_images must contain uri strings', 400));
            }
        }
    }
    // Lucid Origin (leonardoai/lucid-origin) validations
    if (isLucidOrigin) {
        const allowedAspect = new Set([
            '1:1', '16:9', '9:16', '3:2', '2:3', '4:5', '5:4', '3:4', '4:3', '2:1', '1:2', '3:1', '1:3'
        ]);
        const allowedStyle = new Set([
            'bokeh', 'cinematic', 'cinematic_close_up', 'creative', 'dynamic', 'fashion', 'film', 'food', 'hdr', 'long_exposure', 'macro', 'minimalist', 'monochrome', 'moody', 'neutral', 'none', 'portrait', 'retro', 'stock_photo', 'unprocessed', 'vibrant'
        ]);
        const allowedContrast = new Set(['low', 'medium', 'high']);
        const allowedMode = new Set(['standard', 'ultra']);
        if (aspect_ratio != null && !allowedAspect.has(String(aspect_ratio)))
            return next(new errorHandler_1.ApiError('invalid aspect_ratio for lucid-origin', 400));
        if (req.body.style != null && !allowedStyle.has(String(req.body.style)))
            return next(new errorHandler_1.ApiError('invalid style for lucid-origin', 400));
        if (req.body.contrast != null && !allowedContrast.has(String(req.body.contrast)))
            return next(new errorHandler_1.ApiError('invalid contrast for lucid-origin', 400));
        if (req.body.num_images != null) {
            if (!Number.isInteger(req.body.num_images) || req.body.num_images < 1 || req.body.num_images > 8)
                return next(new errorHandler_1.ApiError('num_images must be integer 1-8', 400));
        }
        if (req.body.prompt_enhance != null && typeof req.body.prompt_enhance !== 'boolean')
            return next(new errorHandler_1.ApiError('prompt_enhance must be boolean', 400));
        if (req.body.generation_mode != null && !allowedMode.has(String(req.body.generation_mode)))
            return next(new errorHandler_1.ApiError('invalid generation_mode for lucid-origin', 400));
    }
    // Phoenix 1.0 (leonardoai/phoenix-1.0) validations
    if (isPhoenix) {
        const allowedAspect = new Set([
            '1:1', '16:9', '9:16', '3:2', '2:3', '4:5', '5:4', '3:4', '4:3', '2:1', '1:2', '3:1', '1:3'
        ]);
        const allowedStyle = new Set([
            '3d_render', 'bokeh', 'cinematic', 'cinematic_concept', 'creative', 'dynamic', 'fashion', 'graphic_design_pop_art', 'graphic_design_vector', 'hdr', 'illustration', 'macro', 'minimalist', 'moody', 'none', 'portrait', 'pro_bw_photography', 'pro_color_photography', 'pro_film_photography', 'portrait_fashion', 'ray_traced', 'sketch_bw', 'sketch_color', 'stock_photo', 'vibrant'
        ]);
        const allowedContrast = new Set(['low', 'medium', 'high']);
        const allowedMode = new Set(['fast', 'quality', 'ultra']);
        if (aspect_ratio != null && !allowedAspect.has(String(aspect_ratio)))
            return next(new errorHandler_1.ApiError('invalid aspect_ratio for phoenix-1.0', 400));
        if (req.body.style != null && !allowedStyle.has(String(req.body.style)))
            return next(new errorHandler_1.ApiError('invalid style for phoenix-1.0', 400));
        if (req.body.contrast != null && !allowedContrast.has(String(req.body.contrast)))
            return next(new errorHandler_1.ApiError('invalid contrast for phoenix-1.0', 400));
        if (req.body.num_images != null) {
            if (!Number.isInteger(req.body.num_images) || req.body.num_images < 1 || req.body.num_images > 8)
                return next(new errorHandler_1.ApiError('num_images must be integer 1-8', 400));
        }
        if (req.body.prompt_enhance != null && typeof req.body.prompt_enhance !== 'boolean')
            return next(new errorHandler_1.ApiError('prompt_enhance must be boolean', 400));
        if (req.body.generation_mode != null && !allowedMode.has(String(req.body.generation_mode)))
            return next(new errorHandler_1.ApiError('invalid generation_mode for phoenix-1.0', 400));
    }
    next();
}
