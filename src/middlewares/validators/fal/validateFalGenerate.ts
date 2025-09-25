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

// Veo3 Text-to-Video (standard and fast)
export const validateFalVeoTextToVideo = [
  body('prompt').isString().notEmpty(),
  body('aspect_ratio').optional().isIn(['16:9', '9:16', '1:1']),
  body('duration').optional().isIn(['4s', '6s', '8s']),
  body('negative_prompt').optional().isString(),
  body('enhance_prompt').optional().isBoolean(),
  body('seed').optional().isInt(),
  body('auto_fix').optional().isBoolean(),
  body('resolution').optional().isIn(['720p', '1080p']),
  body('generate_audio').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

export const validateFalVeoTextToVideoFast = validateFalVeoTextToVideo;

// Veo3 Image-to-Video (standard and fast)
export const validateFalVeoImageToVideo = [
  body('prompt').isString().notEmpty(),
  body('image_url').isString().notEmpty(),
  body('aspect_ratio').optional().isIn(['auto', '16:9', '9:16']),
  body('duration').optional().isIn(['8s']),
  body('generate_audio').optional().isBoolean(),
  body('resolution').optional().isIn(['720p', '1080p']),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

export const validateFalVeoImageToVideoFast = validateFalVeoImageToVideo;

// Queue validators
export const validateFalQueueStatus = [
  body('requestId').optional().isString(), // in case of POST body
  (req: Request, _res: Response, next: NextFunction) => {
    const requestId = (req.query.requestId as string) || (req.body?.requestId as string);
    if (!requestId) return next(new ApiError('requestId is required', 400));
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

export const validateFalQueueResult = validateFalQueueStatus;

export const validateFalVeoTextToVideoSubmit = validateFalVeoTextToVideo;
export const validateFalVeoTextToVideoFastSubmit = validateFalVeoTextToVideoFast;
export const validateFalVeoImageToVideoSubmit = validateFalVeoImageToVideo;
export const validateFalVeoImageToVideoFastSubmit = validateFalVeoImageToVideoFast;

// NanoBanana uses unified generate/queue; no separate validators


