import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

export const ALLOWED_FAL_MODELS = [
  'gemini-25-flash-image'
];

export const validateFalGenerate = [
  body('prompt').isString().notEmpty(),
  body('model').isString().isIn(ALLOWED_FAL_MODELS),
  body('n').optional().isInt({ min: 1, max: 10 }),
  body('uploadedImages').optional().isArray(),
  body('output_format').optional().isIn(['jpeg', 'png', 'webp']),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];


