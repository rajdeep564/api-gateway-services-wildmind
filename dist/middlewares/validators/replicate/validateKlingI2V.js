"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateKlingI2V = void 0;
const express_validator_1 = require("express-validator");
const errorHandler_1 = require("../../../utils/errorHandler");
// Supports:
// - kwaivgi/kling-v2.5-turbo-pro with image (i2v)
// - kwaivgi/kling-v2.1-master with optional start_image
// - kwaivgi/kling-v2.1 requires start_image, optional end_image, mode standard/pro
const allowedAspect = ['16:9', '9:16', '1:1'];
exports.validateKlingI2V = [
    (0, express_validator_1.body)('model').optional().isString(),
    // Accept either 'image' or 'start_image'
    (0, express_validator_1.body)('image').optional().isString(),
    (0, express_validator_1.body)('start_image').optional().isString(),
    (0, express_validator_1.body)('end_image').optional().isString(),
    (0, express_validator_1.body)('prompt').isString().withMessage('prompt is required').isLength({ min: 1, max: 2000 }),
    (0, express_validator_1.body)('duration').optional().custom(v => /^(5|10)(s)?$/.test(String(v).trim().toLowerCase())),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(allowedAspect),
    (0, express_validator_1.body)('guidance_scale').optional().isFloat({ min: 0, max: 1 }),
    (0, express_validator_1.body)('negative_prompt').optional().isString(),
    (0, express_validator_1.body)('mode').optional().isIn(['standard', 'pro']),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        // At least one image input required for I2V
        if (!req.body.image && !req.body.start_image) {
            return next(new errorHandler_1.ApiError('image or start_image is required for Kling I2V', 400));
        }
        if (!req.body.model) {
            // Default to v2.1 (requires start_image) if start_image provided, else 2.5 turbo with generic image
            req.body.model = req.body.start_image ? 'kwaivgi/kling-v2.1' : 'kwaivgi/kling-v2.5-turbo-pro';
        }
        const d = String(req.body.duration ?? '5').toLowerCase();
        const dm = d.match(/(5|10)/);
        req.body.duration = dm ? Number(dm[1]) : 5;
        if (!req.body.kind && !req.body.type)
            req.body.kind = 'i2v';
        return next();
    }
];
