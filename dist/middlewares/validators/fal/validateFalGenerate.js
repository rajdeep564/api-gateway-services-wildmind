"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateFalLtx2FastT2v = exports.validateFalLtx2ProT2v = exports.validateFalSora2RemixByHistory = exports.validateFalSora2Remix = exports.validateFalSora2ProT2v = exports.validateFalSora2T2v = exports.validateFalLtx2FastI2v = exports.validateFalLtx2ProI2v = exports.validateFalVeo31FirstLast = exports.validateFalSora2ProI2v = exports.validateFalSora2I2v = exports.validateFalVeo31ReferenceToVideo = exports.validateFalVeo31FirstLastFast = exports.validateFalVeoImageToVideoFastSubmit = exports.validateFalVeoImageToVideoSubmit = exports.validateFalVeoTextToVideoFastSubmit = exports.validateFalVeoTextToVideoSubmit = exports.validateFalQueueResult = exports.validateFalQueueStatus = exports.validateFalVeoImageToVideoFast = exports.validateFalVeoImageToVideo = exports.validateFalVeoTextToVideoFast = exports.validateFalVeoTextToVideo = exports.validateFalGenerate = exports.ALLOWED_FAL_MODELS = void 0;
const express_validator_1 = require("express-validator");
const errorHandler_1 = require("../../../utils/errorHandler");
exports.ALLOWED_FAL_MODELS = [
    'gemini-25-flash-image',
    'seedream-v4',
    // Imagen 4 image generation variants (frontend model keys)
    'imagen-4-ultra',
    'imagen-4',
    'imagen-4-fast'
];
exports.validateFalGenerate = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']).withMessage('invalid generationType'),
    (0, express_validator_1.body)('model').isString().isIn(exports.ALLOWED_FAL_MODELS),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(['1:1', '16:9', '9:16', '3:4', '4:3']),
    (0, express_validator_1.body)('n').optional().isInt({ min: 1, max: 10 }),
    (0, express_validator_1.body)('num_images').optional().isInt({ min: 1, max: 4 }),
    (0, express_validator_1.body)('uploadedImages').optional().isArray(),
    (0, express_validator_1.body)('output_format').optional().isIn(['jpeg', 'png', 'webp']),
    (0, express_validator_1.body)('resolution').optional().isIn(['1K', '2K']),
    (0, express_validator_1.body)('seed').optional().isInt(),
    (0, express_validator_1.body)('negative_prompt').optional().isString(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
// Veo3 Text-to-Video (standard and fast)
exports.validateFalVeoTextToVideo = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(['16:9', '9:16', '1:1']),
    (0, express_validator_1.body)('duration').optional().isIn(['4s', '6s', '8s']),
    (0, express_validator_1.body)('negative_prompt').optional().isString(),
    (0, express_validator_1.body)('enhance_prompt').optional().isBoolean(),
    (0, express_validator_1.body)('seed').optional().isInt(),
    (0, express_validator_1.body)('auto_fix').optional().isBoolean(),
    (0, express_validator_1.body)('resolution').optional().isIn(['720p', '1080p']),
    (0, express_validator_1.body)('generate_audio').optional().isBoolean(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
exports.validateFalVeoTextToVideoFast = exports.validateFalVeoTextToVideo;
// Veo3 Image-to-Video (standard and fast)
exports.validateFalVeoImageToVideo = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('image_url').isString().notEmpty(),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(['auto', '16:9', '9:16']),
    (0, express_validator_1.body)('duration').optional().isIn(['8s']),
    (0, express_validator_1.body)('generate_audio').optional().isBoolean(),
    (0, express_validator_1.body)('resolution').optional().isIn(['720p', '1080p']),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
exports.validateFalVeoImageToVideoFast = exports.validateFalVeoImageToVideo;
// Queue validators
exports.validateFalQueueStatus = [
    (0, express_validator_1.body)('requestId').optional().isString(), // in case of POST body
    (req, _res, next) => {
        const requestId = req.query.requestId || req.body?.requestId;
        if (!requestId)
            return next(new errorHandler_1.ApiError('requestId is required', 400));
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
exports.validateFalQueueResult = exports.validateFalQueueStatus;
exports.validateFalVeoTextToVideoSubmit = exports.validateFalVeoTextToVideo;
exports.validateFalVeoTextToVideoFastSubmit = exports.validateFalVeoTextToVideoFast;
exports.validateFalVeoImageToVideoSubmit = exports.validateFalVeoImageToVideo;
exports.validateFalVeoImageToVideoFastSubmit = exports.validateFalVeoImageToVideoFast;
// NanoBanana uses unified generate/queue; no separate validators
// Veo 3.1 First/Last Frame to Video (Fast)
exports.validateFalVeo31FirstLastFast = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    // Accept either our previous naming or FAL's canonical keys
    (0, express_validator_1.body)('start_image_url').optional().isString(),
    (0, express_validator_1.body)('last_frame_image_url').optional().isString(),
    (0, express_validator_1.body)('first_frame_url').optional().isString(),
    (0, express_validator_1.body)('last_frame_url').optional().isString(),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(['16:9', '9:16', '1:1', 'auto']),
    (0, express_validator_1.body)('duration').optional().isIn(['8s']),
    (0, express_validator_1.body)('generate_audio').optional().isBoolean(),
    (0, express_validator_1.body)('resolution').optional().isIn(['720p', '1080p']),
    (req, _res, next) => {
        // Ensure at least one pair of first/last is provided
        const hasStart = typeof (req.body?.start_image_url) === 'string' || typeof (req.body?.first_frame_url) === 'string';
        const hasLast = typeof (req.body?.last_frame_image_url) === 'string' || typeof (req.body?.last_frame_url) === 'string';
        if (!hasStart || !hasLast) {
            return next(new errorHandler_1.ApiError('first/last frame URLs are required (use first_frame_url/last_frame_url or start_image_url/last_frame_image_url)', 400));
        }
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
// Veo 3.1 Reference-to-Video (Standard)
exports.validateFalVeo31ReferenceToVideo = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('image_urls').isArray({ min: 1 }).withMessage('image_urls must be a non-empty array of URLs'),
    (0, express_validator_1.body)('image_urls.*').isString().notEmpty(),
    (0, express_validator_1.body)('duration').optional().isIn(['8s']),
    (0, express_validator_1.body)('resolution').optional().isIn(['720p', '1080p']),
    (0, express_validator_1.body)('generate_audio').optional().isBoolean(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
// Sora 2 Image-to-Video (Standard)
exports.validateFalSora2I2v = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('image_url').isString().notEmpty(),
    (0, express_validator_1.body)('resolution').optional().isIn(['auto', '720p']),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(['auto', '16:9', '9:16']),
    (0, express_validator_1.body)('duration').optional().isIn([4, 8, 12]).withMessage('duration must be 4, 8, or 12'),
    (0, express_validator_1.body)('api_key').optional().isString(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
// Sora 2 Image-to-Video (Pro)
exports.validateFalSora2ProI2v = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('image_url').isString().notEmpty(),
    (0, express_validator_1.body)('resolution').optional().isIn(['auto', '720p', '1080p']),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(['auto', '16:9', '9:16']),
    (0, express_validator_1.body)('duration').optional().isIn([4, 8, 12]).withMessage('duration must be 4, 8, or 12'),
    (0, express_validator_1.body)('api_key').optional().isString(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
// Veo 3.1 First/Last Frame to Video (Standard)
exports.validateFalVeo31FirstLast = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('first_frame_url').optional().isString(),
    (0, express_validator_1.body)('last_frame_url').optional().isString(),
    // Support alias keys as well for flexibility
    (0, express_validator_1.body)('start_image_url').optional().isString(),
    (0, express_validator_1.body)('last_frame_image_url').optional().isString(),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(['auto', '16:9', '9:16', '1:1']),
    (0, express_validator_1.body)('duration').optional().isIn(['8s']),
    (0, express_validator_1.body)('generate_audio').optional().isBoolean(),
    (0, express_validator_1.body)('resolution').optional().isIn(['720p', '1080p']),
    (req, _res, next) => {
        const hasFirst = typeof (req.body?.first_frame_url) === 'string' || typeof (req.body?.start_image_url) === 'string';
        const hasLast = typeof (req.body?.last_frame_url) === 'string' || typeof (req.body?.last_frame_image_url) === 'string';
        if (!hasFirst || !hasLast) {
            return next(new errorHandler_1.ApiError('first_frame_url and last_frame_url are required (aliases: start_image_url, last_frame_image_url)', 400));
        }
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
// LTX V2 Image-to-Video (Pro)
// LTX V2 I2V (shared)
const validateFalLtx2I2vBase = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('image_url').isString().notEmpty(),
    (0, express_validator_1.body)('resolution').optional().isIn(['1080p', '1440p', '2160p']),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(['auto', '16:9', '9:16']),
    (0, express_validator_1.body)('duration').optional().isIn([6, 8, 10]).withMessage('duration must be 6, 8, or 10'),
    (0, express_validator_1.body)('fps').optional().isIn([25, 50]),
    (0, express_validator_1.body)('generate_audio').optional().isBoolean(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
exports.validateFalLtx2ProI2v = validateFalLtx2I2vBase;
// LTX V2 Image-to-Video (Fast)
exports.validateFalLtx2FastI2v = validateFalLtx2I2vBase;
// Sora 2 Text-to-Video (Standard)
exports.validateFalSora2T2v = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('resolution').optional().isIn(['720p']),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(['16:9', '9:16']),
    (0, express_validator_1.body)('duration').optional().isIn([4, 8, 12]).withMessage('duration must be 4, 8, or 12'),
    (0, express_validator_1.body)('api_key').optional().isString(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
// Sora 2 Text-to-Video (Pro)
exports.validateFalSora2ProT2v = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('resolution').optional().isIn(['720p', '1080p']),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(['16:9', '9:16']),
    (0, express_validator_1.body)('duration').optional().isIn([4, 8, 12]).withMessage('duration must be 4, 8, or 12'),
    (0, express_validator_1.body)('api_key').optional().isString(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
// Sora 2 Video-to-Video Remix
exports.validateFalSora2Remix = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('video_id').optional().isString(),
    (0, express_validator_1.body)('source_history_id').optional().isString(),
    (0, express_validator_1.body)('api_key').optional().isString(),
    (req, _res, next) => {
        const hasVideoId = typeof req.body?.video_id === 'string' && req.body.video_id.length > 0;
        const hasSource = typeof req.body?.source_history_id === 'string' && req.body.source_history_id.length > 0;
        if (!hasVideoId && !hasSource) {
            return next(new errorHandler_1.ApiError('Either video_id or source_history_id is required', 400));
        }
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
// Sora 2 Video-to-Video Remix (by history only)
exports.validateFalSora2RemixByHistory = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('source_history_id').isString().notEmpty(),
    (0, express_validator_1.body)('api_key').optional().isString(),
    (req, _res, next) => {
        if (req.body?.video_id) {
            return next(new errorHandler_1.ApiError('Do not provide video_id on this route; it resolves from source_history_id', 400));
        }
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
// LTX V2 T2V (shared)
const validateFalLtx2T2vBase = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('resolution').optional().isIn(['1080p', '1440p', '2160p']),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(['16:9']).withMessage('Only 16:9 is supported'),
    (0, express_validator_1.body)('duration').optional().isIn([6, 8, 10]).withMessage('duration must be 6, 8, or 10'),
    (0, express_validator_1.body)('fps').optional().isIn([25, 50]),
    (0, express_validator_1.body)('generate_audio').optional().isBoolean(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
exports.validateFalLtx2ProT2v = validateFalLtx2T2vBase;
exports.validateFalLtx2FastT2v = validateFalLtx2T2vBase;
