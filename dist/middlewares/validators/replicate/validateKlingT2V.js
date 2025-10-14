"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateKlingT2V = void 0;
const express_validator_1 = require("express-validator");
const errorHandler_1 = require("../../../utils/errorHandler");
// Covers:
// - kwaivgi/kling-v2.5-turbo-pro (t2v)
// - kwaivgi/kling-v2.1-master (t2v)
// - kwaivgi/kling-v2.1 (t2v standard/pro via mode)
const allowedAspect = ['16:9', '9:16', '1:1'];
exports.validateKlingT2V = [
    (0, express_validator_1.body)('model').optional().isString(),
    (0, express_validator_1.body)('prompt').isString().withMessage('prompt is required').isLength({ min: 1, max: 2000 }),
    (0, express_validator_1.body)('duration').optional().custom(v => /^(5|10)(s)?$/.test(String(v).trim().toLowerCase())),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(allowedAspect),
    (0, express_validator_1.body)('guidance_scale').optional().isFloat({ min: 0, max: 1 }),
    (0, express_validator_1.body)('negative_prompt').optional().isString(),
    (0, express_validator_1.body)('mode').optional().isIn(['standard', 'pro']), // provider mode for v2.1 determining 720p/1080p
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        // Defaults and normalization
        if (!req.body.model)
            req.body.model = 'kwaivgi/kling-v2.5-turbo-pro';
        const d = String(req.body.duration ?? '5').toLowerCase();
        const dm = d.match(/(5|10)/);
        req.body.duration = dm ? Number(dm[1]) : 5;
        // Set pricing kind for util without clobbering provider 'mode'
        if (!req.body.kind && !req.body.type)
            req.body.kind = 't2v';
        return next();
    }
];
