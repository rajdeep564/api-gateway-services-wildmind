import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

// Covers:
// - kwaivgi/kling-v2.5-turbo-pro (t2v only - supports both text and image input)

const allowedAspect = ['16:9','9:16','1:1'];

export const validateKlingT2V = [
  body('model').optional().isString(),
  body('prompt').isString().withMessage('prompt is required').isLength({ min: 1, max: 2000 }),
  body('duration').optional().custom(v => /^(5|10)(s)?$/.test(String(v).trim().toLowerCase())),
  body('aspect_ratio').optional().isIn(allowedAspect),
  body('guidance_scale').optional().isFloat({ min: 0, max: 1 }),
  body('negative_prompt').optional().isString(),
  body('mode').optional().isIn(['standard','pro']), // provider mode for v2.1 determining 720p/1080p
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    // Defaults and normalization
    if (!req.body.model) req.body.model = 'kwaivgi/kling-v2.5-turbo-pro';
    const d = String(req.body.duration ?? '5').toLowerCase();
    const dm = d.match(/(5|10)/); req.body.duration = dm ? Number(dm[1]) : 5;
    // Set pricing kind for util without clobbering provider 'mode'
    if (!req.body.kind && !req.body.type) req.body.kind = 't2v';
    
    return next();
  }
];
