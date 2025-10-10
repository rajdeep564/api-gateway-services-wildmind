"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMinimaxMusic = void 0;
const express_validator_1 = require("express-validator");
const errorHandler_1 = require("../../../utils/errorHandler");
exports.validateMinimaxMusic = [
    (0, express_validator_1.body)('model').isString().equals('music-1.5'),
    (0, express_validator_1.body)('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']).withMessage('invalid generationType'),
    (0, express_validator_1.body)('prompt').isString().isLength({ min: 10, max: 300 }),
    (0, express_validator_1.body)('lyrics').isString().isLength({ min: 10, max: 3000 }),
    (0, express_validator_1.body)('stream').optional().isBoolean(),
    (0, express_validator_1.body)('output_format').optional().isIn(['hex', 'url']),
    (0, express_validator_1.body)('audio_setting').optional().isObject(),
    (0, express_validator_1.body)('audio_setting.sample_rate').optional().isIn([16000, 24000, 32000, 44100]),
    (0, express_validator_1.body)('audio_setting.bitrate').optional().isIn([32000, 64000, 128000, 256000]),
    (0, express_validator_1.body)('audio_setting.format').optional().isIn(['mp3', 'wav', 'pcm']),
    (0, express_validator_1.body)('aigc_watermark').optional().isBoolean(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
