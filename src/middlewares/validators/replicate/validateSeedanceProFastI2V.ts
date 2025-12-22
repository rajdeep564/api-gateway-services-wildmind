import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

// Validator for Replicate model: Seedance 1.0 Pro Fast I2V
// Required: prompt (string), image (string URI)
// Optional: duration (integer 2-12, default 5), resolution (480p/720p/1080p, default 1080p),
//           seed (integer), fps (24 only), camera_fixed (boolean, default false)
// NOTE: This model does NOT support first_frame_image or last_frame_image
const allowedResolutions = ['480p', '720p', '1080p'];

export const validateSeedanceProFastI2V = [
  body('model').optional().isString(),
  body('image').isString().withMessage('image is required').isLength({ min: 5 }),
  body('prompt').isString().withMessage('prompt is required').isLength({ min: 1, max: 2000 }),
  body('duration').optional().isInt({ min: 2, max: 12 }).withMessage('duration must be between 2 and 12 seconds'),
  body('resolution').optional().isIn(allowedResolutions),
  body('seed').optional().isInt(),
  body('fps').optional().custom(v => v == null || Number(v) === 24).withMessage('fps must be 24'),
  body('camera_fixed').optional().isBoolean(),
  // Pro Fast does NOT support last_frame_image
  body('last_frame_image').optional().custom(v => {
    if (v != null && String(v).length > 5) {
      throw new Error('last_frame_image is not supported by Seedance Pro Fast');
    }
    return true;
  }),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));

    // Defaults and normalization
    if (!req.body.model) {
      req.body.model = 'bytedance/seedance-1-pro-fast';
    }
    
    // Normalize duration: default 5, clamp to 2-12
    const d = Number(req.body.duration ?? 5);
    req.body.duration = Math.max(2, Math.min(12, Math.round(d)));
    
    // Default resolution to 1080p
    if (!req.body.resolution) req.body.resolution = '1080p';
    
    // Default fps to 24
    if (!req.body.fps) req.body.fps = 24;
    
    // Default camera_fixed to false
    if (req.body.camera_fixed === undefined) req.body.camera_fixed = false;
    
    // Set mode for pricing
    if (!req.body.mode && !req.body.kind && !req.body.type) req.body.mode = 'i2v';
    
    return next();
  }
];

