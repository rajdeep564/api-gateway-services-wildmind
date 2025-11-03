"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateGenerationId = exports.validatePublicListGenerations = void 0;
exports.handleValidationErrors = handleValidationErrors;
const express_validator_1 = require("express-validator");
const formatApiResponse_1 = require("../utils/formatApiResponse");
exports.validatePublicListGenerations = [
    // limit can be an integer >=1 or the string 'all'
    (0, express_validator_1.query)('limit').optional().customSanitizer(v => (String(v).toLowerCase() === 'all' ? 'all' : v)).custom(v => {
        if (v === 'all')
            return true;
        const n = parseInt(v, 10);
        return Number.isFinite(n) && n >= 1;
    }).withMessage('limit must be a positive integer or "all"'),
    (0, express_validator_1.query)('page').optional().toInt().isInt({ min: 1 }),
    (0, express_validator_1.query)('cursor').optional().isString(),
    (0, express_validator_1.query)('generationType').optional().isIn([
        'text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music',
        'mockup-generation', 'product-generation', 'ad-generation', 'live-chat'
    ]),
    (0, express_validator_1.query)('status').optional().isIn(['generating', 'completed', 'failed']),
    (0, express_validator_1.query)('sortBy').optional().isIn(['createdAt', 'updatedAt', 'prompt']),
    (0, express_validator_1.query)('sortOrder').optional().isIn(['asc', 'desc']),
    (0, express_validator_1.query)('createdBy').optional().isString(),
    (0, express_validator_1.query)('mode').optional().isIn(['video', 'image', 'music', 'all']),
    (0, express_validator_1.query)('dateStart').optional().isISO8601(),
    (0, express_validator_1.query)('dateEnd').optional().isISO8601(),
];
exports.validateGenerationId = [
    (0, express_validator_1.param)('generationId').isString().notEmpty(),
];
function handleValidationErrors(req, res, next) {
    const result = (0, express_validator_1.validationResult)(req);
    if (!result.isEmpty()) {
        return res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', 'Validation failed', { errors: result.array() }));
    }
    return next();
}
