"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMinimaxFileQuery = exports.validateMinimaxStatusQuery = exports.validateMinimaxVideoGenerate = void 0;
const express_validator_1 = require("express-validator");
const errorHandler_1 = require("../../../utils/errorHandler");
const ALLOWED_VIDEO_MODELS = [
    'MiniMax-Hailuo-2.3',
    'MiniMax-Hailuo-2.3-Fast',
    'MiniMax-Hailuo-02',
    'T2V-01-Director',
    'T2V-01',
    'I2V-01-Director',
    'I2V-01-live',
    'I2V-01',
    'S2V-01'
];
exports.validateMinimaxVideoGenerate = [
    (0, express_validator_1.body)('model').isString().isIn(ALLOWED_VIDEO_MODELS),
    (0, express_validator_1.body)('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'image-to-video', 'video-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']).withMessage('invalid generationType'),
    (0, express_validator_1.body)('isPublic').optional().isBoolean().withMessage('isPublic must be boolean'),
    (0, express_validator_1.body)('prompt').optional().isString().isLength({ max: 2000 }),
    (0, express_validator_1.body)('prompt_optimizer').optional().isBoolean(),
    (0, express_validator_1.body)('fast_pretreatment').optional().isBoolean(),
    (0, express_validator_1.body)('duration').optional().isInt({ min: 1, max: 10 }),
    (0, express_validator_1.body)('resolution').optional().isIn(['512P', '720P', '768P', '1080P']),
    (0, express_validator_1.body)('first_frame_image').optional().isString(),
    (0, express_validator_1.body)('last_frame_image').optional().isString(),
    (0, express_validator_1.body)('aigc_watermark').optional().isBoolean(),
    (0, express_validator_1.body)('subject_reference').optional().isArray({ min: 1, max: 1 }),
    (0, express_validator_1.body)('subject_reference.*.type').optional().equals('character'),
    (0, express_validator_1.body)('subject_reference.*.image').optional().isArray({ min: 1, max: 1 }),
    (0, express_validator_1.body)('subject_reference.*.image.*').optional().isString(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        const { model, resolution, duration, first_frame_image, subject_reference } = req.body || {};
        // Conditional requirements per docs
        // I2V models require first_frame_image. Hailuo-02 requires it when resolution is 512P.
        const isI2V = ['I2V-01', 'I2V-01-Director', 'I2V-01-live', 'MiniMax-Hailuo-2.3-Fast'].includes(model);
        if (isI2V && !first_frame_image) {
            return next(new errorHandler_1.ApiError('first_frame_image is required for I2V models', 400));
        }
        if (model === 'MiniMax-Hailuo-02' && resolution === '512P' && !first_frame_image) {
            return next(new errorHandler_1.ApiError('first_frame_image is required for MiniMax-Hailuo-02 at 512P', 400));
        }
        // S2V-01 requires subject_reference with one character image
        if (model === 'S2V-01') {
            if (!Array.isArray(subject_reference) || subject_reference.length !== 1) {
                return next(new errorHandler_1.ApiError('subject_reference must be an array with exactly 1 element for S2V-01', 400));
            }
            const ref = subject_reference[0];
            if (ref.type !== 'character' || !Array.isArray(ref.image) || ref.image.length !== 1 || typeof ref.image[0] !== 'string') {
                return next(new errorHandler_1.ApiError('subject_reference must contain one character image for S2V-01', 400));
            }
        }
        // Duration & resolution constraints (basic checks per docs)
        if (model === 'MiniMax-Hailuo-02') {
            if (duration && ![6, 10].includes(Number(duration))) {
                return next(new errorHandler_1.ApiError('duration must be 6 or 10 for MiniMax-Hailuo-02', 400));
            }
            if (resolution && !['512P', '768P', '1080P'].includes(resolution)) {
                return next(new errorHandler_1.ApiError('resolution must be 512P, 768P, or 1080P for MiniMax-Hailuo-02', 400));
            }
            if (Number(duration) === 10 && resolution === '1080P') {
                return next(new errorHandler_1.ApiError('1080P supports only 6s for MiniMax-Hailuo-02', 400));
            }
        }
        else if (model === 'MiniMax-Hailuo-2.3' || model === 'MiniMax-Hailuo-2.3-Fast') {
            // Per docs for 2.3: 6s supports 768P (default) and 1080P; 10s supports 768P only
            if (duration && ![6, 10].includes(Number(duration))) {
                return next(new errorHandler_1.ApiError('duration must be 6 or 10 for MiniMax-Hailuo-2.3 models', 400));
            }
            if (resolution && !['768P', '1080P'].includes(resolution)) {
                return next(new errorHandler_1.ApiError('resolution must be 768P or 1080P for MiniMax-Hailuo-2.3 models', 400));
            }
            if (Number(duration) === 10 && resolution === '1080P') {
                return next(new errorHandler_1.ApiError('1080P supports only 6s for MiniMax-Hailuo-2.3 models', 400));
            }
        }
        else {
            if (resolution && resolution !== '720P') {
                return next(new errorHandler_1.ApiError('resolution must be 720P for non-Hailuo-02 models', 400));
            }
            if (duration && Number(duration) !== 6) {
                return next(new errorHandler_1.ApiError('duration must be 6s for non-Hailuo-02 models', 400));
            }
        }
        return next();
    }
];
exports.validateMinimaxStatusQuery = [
    (req, _res, next) => {
        const taskId = String(req.query.task_id || '');
        if (!taskId)
            return next(new errorHandler_1.ApiError('Task ID is required', 400));
        next();
    }
];
exports.validateMinimaxFileQuery = [
    (req, _res, next) => {
        const fileId = String(req.query.file_id || '');
        if (!fileId)
            return next(new errorHandler_1.ApiError('File ID is required', 400));
        next();
    }
];
