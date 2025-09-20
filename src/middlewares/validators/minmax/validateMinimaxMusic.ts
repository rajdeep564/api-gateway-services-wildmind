import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

export const validateMinimaxMusic = [
  body('prompt').isString().isLength({ min: 10, max: 300 }),
  body('lyrics').isString().isLength({ min: 10, max: 600 }),
  body('output_format').optional().isIn(['hex', 'url', 'b64_json']),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];


