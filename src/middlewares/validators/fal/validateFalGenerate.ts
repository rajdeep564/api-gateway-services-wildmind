import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';
import { probeVideoMeta } from '../../../utils/media/probe';
import { probeImageMeta } from '../../../utils/media/imageProbe';
import { uploadDataUriToZata } from '../../../utils/storage/zataUpload';

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
  body('generationType').optional().isIn(['text-to-image','logo','sticker-generation','text-to-video','text-to-music','mockup-generation','product-generation','ad-generation','live-chat','text-to-character']).withMessage('invalid generationType'),
  body('model').isString().isIn(ALLOWED_FAL_MODELS),
  body('aspect_ratio').optional().isIn(['1:1','16:9','9:16','3:4','4:3']),
  body('n').optional().isInt({ min: 1, max: 10 }),
  body('num_images').optional().isInt({ min: 1, max: 10 }),
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
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('image_url').isString().notEmpty().withMessage('image_url is required'),
  body('resolution').optional({ nullable: true, checkFalsy: false }).isIn(['auto','720p']).withMessage('resolution must be auto or 720p'),
  body('aspect_ratio').optional({ nullable: true, checkFalsy: false }).isIn(['auto','16:9','9:16']).withMessage('aspect_ratio must be auto, 16:9, or 9:16'),
  body('duration').optional({ nullable: true, checkFalsy: false }).custom((value) => {
    // Accept both number and string, but validate the value
    const numValue = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (isNaN(numValue)) return false;
    return [4, 8, 12].includes(numValue);
  }).withMessage('duration must be 4, 8, or 12'),
  body('api_key').optional({ nullable: true, checkFalsy: false }).isString(),
  body('originalPrompt').optional({ nullable: true, checkFalsy: false }).isString(), // Allow for history display
  body('isPublic').optional({ nullable: true, checkFalsy: false }).isBoolean(), // Allow for history visibility
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('[validateFalSora2I2v] Validation errors:', errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];

