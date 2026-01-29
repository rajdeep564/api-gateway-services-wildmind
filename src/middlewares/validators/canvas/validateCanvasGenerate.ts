import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

export const validateCanvasGenerate = [
  body('prompt')
    .trim()
    .notEmpty()
    .withMessage('Prompt is required')
    .isLength({ min: 1, max: 5000 })
    .withMessage('Prompt must be between 1 and 5000 characters'),

  body('model')
    .trim()
    .notEmpty()
    .withMessage('Model is required')
    .isString()
    .withMessage('Model must be a string'),

  body('width')
    .optional()
    .isInt({ min: 64, max: 4096 })
    .withMessage('Width must be between 64 and 4096'),

  body('height')
    .optional()
    .isInt({ min: 64, max: 4096 })
    .withMessage('Height must be between 64 and 4096'),

  body('aspectRatio')
    .optional()
    .isString()
    .matches(/^\d+:\d+$/)
    .withMessage('Aspect ratio must be in format "width:height" (e.g., "16:9")'),

  body('seed')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Seed must be a non-negative integer'),

  body('options')
    .optional()
    .isObject()
    .withMessage('Options must be an object'),

  body('meta')
    .notEmpty()
    .withMessage('Meta is required')
    .isObject()
    .withMessage('Meta must be an object'),

  body('meta.source')
    .equals('canvas')
    .withMessage('meta.source must be "canvas"'),

  body('meta.projectId')
    .trim()
    .notEmpty()
    .withMessage('meta.projectId is required')
    .isString()
    .withMessage('meta.projectId must be a string'),

  body('meta.elementId')
    .optional()
    .isString()
    .withMessage('meta.elementId must be a string'),

  body('imageCount')
    .optional()
    .isInt({ min: 1, max: 4 })
    .withMessage('Image count must be between 1 and 4'),

  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ApiError('Validation failed', 422, errors.array()));
    }

    next();
  },
];

