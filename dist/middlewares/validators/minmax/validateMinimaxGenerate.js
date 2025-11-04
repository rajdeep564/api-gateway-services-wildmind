"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMinimaxGenerate = void 0;
const express_validator_1 = require("express-validator");
const errorHandler_1 = require("../../../utils/errorHandler");
const validAspectRatios = ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'];
exports.validateMinimaxGenerate = [
    (0, express_validator_1.body)('prompt').isString().notEmpty(),
    (0, express_validator_1.body)('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat']).withMessage('invalid generationType'),
    (0, express_validator_1.body)('n').optional().isInt({ min: 1, max: 9 }),
    (0, express_validator_1.body)('aspect_ratio').optional().isIn(validAspectRatios),
    (0, express_validator_1.body)('width').optional().isInt({ min: 512, max: 2048 }),
    (0, express_validator_1.body)('height').optional().isInt({ min: 512, max: 2048 }),
    (0, express_validator_1.body)().custom((value) => {
        const { width, height } = value;
        if ((width !== undefined || height !== undefined) && !(width !== undefined && height !== undefined)) {
            throw new Error('Both width and height must be provided together');
        }
        if (width !== undefined && height !== undefined) {
            if (width % 8 !== 0 || height % 8 !== 0)
                throw new Error('Width and height must be multiples of 8');
        }
        return true;
    }),
    (0, express_validator_1.body)('subject_reference').optional().isArray({ min: 1, max: 1 }),
    (0, express_validator_1.body)('subject_reference.*.type').optional().equals('character'),
    (0, express_validator_1.body)('subject_reference.*.image_file').optional().isString().notEmpty(),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty())
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        next();
    }
];
