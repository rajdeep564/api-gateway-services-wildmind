import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

export const ALLOWED_FAL_MODELS = [
  'gemini-25-flash-image',
  'seedream-v4',
  // Imagen 4 image generation variants (frontend model keys)
  'imagen-4-ultra',
  'imagen-4',
  'imagen-4-fast'
];

export const validateFalGenerate = [
  body('prompt').isString().notEmpty(),
  body('generationType').optional().isIn(['text-to-image','logo','sticker-generation','text-to-video','text-to-music','mockup-generation','product-generation','ad-generation','live-chat']).withMessage('invalid generationType'),
  body('model').isString().isIn(ALLOWED_FAL_MODELS),
  body('aspect_ratio').optional().isIn(['1:1','16:9','9:16','3:4','4:3']),
  body('n').optional().isInt({ min: 1, max: 10 }),
  body('num_images').optional().isInt({ min: 1, max: 4 }),
  body('uploadedImages').optional().isArray(),
  body('output_format').optional().isIn(['jpeg', 'png', 'webp']),
  body('resolution').optional().isIn(['1K','2K']),
  body('seed').optional().isInt(),
  body('negative_prompt').optional().isString(),
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

// Veo 3.1 First/Last Frame to Video (Fast)
export const validateFalVeo31FirstLastFast = [    
  body('prompt').isString().notEmpty(),
  // Accept either our previous naming or FAL's canonical keys
  body('start_image_url').optional().isString(),
  body('last_frame_image_url').optional().isString(),
  body('first_frame_url').optional().isString(),
  body('last_frame_url').optional().isString(),
  body('aspect_ratio').optional().isIn(['16:9', '9:16', '1:1','auto']),
  body('duration').optional().isIn(['8s']),
  body('generate_audio').optional().isBoolean(),
  body('resolution').optional().isIn(['720p', '1080p']),
  (req: Request, _res: Response, next: NextFunction) => {
    // Ensure at least one pair of first/last is provided
    const hasStart = typeof (req.body?.start_image_url) === 'string' || typeof (req.body?.first_frame_url) === 'string';
    const hasLast = typeof (req.body?.last_frame_image_url) === 'string' || typeof (req.body?.last_frame_url) === 'string';
    if (!hasStart || !hasLast) {
      return next(new ApiError('first/last frame URLs are required (use first_frame_url/last_frame_url or start_image_url/last_frame_image_url)', 400));
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Veo 3.1 Reference-to-Video (Standard)
export const validateFalVeo31ReferenceToVideo = [
  body('prompt').isString().notEmpty(),
  body('image_urls').isArray({ min: 1 }).withMessage('image_urls must be a non-empty array of URLs'),
  body('image_urls.*').isString().notEmpty(),
  body('duration').optional().isIn(['8s']),
  body('resolution').optional().isIn(['720p', '1080p']),
  body('generate_audio').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Sora 2 Image-to-Video (Standard)
export const validateFalSora2I2v = [
  body('prompt').isString().notEmpty(),
  body('image_url').isString().notEmpty(),
  body('resolution').optional().isIn(['auto','720p']),
  body('aspect_ratio').optional().isIn(['auto','16:9','9:16']),
  body('duration').optional().isIn([4,8,12]).withMessage('duration must be 4, 8, or 12'),
  body('api_key').optional().isString(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Sora 2 Image-to-Video (Pro)
export const validateFalSora2ProI2v = [
  body('prompt').isString().notEmpty(),
  body('image_url').isString().notEmpty(),
  body('resolution').optional().isIn(['auto','720p','1080p']),
  body('aspect_ratio').optional().isIn(['auto','16:9','9:16']),
  body('duration').optional().isIn([4,8,12]).withMessage('duration must be 4, 8, or 12'),
  body('api_key').optional().isString(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Veo 3.1 First/Last Frame to Video (Standard)
export const validateFalVeo31FirstLast = [
  body('prompt').isString().notEmpty(),
  body('first_frame_url').optional().isString(),
  body('last_frame_url').optional().isString(),
  // Support alias keys as well for flexibility
  body('start_image_url').optional().isString(),
  body('last_frame_image_url').optional().isString(),
  body('aspect_ratio').optional().isIn(['auto','16:9', '9:16', '1:1']),
  body('duration').optional().isIn(['8s']),
  body('generate_audio').optional().isBoolean(),
  body('resolution').optional().isIn(['720p', '1080p']),
  (req: Request, _res: Response, next: NextFunction) => {
    const hasFirst = typeof (req.body?.first_frame_url) === 'string' || typeof (req.body?.start_image_url) === 'string';
    const hasLast = typeof (req.body?.last_frame_url) === 'string' || typeof (req.body?.last_frame_image_url) === 'string';
    if (!hasFirst || !hasLast) {
      return next(new ApiError('first_frame_url and last_frame_url are required (aliases: start_image_url, last_frame_image_url)', 400));
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// LTX V2 Image-to-Video (Pro)
// LTX V2 I2V (shared)
const validateFalLtx2I2vBase = [
  body('prompt').isString().notEmpty(),
  body('image_url').isString().notEmpty(),
  body('resolution').optional().isIn(['1080p','1440p','2160p']),
  body('aspect_ratio').optional().isIn(['auto','16:9','9:16']),
  body('duration').optional().isIn([6,8,10]).withMessage('duration must be 6, 8, or 10'),
  body('fps').optional().isIn([25,50]),
  body('generate_audio').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];
export const validateFalLtx2ProI2v = validateFalLtx2I2vBase;

// LTX V2 Image-to-Video (Fast)
export const validateFalLtx2FastI2v = validateFalLtx2I2vBase;

// Sora 2 Text-to-Video (Standard)
export const validateFalSora2T2v = [
  body('prompt').isString().notEmpty(),
  body('resolution').optional().isIn(['720p']),
  body('aspect_ratio').optional().isIn(['16:9','9:16']),
  body('duration').optional().isIn([4,8,12]).withMessage('duration must be 4, 8, or 12'),
  body('api_key').optional().isString(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Sora 2 Text-to-Video (Pro)
export const validateFalSora2ProT2v = [
  body('prompt').isString().notEmpty(),
  body('resolution').optional().isIn(['720p','1080p']),
  body('aspect_ratio').optional().isIn(['16:9','9:16']),
  body('duration').optional().isIn([4,8,12]).withMessage('duration must be 4, 8, or 12'),
  body('api_key').optional().isString(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Sora 2 Video-to-Video Remix
export const validateFalSora2Remix = [
  body('prompt').isString().notEmpty(),
  body('video_id').optional().isString(),
  body('source_history_id').optional().isString(),
  body('api_key').optional().isString(),
  (req: Request, _res: Response, next: NextFunction) => {
    const hasVideoId = typeof req.body?.video_id === 'string' && req.body.video_id.length > 0;
    const hasSource = typeof req.body?.source_history_id === 'string' && req.body.source_history_id.length > 0;
    if (!hasVideoId && !hasSource) {
      return next(new ApiError('Either video_id or source_history_id is required', 400));
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Sora 2 Video-to-Video Remix (by history only)
export const validateFalSora2RemixByHistory = [
  body('prompt').isString().notEmpty(),
  body('source_history_id').isString().notEmpty(),
  body('api_key').optional().isString(),
  (req: Request, _res: Response, next: NextFunction) => {
    if (req.body?.video_id) {
      return next(new ApiError('Do not provide video_id on this route; it resolves from source_history_id', 400));
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// LTX V2 T2V (shared)
const validateFalLtx2T2vBase = [
  body('prompt').isString().notEmpty(),
  body('resolution').optional().isIn(['1080p','1440p','2160p']),
  body('aspect_ratio').optional().isIn(['16:9']).withMessage('Only 16:9 is supported'),
  body('duration').optional().isIn([6,8,10]).withMessage('duration must be 6, 8, or 10'),
  body('fps').optional().isIn([25,50]),
  body('generate_audio').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];
export const validateFalLtx2ProT2v = validateFalLtx2T2vBase;
export const validateFalLtx2FastT2v = validateFalLtx2T2vBase;


