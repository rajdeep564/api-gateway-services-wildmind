"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWan25T2V = void 0;
const express_validator_1 = require("express-validator");
const errorHandler_1 = require("../../../utils/errorHandler");
// Validator for Replicate model: wan-video/wan-2.5-t2v (supports explicit -fast slug via body.model)
// Required: prompt (string)
// Optional: seed (integer), audio (uri), negative_prompt (string), enable_prompt_expansion (boolean)
// duration enum [5, 10]
// size enum: "832*480"|"480*832"|"1280*720"|"720*1280"|"1920*1080"|"1080*1920"
const allowedSizes = ["832*480", "480*832", "1280*720", "720*1280", "1920*1080", "1080*1920"];
exports.validateWan25T2V = [
    (0, express_validator_1.body)('model').optional().isString(),
    (0, express_validator_1.body)('prompt').isString().withMessage('prompt is required').isLength({ min: 1, max: 2000 }),
    (0, express_validator_1.body)('duration').optional().custom(v => /^(5|10)(s)?$/.test(String(v).trim().toLowerCase())),
    (0, express_validator_1.body)('size').optional().isIn(allowedSizes),
    (0, express_validator_1.body)('seed').optional().isInt(),
    (0, express_validator_1.body)('audio').optional().isString(),
    (0, express_validator_1.body)('negative_prompt').optional().isString(),
    (0, express_validator_1.body)('enable_prompt_expansion').optional().isBoolean(),
    (0, express_validator_1.body)('speed').optional().custom(v => typeof v === 'string' || typeof v === 'boolean'),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        // Defaults and normalization
        // Keep explicit model slug if provided; otherwise default to standard (service/pricing will detect -fast via model or speed)
        if (!req.body.model)
            req.body.model = 'wan-video/wan-2.5-t2v';
        const d = String(req.body.duration ?? '5').toLowerCase();
        const dm = d.match(/(5|10)/);
        req.body.duration = dm ? Number(dm[1]) : 5;
        if (!req.body.size)
            req.body.size = '1280*720';
        const s = String(req.body.size);
        if (s.endsWith('*480') || s.startsWith('480*'))
            req.body.resolution = '480p';
        else if (s.endsWith('*720') || s.startsWith('720*'))
            req.body.resolution = '720p';
        else if (s.endsWith('*1080') || s.startsWith('1080*'))
            req.body.resolution = '1080p';
        if (!req.body.mode && !req.body.kind && !req.body.type)
            req.body.mode = 't2v'; // used by pricing util
        return next();
    }
];
