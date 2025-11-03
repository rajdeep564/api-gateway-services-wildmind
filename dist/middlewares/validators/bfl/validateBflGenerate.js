"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBflDepth = exports.validateBflCanny = exports.validateBflExpand = exports.validateBflFill = exports.validateBflGenerate = exports.ALLOWED_MODELS = void 0;
const express_validator_1 = require("express-validator");
const errorHandler_1 = require("../../../utils/errorHandler");
exports.ALLOWED_MODELS = [
    'flux-kontext-pro',
    'flux-kontext-max',
    'flux-pro-1.1',
    'flux-pro-1.1-ultra',
    'flux-pro',
    'flux-dev'
];
const allowedFrameSizes = [
    '1:1', '3:4', '4:3', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', '16:10', '10:16'
];
exports.validateBflGenerate = [
    (0, express_validator_1.body)('prompt').isString().notEmpty().withMessage('prompt is required'),
    (0, express_validator_1.body)('model').isString().isIn(exports.ALLOWED_MODELS).withMessage('invalid model'),
    (0, express_validator_1.body)('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']).withMessage('invalid generationType'),
    (0, express_validator_1.body)('n').optional().isInt({ min: 1, max: 10 }).withMessage('n must be 1-10'),
    (0, express_validator_1.body)('frameSize').optional().isIn(allowedFrameSizes).withMessage('invalid frameSize'),
    (0, express_validator_1.body)('width').optional().isInt({ min: 16 }).withMessage('width must be a number'),
    (0, express_validator_1.body)('height').optional().isInt({ min: 16 }).withMessage('height must be a number'),
    (0, express_validator_1.body)('output_format').optional().isIn(['jpeg', 'png']).withMessage('invalid output_format'),
    (0, express_validator_1.body)('prompt_upsampling').optional().isBoolean().withMessage('prompt_upsampling must be boolean'),
    (0, express_validator_1.body)('isPublic').optional().isBoolean().withMessage('isPublic must be boolean'),
    (0, express_validator_1.body)('uploadedImages').optional().isArray().withMessage('uploadedImages must be array'),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        }
        next();
    }
];
// Consolidated validators for additional BFL operations
const common = [
    (0, express_validator_1.body)('prompt').optional().isString(),
    (0, express_validator_1.body)('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']).withMessage('invalid generationType'),
    (0, express_validator_1.body)('output_format').optional().isIn(['jpeg', 'png']).withMessage('invalid output_format'),
    (0, express_validator_1.body)('prompt_upsampling').optional().isBoolean(),
    (0, express_validator_1.body)('isPublic').optional().isBoolean(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        }
        next();
    }
];
exports.validateBflFill = [
    (0, express_validator_1.body)('image').isString().notEmpty().withMessage('image is required'),
    (0, express_validator_1.body)('mask').optional().isString(),
    (0, express_validator_1.body)('steps').optional().isInt({ min: 15, max: 50 }),
    (0, express_validator_1.body)('guidance').optional().isFloat({ min: 1.5, max: 100 }),
    (0, express_validator_1.body)('seed').optional().isInt(),
    ...common,
];
exports.validateBflExpand = [
    (0, express_validator_1.body)('image').isString().notEmpty().withMessage('image is required'),
    (0, express_validator_1.body)('top').optional().isInt({ min: 0, max: 2048 }),
    (0, express_validator_1.body)('bottom').optional().isInt({ min: 0, max: 2048 }),
    (0, express_validator_1.body)('left').optional().isInt({ min: 0, max: 2048 }),
    (0, express_validator_1.body)('right').optional().isInt({ min: 0, max: 2048 }),
    (0, express_validator_1.body)('steps').optional().isInt({ min: 15, max: 50 }),
    (0, express_validator_1.body)('guidance').optional().isFloat({ min: 1.5, max: 100 }),
    (0, express_validator_1.body)('seed').optional().isInt(),
    ...common,
];
exports.validateBflCanny = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('control_image').optional().isString(),
    (0, express_validator_1.body)('preprocessed_image').optional().isString(),
    (0, express_validator_1.body)('canny_low_threshold').optional().isInt({ min: 0, max: 500 }),
    (0, express_validator_1.body)('canny_high_threshold').optional().isInt({ min: 0, max: 500 }),
    (0, express_validator_1.body)('steps').optional().isInt({ min: 15, max: 50 }),
    (0, express_validator_1.body)('guidance').optional().isFloat({ min: 1, max: 100 }),
    (0, express_validator_1.body)('seed').optional().isInt(),
    ...common,
];
exports.validateBflDepth = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('control_image').optional().isString(),
    (0, express_validator_1.body)('preprocessed_image').optional().isString(),
    (0, express_validator_1.body)('steps').optional().isInt({ min: 15, max: 50 }),
    (0, express_validator_1.body)('guidance').optional().isFloat({ min: 1, max: 100 }),
    (0, express_validator_1.body)('seed').optional().isInt(),
    ...common,
];
