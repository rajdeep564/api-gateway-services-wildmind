import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

// Validator for Replicate model: Seedance 1.0 Pro/Lite T2V
// Required: prompt (string)
// Optional: duration (integer 2-12, default 5), resolution (480p/720p/1080p, default 1080p), 
//           aspect_ratio (16:9/4:3/1:1/3:4/9:16/21:9/9:21, default 16:9),
//           seed (integer), fps (24 only), camera_fixed (boolean, default false),
//           image (string URI, first frame), last_frame_image (string URI, requires image)
const allowedResolutions = ['480p', '720p', '1080p'];
const allowedAspectRatios = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', '9:21'];

export const validateSeedanceT2V = [
  body('model').optional().isString(),
  body('prompt').isString().withMessage('prompt is required').isLength({ min: 1, max: 2000 }),
  body('duration').optional().isInt({ min: 2, max: 12 }).withMessage('duration must be between 2 and 12 seconds'),
  body('resolution').optional().isIn(allowedResolutions),
  body('aspect_ratio').optional().isIn(allowedAspectRatios),
  body('seed').optional().isInt(),
  body('fps').optional().custom(v => v == null || Number(v) === 24).withMessage('fps must be 24'),
  body('camera_fixed').optional().isBoolean(),
  body('generate_audio').optional().isBoolean(),
  body('image').optional().isString().isLength({ min: 5 }).withMessage('image (first frame) must be a valid URI'),
  body('last_frame_image').optional().isString().isLength({ min: 5 }).withMessage('last_frame_image must be a valid URI'),
  body('speed').optional().custom(v => typeof v === 'string' || typeof v === 'boolean'), // For tier detection (lite vs pro)
  body('reference_images').optional().isArray().withMessage('reference_images must be an array'),
  body('reference_images.*').optional().isString().isLength({ min: 5 }).withMessage('Each reference image must be a valid URI'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));

    const modelStr = String(req.body.model || '').toLowerCase();
    const speed = String(req.body.speed || '').toLowerCase();
    const isSeedance15 = modelStr.includes('seedance-1.5') || speed.includes('1.5');

    // Defaults and normalization
    if (!req.body.model) {
      if (isSeedance15) {
        req.body.model = 'bytedance/seedance-1.5-pro';
      } else {
        // Default to Pro tier unless 'lite' is specified
        const isLite = modelStr.includes('lite') || speed === 'lite' || speed.includes('lite');
        req.body.model = isLite ? 'bytedance/seedance-1-lite' : 'bytedance/seedance-1-pro';
      }
    }
    
    // Normalize duration: default 5, clamp to 2-12
    const d = Number(req.body.duration ?? 5);
    req.body.duration = Math.max(2, Math.min(12, Math.round(d)));
    
    // Seedance 1.5 does not support resolution/reference_images in our API contract
    if (isSeedance15) {
      if (req.body.resolution != null) delete req.body.resolution;
      if (req.body.reference_images != null) delete req.body.reference_images;
      if (req.body.generate_audio === undefined) req.body.generate_audio = false;
    } else {
      // Default resolution to 1080p
      if (!req.body.resolution) req.body.resolution = '1080p';
    }
    
    // Default aspect_ratio to 16:9
    if (!req.body.aspect_ratio) req.body.aspect_ratio = '16:9';
    
    // Default fps to 24
    if (!req.body.fps) req.body.fps = 24;
    
    // Default camera_fixed to false
    if (req.body.camera_fixed === undefined) req.body.camera_fixed = false;
    
    // Validate last_frame_image: only works if image (first frame) is also provided
    if (req.body.last_frame_image && String(req.body.last_frame_image).length > 5) {
      if (!req.body.image || String(req.body.image).length < 5) {
        return next(new ApiError('last_frame_image requires image (first frame) to be provided', 400));
      }
    }
    
    // Validate reference_images: 1-4 images, cannot be used with 1080p or first/last frame images
    if (!isSeedance15 && Array.isArray(req.body.reference_images) && req.body.reference_images.length > 0) {
      if (req.body.reference_images.length > 4) {
        return next(new ApiError('reference_images can contain at most 4 images', 400));
      }
      if (req.body.resolution === '1080p') {
        return next(new ApiError('reference_images cannot be used with 1080p resolution', 400));
      }
      if (req.body.image && String(req.body.image).length > 5) {
        return next(new ApiError('reference_images cannot be used with image (first frame)', 400));
      }
      if (req.body.last_frame_image && String(req.body.last_frame_image).length > 5) {
        return next(new ApiError('reference_images cannot be used with last_frame_image', 400));
      }
      // Validate each reference image is a valid URI
      for (const refImg of req.body.reference_images) {
        if (typeof refImg !== 'string' || refImg.length < 5) {
          return next(new ApiError('Each reference image must be a valid URI', 400));
        }
      }
    }
    
    // Set mode for pricing
    if (!req.body.mode && !req.body.kind && !req.body.type) req.body.mode = 't2v';
    
    return next();
  }
];

