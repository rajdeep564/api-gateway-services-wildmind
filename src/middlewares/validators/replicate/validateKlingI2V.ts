import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

// Supports:
// - kwaivgi/kling-v2.5-turbo-pro with image (i2v) - supports both text and image input
// - kwaivgi/kling-v2.1-master with start_image (i2v only) - requires start_image
// - kwaivgi/kling-v2.1 with start_image (i2v only) - requires start_image, optional end_image, mode standard/pro

const allowedAspect = ['16:9','9:16','1:1'];

export const validateKlingI2V = [
  body('model').optional().isString(),
  // Accept either 'image' or 'start_image'
  body('image').optional().isString(),
  body('start_image').optional().isString(),
  body('end_image').optional().isString(),
  body('prompt').isString().withMessage('prompt is required').isLength({ min: 1, max: 2000 }),
  body('duration').optional().custom(v => /^(5|10)(s)?$/.test(String(v).trim().toLowerCase())),
  body('aspect_ratio').optional().isIn(allowedAspect),
  body('guidance_scale').optional().isFloat({ min: 0, max: 1 }),
  body('negative_prompt').optional().isString(),
  body('mode').optional().isIn(['standard','pro']),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));

    // At least one image input required for I2V
    if (!req.body.image && !req.body.start_image) {
      return next(new ApiError('image or start_image is required for Kling I2V', 400));
    }

    if (!req.body.model) {
      // Default to v2.1 (requires start_image) if start_image provided, else 2.5 turbo with generic image
      req.body.model = req.body.start_image ? 'kwaivgi/kling-v2.1' : 'kwaivgi/kling-v2.5-turbo-pro';
    }
    const d = String(req.body.duration ?? '5').toLowerCase();
    const dm = d.match(/(5|10)/); req.body.duration = dm ? Number(dm[1]) : 5;
    if (!req.body.kind && !req.body.type) req.body.kind = 'i2v';
    
    return next();
  }
];
