import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

const allowedQualities = ['360p','540p','720p','1080p','360','540','720','1080'];
const allowedAspects = ['16:9','9:16','1:1'];

export const validatePixverseT2V = [
  body('model').optional().isString(),
  body('prompt').isString().withMessage('prompt is required').isLength({ min: 1, max: 2000 }),
  body('duration').optional().custom(v => /^(5|8)(s)?$/.test(String(v).trim().toLowerCase())),
  body('quality').optional().custom(v => allowedQualities.includes(String(v).trim().toLowerCase())),
  body('resolution').optional().custom(v => allowedQualities.includes(String(v).trim().toLowerCase())),
  body('aspect_ratio').optional().isIn(allowedAspects),
  body('seed').optional().isInt(),
  body('negative_prompt').optional().isString(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));

    // Defaults and normalization
    if (!req.body.model) req.body.model = 'pixverseai/pixverse-v5';
    const d = String(req.body.duration ?? '5').toLowerCase();
    const dm = d.match(/(5|8)/); req.body.duration = dm ? Number(dm[1]) : 5;
    // Normalize quality/resolution to 'Xp'
    const rawQ = (req.body.quality ?? req.body.resolution ?? '720p').toString().toLowerCase();
    const qm = rawQ.match(/(360|540|720|1080)/);
    req.body.quality = qm ? `${qm[1]}p` : '720p';
    req.body.resolution = req.body.quality;
    if (!req.body.mode && !req.body.kind && !req.body.type) req.body.mode = 't2v';
    
    // Check for profanity in prompt
    if (req.body?.prompt && typeof req.body.prompt === 'string') {
      const { validatePrompt } = require('../../../utils/profanityFilter');
      const profanityCheck = validatePrompt(req.body.prompt);
      if (!profanityCheck.isValid) {
        return next(new ApiError(profanityCheck.error || 'Prompt contains inappropriate language', 400));
      }
    }
    
    // Check for profanity in negative_prompt if provided
    if (req.body?.negative_prompt && typeof req.body.negative_prompt === 'string') {
      const { validatePrompt } = require('../../../utils/profanityFilter');
      const profanityCheck = validatePrompt(req.body.negative_prompt);
      if (!profanityCheck.isValid) {
        return next(new ApiError(profanityCheck.error || 'Negative prompt contains inappropriate language', 400));
      }
    }
    
    return next();
  }
];
