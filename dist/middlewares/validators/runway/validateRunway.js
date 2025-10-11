"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRunwayVideoUpscale = exports.validateRunwayVideoToVideo = exports.validateRunwayTextToVideo = exports.validateRunwayImageToVideo = exports.validateRunwayTextToImage = exports.validateRunwayStatus = void 0;
const express_validator_1 = require("express-validator");
const errorHandler_1 = require("../../../utils/errorHandler");
const runValidation = (req, _res, next) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty())
        return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
    next();
};
exports.validateRunwayStatus = [
    (0, express_validator_1.param)('id').isString().notEmpty(),
    runValidation
];
// Text to image
const TTI_RATIOS = new Set([
    '1920:1080', '1080:1920', '1024:1024', '1360:768', '1080:1080', '1168:880',
    '1440:1080', '1080:1440', '1808:768', '2112:912', '1280:720', '720:1280',
    '720:720', '960:720', '720:960', '1680:720', '1344:768', '768:1344', '1184:864',
    '864:1184', '1536:672'
]);
exports.validateRunwayTextToImage = [
    (0, express_validator_1.body)('promptText').isString().isLength({ min: 1, max: 1000 }),
    (0, express_validator_1.body)('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']).withMessage('invalid generationType'),
    (0, express_validator_1.body)('ratio').isString().custom(v => TTI_RATIOS.has(v)),
    (0, express_validator_1.body)('model').isString().isIn(['gen4_image_turbo', 'gen4_image', 'gemini_2.5_flash']),
    (0, express_validator_1.body)('seed').optional().isInt({ min: 0, max: 4294967295 }),
    (0, express_validator_1.body)('referenceImages').optional().isArray({ max: 3 }),
    (0, express_validator_1.body)('referenceImages.*.uri').optional().isString(),
    runValidation
];
// Image to video (promptImage can be string or array of {uri, position})
const I2V_RATIOS_GEN4_TURBO = new Set(['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672']);
const I2V_RATIOS_GEN3A_TURBO = new Set(['1280:768', '768:1280']);
const I2V_RATIOS_VEO3 = new Set(['1280:720', '720:1280']);
exports.validateRunwayImageToVideo = [
    (0, express_validator_1.body)('model').isString().isIn(['gen4_turbo', 'gen3a_turbo', 'veo3']),
    (0, express_validator_1.body)('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']).withMessage('invalid generationType'),
    (0, express_validator_1.body)('ratio').isString().custom((v, { req }) => {
        const m = req.body.model;
        if (m === 'gen4_turbo')
            return I2V_RATIOS_GEN4_TURBO.has(v);
        if (m === 'gen3a_turbo')
            return I2V_RATIOS_GEN3A_TURBO.has(v);
        if (m === 'veo3')
            return I2V_RATIOS_VEO3.has(v);
        return false;
    }),
    (0, express_validator_1.body)('duration').optional().isInt({ min: 5, max: 10 }).custom((v, { req }) => {
        const m = req.body.model;
        if (m === 'veo3')
            return Number(v) === 8;
        // gen4_turbo, gen3a_turbo must be 5 or 10
        return v === 5 || v === 10;
    }),
    (0, express_validator_1.body)('promptText').optional().isString().isLength({ max: 1000 }),
    (0, express_validator_1.body)('seed').optional().isInt({ min: 0, max: 4294967295 }),
    (0, express_validator_1.body)('contentModeration').optional().isObject(),
    (0, express_validator_1.body)('contentModeration.publicFigureThreshold').optional().isIn(['auto', 'low']),
    (0, express_validator_1.body)('promptImage').custom(value => {
        // string or array of {uri, position}
        if (typeof value === 'string')
            return value.startsWith('http') || value.startsWith('data:');
        if (Array.isArray(value)) {
            return value.every((p) => typeof p.uri === 'string' && (p.position === 'first' || p.position === 'last'));
        }
        return false;
    }),
    runValidation
];
// Text to video (veo3 only)
exports.validateRunwayTextToVideo = [
    (0, express_validator_1.body)('model').equals('veo3'),
    (0, express_validator_1.body)('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']).withMessage('invalid generationType'),
    (0, express_validator_1.body)('promptText').isString().isLength({ min: 1, max: 1000 }),
    (0, express_validator_1.body)('ratio').isIn(['1280:720', '720:1280']),
    (0, express_validator_1.body)('duration').equals('8').toInt(),
    (0, express_validator_1.body)('seed').optional().isInt({ min: 0, max: 4294967295 }),
    runValidation
];
// Video to video
const V2V_RATIOS = new Set(['1280:720', '720:1280', '1104:832', '960:960', '832:1104', '1584:672', '848:480', '640:480']);
exports.validateRunwayVideoToVideo = [
    (0, express_validator_1.body)('model').equals('gen4_aleph'),
    (0, express_validator_1.body)('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']).withMessage('invalid generationType'),
    (0, express_validator_1.body)('videoUri').isString().notEmpty(),
    (0, express_validator_1.body)('promptText').isString().isLength({ min: 1, max: 1000 }),
    (0, express_validator_1.body)('ratio').isString().custom(v => V2V_RATIOS.has(v)),
    (0, express_validator_1.body)('references').optional().isArray(),
    (0, express_validator_1.body)('references.*.type').optional().equals('image'),
    (0, express_validator_1.body)('references.*.uri').optional().isString(),
    (0, express_validator_1.body)('seed').optional().isInt({ min: 0, max: 4294967295 }),
    (0, express_validator_1.body)('contentModeration').optional().isObject(),
    (0, express_validator_1.body)('contentModeration.publicFigureThreshold').optional().isIn(['auto', 'low']),
    runValidation
];
// Video upscale
exports.validateRunwayVideoUpscale = [
    (0, express_validator_1.body)('model').equals('upscale_v1'),
    (0, express_validator_1.body)('videoUri').isString().notEmpty(),
    runValidation
];
