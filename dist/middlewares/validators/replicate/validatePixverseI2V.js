"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePixverseI2V = void 0;
const express_validator_1 = require("express-validator");
const errorHandler_1 = require("../../../utils/errorHandler");
const allowedQualities = ['360p', '540p', '720p', '1080p', '360', '540', '720', '1080'];
const allowedAspects = ['16:9', '9:16', '1:1'];
exports.validatePixverseI2V = [
    (0, express_validator_1.body)('model').optional().isString(),
    (0, express_validator_1.body)('image').isString().withMessage('image is required').isLength({ min: 5 }),
    (0, express_validator_1.body)('prompt').isString().withMessage('prompt is required').isLength({ min: 1, max: 2000 }),
    (0, express_validator_1.body)('duration').optional().custom(v => /^(5|8)(s)?$/.test(String(v).trim().toLowerCase())),
    (0, express_validator_1.body)('quality').optional().custom(v => allowedQualities.includes(String(v).trim().toLowerCase())),
    (0, express_validator_1.body)('resolution').optional().custom(v => allowedQualities.includes(String(v).trim().toLowerCase())),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(allowedAspects),
    (0, express_validator_1.body)('seed').optional().isInt(),
    (0, express_validator_1.body)('negative_prompt').optional().isString(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        // Defaults and normalization
        if (!req.body.model)
            req.body.model = 'pixverseai/pixverse-v5';
        const d = String(req.body.duration ?? '5').toLowerCase();
        const dm = d.match(/(5|8)/);
        req.body.duration = dm ? Number(dm[1]) : 5;
        // Normalize quality/resolution to 'Xp'
        const rawQ = (req.body.quality ?? req.body.resolution ?? '720p').toString().toLowerCase();
        const qm = rawQ.match(/(360|540|720|1080)/);
        req.body.quality = qm ? `${qm[1]}p` : '720p';
        req.body.resolution = req.body.quality;
        if (!req.body.mode && !req.body.kind && !req.body.type)
            req.body.mode = 'i2v';
        return next();
    }
];