// Sora 2 Image-to-Video (Pro)
export const validateFalSora2ProI2v = [
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('image_url').isString().notEmpty().withMessage('image_url is required'),
  body('resolution').optional({ nullable: true, checkFalsy: false }).isIn(['auto','720p','1080p']).withMessage('resolution must be auto, 720p, or 1080p'),
  body('aspect_ratio').optional({ nullable: true, checkFalsy: false }).isIn(['auto','16:9','9:16']).withMessage('aspect_ratio must be auto, 16:9, or 9:16'),
  body('duration').optional({ nullable: true, checkFalsy: false }).custom((value) => {
    // Accept both number and string, but validate the value
    const numValue = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (isNaN(numValue)) return false;
    return [4, 8, 12].includes(numValue);
  }).withMessage('duration must be 4, 8, or 12'),
  body('api_key').optional({ nullable: true, checkFalsy: false }).isString(),
  body('originalPrompt').optional({ nullable: true, checkFalsy: false }).isString(), // Allow for history display
  body('isPublic').optional({ nullable: true, checkFalsy: false }).isBoolean(), // Allow for history visibility
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('[validateFalSora2ProI2v] Validation errors:', errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
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
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('resolution').optional({ nullable: true, checkFalsy: false }).isIn(['720p']).withMessage('resolution must be 720p'),
  body('aspect_ratio').optional({ nullable: true, checkFalsy: false }).isIn(['16:9','9:16']).withMessage('aspect_ratio must be 16:9 or 9:16'),
  body('duration').optional({ nullable: true, checkFalsy: false }).custom((value) => {
    // Accept both number and string, but validate the value
    const numValue = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (isNaN(numValue)) return false;
    return [4, 8, 12].includes(numValue);
  }).withMessage('duration must be 4, 8, or 12'),
  body('api_key').optional({ nullable: true, checkFalsy: false }).isString(),
  body('originalPrompt').optional({ nullable: true, checkFalsy: false }).isString(), // Allow for history display
  body('isPublic').optional({ nullable: true, checkFalsy: false }).isBoolean(), // Allow for history visibility
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('[validateFalSora2T2v] Validation errors:', errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];

// Sora 2 Text-to-Video (Pro)
export const validateFalSora2ProT2v = [
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('resolution').optional({ nullable: true, checkFalsy: false }).isIn(['720p','1080p']).withMessage('resolution must be 720p or 1080p'),
  body('aspect_ratio').optional({ nullable: true, checkFalsy: false }).isIn(['16:9','9:16']).withMessage('aspect_ratio must be 16:9 or 9:16'),
  body('duration').optional({ nullable: true, checkFalsy: false }).custom((value) => {
    // Accept both number and string, but validate the value
    const numValue = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (isNaN(numValue)) return false;
    return [4, 8, 12].includes(numValue);
  }).withMessage('duration must be 4, 8, or 12'),
  body('api_key').optional({ nullable: true, checkFalsy: false }).isString(),
  body('originalPrompt').optional({ nullable: true, checkFalsy: false }).isString(), // Allow for history display
  body('isPublic').optional({ nullable: true, checkFalsy: false }).isBoolean(), // Allow for history visibility
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('[validateFalSora2ProT2v] Validation errors:', errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
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

// Image to SVG (fal-ai/image2svg)
export const validateFalImage2Svg = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  body('colormode').optional().isIn(['color','binary']),
  body('hierarchical').optional().isIn(['stacked','cutout']),
  body('mode').optional().isIn(['spline','polygon']),
  body('filter_speckle').optional().isInt(),
  body('color_precision').optional().isInt(),
  body('layer_difference').optional().isInt(),
  body('corner_threshold').optional().isInt(),
  body('length_threshold').optional().isFloat(),
  body('max_iterations').optional().isInt(),
  body('splice_threshold').optional().isInt(),
  body('path_precision').optional().isInt(),
  (req: Request, _res: Response, next: NextFunction) => {
    const hasUrl = typeof req.body?.image_url === 'string' && req.body.image_url.length > 0;
    const hasImage = typeof req.body?.image === 'string' && req.body.image.length > 0;
    if (!hasUrl && !hasImage) return next(new ApiError('image_url or image is required', 400));
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

export const validateFalOutpaint = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  body('expand_left').optional().isInt({ min: 0, max: 700 }),
  body('expand_right').optional().isInt({ min: 0, max: 700 }),
  body('expand_top').optional().isInt({ min: 0, max: 700 }),
  body('expand_bottom').optional().isInt({ min: 0, max: 700 }),
  body('zoom_out_percentage').optional().isFloat({ min: 0, max: 100 }),
  body('prompt').optional().isString(),
  body('num_images').optional().isInt({ min: 1, max: 4 }),
  body('enable_safety_checker').optional().isBoolean(),
  body('sync_mode').optional().isBoolean(),
  body('output_format').optional().isIn(['png', 'jpeg', 'jpg', 'webp']),
  body('aspect_ratio').optional().isIn(['1:1','16:9','9:16','4:3','3:4']),
  (req: Request, _res: Response, next: NextFunction) => {
    const hasUrl = typeof req.body?.image_url === 'string' && req.body.image_url.length > 0;
    const hasImage = typeof req.body?.image === 'string' && req.body.image.length > 0;
    if (!hasUrl && !hasImage) return next(new ApiError('image_url or image is required', 400));
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Bria Expand (fal-ai/bria/expand)
export const validateFalBriaExpand = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  body('canvas_size').optional().isArray({ min: 2, max: 2 }),
  body('canvas_size.*').optional().isInt({ min: 1, max: 5000 }),
  body('aspect_ratio').optional().isIn(['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9']),
  body('original_image_size').optional().isArray({ min: 2, max: 2 }),
  body('original_image_size.*').optional().isInt({ min: 1, max: 5000 }),
  body('original_image_location').optional().isArray({ min: 2, max: 2 }),
  body('original_image_location.*').optional().isInt({ min: -10000, max: 10000 }),
  body('prompt').optional().isString(),
  body('seed').optional().isInt(),
  body('negative_prompt').optional().isString(),
  body('sync_mode').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const hasUrl = typeof req.body?.image_url === 'string' && req.body.image_url.length > 0;
    const hasImage = typeof req.body?.image === 'string' && req.body.image.length > 0;
    if (!hasUrl && !hasImage) return next(new ApiError('image_url or image is required', 400));
    // Optional safety: if canvas_size is given, enforce area <= 5000x5000
    if (Array.isArray(req.body?.canvas_size) && req.body.canvas_size.length === 2) {
      const w = Number(req.body.canvas_size[0]);
      const h = Number(req.body.canvas_size[1]);
      if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0 || w > 5000 || h > 5000) {
        return next(new ApiError('canvas_size must be [width,height] each <= 5000', 400));
      }
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Bria GenFill (fal-ai/bria/genfill)
export const validateFalBriaGenfill = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  body('mask_url').optional().isString().notEmpty(),
  body('mask').optional().isString().notEmpty(),
  body('prompt').isString().notEmpty(),
  body('negative_prompt').optional().isString(),
  body('seed').optional().isInt(),
  body('num_images').optional().isInt({ min: 1, max: 4 }),
  body('sync_mode').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const hasImageUrl = typeof req.body?.image_url === 'string' && req.body.image_url.length > 0;
    const hasImage = typeof req.body?.image === 'string' && req.body.image.length > 0;
    if (!hasImageUrl && !hasImage) {
      return next(new ApiError('image_url or image is required', 400));
    }
    const hasMaskUrl = typeof req.body?.mask_url === 'string' && req.body.mask_url.length > 0;
    const hasMask = typeof req.body?.mask === 'string' && req.body.mask.length > 0;
    if (!hasMaskUrl && !hasMask) {
      return next(new ApiError('mask_url or mask is required', 400));
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Recraft Vectorize (fal-ai/recraft/vectorize)
export const validateFalRecraftVectorize = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  (req: Request, _res: Response, next: NextFunction) => {
    // Require either a public URL or a data URI/image string
    const hasUrl = typeof req.body?.image_url === 'string' && req.body.image_url.length > 0;
    const hasImage = typeof req.body?.image === 'string' && req.body.image.length > 0;
    if (!hasUrl && !hasImage) {
      return next(new ApiError('image_url or image is required', 400));
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// SeedVR2 Video Upscaler (fal-ai/seedvr/upscale/video)
export const validateFalSeedvrUpscale = [
  // Only validate video_url if it's provided AND video (data URI) is not provided
  body('video_url').optional().custom((value, { req }) => {
    const hasVideo = typeof (req.body as any)?.video === 'string' && String((req.body as any).video).startsWith('data:');
    // If video (data URI) is provided, video_url is optional
    if (hasVideo) return true;
    // If video_url is provided, it must be a non-empty string
    if (value !== undefined && value !== null) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error('video_url must be a non-empty string if provided');
      }
    }
    return true;
  }),
  body('video').optional().isString().withMessage('video must be a string if provided'), // allow data URI video as fallback
  body('upscale_mode').optional().isIn(['target','factor']).withMessage('upscale_mode must be target or factor'),
  body('upscale_factor').optional().isFloat({ gt: 0.1, lt: 10 }).withMessage('upscale_factor must be between 0.1 and 10'),
  body('target_resolution').optional().isIn(['720p','1080p','1440p','2160p']),
  body('seed').optional().isInt(),
  body('noise_scale').optional().isFloat({ min: 0, max: 2 }),
  body('output_format').optional().isIn(['X264 (.mp4)','VP9 (.webm)','PRORES4444 (.mov)','GIF (.gif)']),
  body('output_quality').optional().isIn(['low','medium','high','maximum']),
  body('output_write_mode').optional().isIn(['fast','balanced','small']),
  async (req: Request, _res: Response, next: NextFunction) => {
    // Ensure either video_url or video (data URI) is provided
    const hasVideoUrl = typeof req.body?.video_url === 'string' && req.body.video_url.trim().length > 0;
    const hasVideoData = typeof (req.body as any)?.video === 'string' && String((req.body as any).video).startsWith('data:');
    
    if (!hasVideoUrl && !hasVideoData) {
      return next(new ApiError('Either video_url or video (data URI) is required', 400));
    }

    // If caller sent a data URI under 'video', upload and convert to video_url
    if (hasVideoData && !hasVideoUrl) {
      try {
        const uid = (req as any)?.uid || 'anon';
        const stored = await uploadDataUriToZata({
          dataUri: (req.body as any).video,
          keyPrefix: `users/${uid}/input/seedvr/${Date.now()}`,
          fileName: 'seedvr-source'
        });
        (req.body as any).video_url = stored.publicUrl;
      } catch (e) {
        return next(new ApiError('Failed to upload video data URI to storage', 400));
      }
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    // Validate 30s max video duration by probing the URL
    try {
      const url: string = req.body?.video_url;
      let meta: any;
      try {
        meta = await probeVideoMeta(url);
      } catch (probeErr: any) {
        // If probing fails, log but don't block - FAL will handle validation
        console.warn('[validateFalSeedvrUpscale] Video probe failed:', probeErr?.message || probeErr);
        // Still set defaults and continue
        if (!req.body.upscale_mode) req.body.upscale_mode = 'factor';
        if (req.body.upscale_mode === 'factor' && (req.body.upscale_factor == null)) req.body.upscale_factor = 2;
        if (req.body.upscale_mode === 'target' && !req.body.target_resolution) req.body.target_resolution = '1080p';
        return next();
      }
      
      const duration = Number(meta?.durationSec || 0);
      if (!isFinite(duration) || duration <= 0) {
        console.warn('[validateFalSeedvrUpscale] Could not read video duration, but continuing - FAL will validate');
        // Don't block - let FAL handle it
      } else if (duration > 30.5) {
        return next(new ApiError('Input video too long. Maximum allowed duration is 30 seconds.', 400));
      }
      
      // Normalize body defaults
      if (!req.body.upscale_mode) req.body.upscale_mode = 'factor';
      if (req.body.upscale_mode === 'factor' && (req.body.upscale_factor == null)) req.body.upscale_factor = 2;
      if (req.body.upscale_mode === 'target' && !req.body.target_resolution) req.body.target_resolution = '1080p';
      // Stash probed meta for pricing
      (req as any).seedvrProbe = meta;
      next();
    } catch (e: any) {
      console.error('[validateFalSeedvrUpscale] Validation error:', e?.message || e);
      // Don't block on validation errors - let FAL API handle it
      if (!req.body.upscale_mode) req.body.upscale_mode = 'factor';
      if (req.body.upscale_mode === 'factor' && (req.body.upscale_factor == null)) req.body.upscale_factor = 2;
      if (req.body.upscale_mode === 'target' && !req.body.target_resolution) req.body.target_resolution = '1080p';
      next();
    }
  }
];

// BiRefNet v2 Video Background Removal (fal-ai/birefnet/v2/video)
export const validateFalBirefnetVideo = [
  body('video_url').optional().isString().notEmpty(),
  body('video').optional().isString(), // data URI allowed
  body('model').optional().isIn(['General Use (Light)','General Use (Light 2K)','General Use (Heavy)','Matting','Portrait','General Use (Dynamic)']),
  body('operating_resolution').optional().isIn(['1024x1024','2048x2048','2304x2304']),
  body('output_mask').optional().isBoolean(),
  body('refine_foreground').optional().isBoolean(),
  body('sync_mode').optional().isBoolean(),
  body('video_output_type').optional().isIn(['X264 (.mp4)','VP9 (.webm)','PRORES4444 (.mov)','GIF (.gif)']),
  body('video_quality').optional().isIn(['low','medium','high','maximum']),
  body('video_write_mode').optional().isIn(['fast','balanced','small']),
  async (req: Request, _res: Response, next: NextFunction) => {
    const hasVideoUrl = typeof req.body?.video_url === 'string' && req.body.video_url.trim().length > 0;
    const hasVideoData = typeof (req.body as any)?.video === 'string' && String((req.body as any).video).startsWith('data:');
    if (!hasVideoUrl && !hasVideoData) {
      return next(new ApiError('Either video_url or video (data URI) is required', 400));
    }
    // If client sent a data URI, upload to Zata and set video_url
    if (hasVideoData && !hasVideoUrl) {
      try {
        const uid = (req as any)?.uid || 'anon';
        const stored = await uploadDataUriToZata({
          dataUri: (req.body as any).video,
          keyPrefix: `users/${uid}/input/birefnet/${Date.now()}`,
          fileName: 'birefnet-source'
        });
        (req.body as any).video_url = stored.publicUrl;
      } catch (e) {
        return next(new ApiError('Failed to upload video data URI to storage', 400));
      }
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Topaz Image Upscaler (fal-ai/topaz/upscale/image) - dynamic per-MP pricing precheck
export const validateFalTopazUpscaleImage = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  body('upscale_factor').optional().isFloat({ gt: 0.1, lt: 10 }),
  body('model').optional().isIn(['Low Resolution V2','Standard V2','CGI','High Fidelity V2','Text Refine','Recovery','Redefine','Recovery V2']),
  body('output_format').optional().isIn(['jpeg','png']),
  async (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    // If client provided a public URL, probe it; if data URI is provided, skip probe and let service upload/handle
    const url: string | undefined = req.body?.image_url;
    const dataImage: string | undefined = req.body?.image;
    if (typeof url === 'string' && url.length > 0) {
      try {
        const meta = await probeImageMeta(url);
        const w = Number(meta?.width || 0);
        const h = Number(meta?.height || 0);
        if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
          return next(new ApiError('Unable to read image dimensions. Ensure the URL is public and accessible.', 400));
        }
        if (req.body.upscale_factor == null) req.body.upscale_factor = 2;
        (req as any).topazImageProbe = { width: w, height: h };
      } catch {
        return next(new ApiError('Failed to validate image URL for Topaz upscale', 400));
      }
    } else if (typeof dataImage === 'string' && dataImage.startsWith('data:')) {
      // Accept data URI; service will upload to get a public URL. Ensure default factor.
      if (req.body.upscale_factor == null) req.body.upscale_factor = 2;
    } else {
      return next(new ApiError('image_url or data URI image is required', 400));
    }
    next();
  }
];


