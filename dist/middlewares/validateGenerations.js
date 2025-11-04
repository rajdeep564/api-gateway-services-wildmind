"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateListGenerations = exports.validateUpdateGenerationStatus = exports.validateCreateGeneration = void 0;
exports.handleValidationErrors = handleValidationErrors;
const express_validator_1 = require("express-validator");
const formatApiResponse_1 = require("../utils/formatApiResponse");
exports.validateCreateGeneration = [
    (0, express_validator_1.body)('prompt').isString().trim().isLength({ min: 1, max: 4000 }),
    (0, express_validator_1.body)('model').isString().trim().isLength({ min: 1, max: 200 }),
    (0, express_validator_1.body)('generationType').isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']),
    (0, express_validator_1.body)('visibility').optional().isIn(['private', 'public', 'unlisted']),
    (0, express_validator_1.body)('tags').optional().isArray({ max: 30 }),
    (0, express_validator_1.body)('tags.*').optional().isString().isLength({ max: 40 }),
    (0, express_validator_1.body)('nsfw').optional().isBoolean(),
];
exports.validateUpdateGenerationStatus = [
    (0, express_validator_1.body)('status').isIn(['completed', 'failed']),
    (0, express_validator_1.oneOf)([
        [
            (0, express_validator_1.body)('status').equals('completed'),
            (0, express_validator_1.body)('images').optional().isArray({ max: 30 }),
            (0, express_validator_1.body)('images.*.id').optional().isString(),
            (0, express_validator_1.body)('images.*.url').optional().isURL(),
            (0, express_validator_1.body)('images.*.storagePath').optional().isString(),
            (0, express_validator_1.body)('images.*.originalUrl').optional().isURL(),
            (0, express_validator_1.body)('videos').optional().isArray({ max: 10 }),
            (0, express_validator_1.body)('videos.*.id').optional().isString(),
            (0, express_validator_1.body)('videos.*.url').optional().isURL(),
            (0, express_validator_1.body)('videos.*.storagePath').optional().isString(),
            (0, express_validator_1.body)('videos.*.thumbUrl').optional().isURL(),
            (0, express_validator_1.body)('isPublicReady').optional().isBoolean(),
            (0, express_validator_1.body)('tags').optional().isArray({ max: 30 }),
            (0, express_validator_1.body)('tags.*').optional().isString().isLength({ max: 40 }),
            (0, express_validator_1.body)('nsfw').optional().isBoolean(),
        ],
        [
            (0, express_validator_1.body)('status').equals('failed'),
            (0, express_validator_1.body)('error').isString().trim().isLength({ min: 1, max: 2000 }),
        ],
    ]),
];
exports.validateListGenerations = [
    (0, express_validator_1.query)('limit').optional().toInt().isInt({ min: 1, max: 100 }),
    (0, express_validator_1.query)('page').optional().toInt().isInt({ min: 1 }),
    (0, express_validator_1.query)('cursor').optional().isString(),
    (0, express_validator_1.query)('status').optional().isIn(['generating', 'completed', 'failed']),
    (0, express_validator_1.query)('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']),
    (0, express_validator_1.query)('sortBy').optional().isIn(['createdAt', 'updatedAt', 'prompt']),
    (0, express_validator_1.query)('sortOrder').optional().isIn(['asc', 'desc']),
    (0, express_validator_1.query)('search').optional().isString().trim().isLength({ max: 200 }),
];
function handleValidationErrors(req, res, next) {
    const result = (0, express_validator_1.validationResult)(req);
    if (!result.isEmpty()) {
        return res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', 'Validation failed', { errors: result.array() }));
    }
    return next();
}
