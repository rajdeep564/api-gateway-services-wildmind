"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateFalVeoImageToVideoFastSubmit = exports.validateFalVeoImageToVideoSubmit = exports.validateFalVeoTextToVideoFastSubmit = exports.validateFalVeoTextToVideoSubmit = exports.validateFalQueueResult = exports.validateFalQueueStatus = exports.validateFalVeoImageToVideoFast = exports.validateFalVeoImageToVideo = exports.validateFalVeoTextToVideoFast = exports.validateFalVeoTextToVideo = exports.validateFalGenerate = exports.ALLOWED_FAL_MODELS = void 0;
const express_validator_1 = require("express-validator");
const errorHandler_1 = require("../../../utils/errorHandler");
exports.ALLOWED_FAL_MODELS = [
    'gemini-25-flash-image',
    'seedream-v4'
];
exports.validateFalGenerate = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']).withMessage('invalid generationType'),
    (0, express_validator_1.body)('model').isString().isIn(exports.ALLOWED_FAL_MODELS),
    (0, express_validator_1.body)('n').optional().isInt({ min: 1, max: 10 }),
    (0, express_validator_1.body)('uploadedImages').optional().isArray(),
    (0, express_validator_1.body)('output_format').optional().isIn(['jpeg', 'png', 'webp']),
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
