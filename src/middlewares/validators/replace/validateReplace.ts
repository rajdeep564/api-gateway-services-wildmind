import { body, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';

export const validateReplace = [
  body('input_image').isString().notEmpty().withMessage('input_image is required'),
  body('masked_image').isString().notEmpty().withMessage('masked_image is required'),
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('model').isIn(['google_nano_banana', 'seedream_4']).withMessage('model must be google_nano_banana or seedream_4'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];

