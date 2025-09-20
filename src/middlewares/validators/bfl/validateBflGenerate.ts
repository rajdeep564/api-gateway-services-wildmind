import { Request, Response, NextFunction } from 'express';
import { validationResult, body } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';
import { FrameSize } from '../../../types/bfl';

export const ALLOWED_MODELS = [
  'flux-kontext-pro',
  'flux-kontext-max',
  'flux-pro-1.1',
  'flux-pro-1.1-ultra',
  'flux-pro',
  'flux-dev'
];

const allowedFrameSizes: FrameSize[] = [
  '1:1', '3:4', '4:3', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', '16:10', '10:16'
];

export const validateBflGenerate = [
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('model').isString().isIn(ALLOWED_MODELS).withMessage('invalid model'),
  body('n').optional().isInt({ min: 1, max: 10 }).withMessage('n must be 1-10'),
  body('frameSize').optional().isIn(allowedFrameSizes).withMessage('invalid frameSize'),
  body('width').optional().isInt({ min: 16 }).withMessage('width must be a number'),
  body('height').optional().isInt({ min: 16 }).withMessage('height must be a number'),
  body('uploadedImages').optional().isArray().withMessage('uploadedImages must be array'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];


