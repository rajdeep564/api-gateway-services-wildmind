import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

const allowedRes = ['480p','720p','1080p','480','720','1080'];

export const validateWan25I2V = [
  body('model').optional().isString(),
  body('image').isString().withMessage('image is required').isLength({ min: 5 }),
  body('prompt').isString().withMessage('prompt is required').isLength({ min: 1, max: 2000 }),
  body('duration').optional().custom(v => /^(5|10)(s)?$/.test(String(v).trim().toLowerCase())),
  body('resolution').optional().custom(v => allowedRes.includes(String(v).trim().toLowerCase())),
  body('seed').optional().isInt(),
  body('audio').optional().isString(),
  body('negative_prompt').optional().isString(),
  body('enable_prompt_expansion').optional().isBoolean(),
  body('speed').optional().custom(v => typeof v === 'string' || typeof v === 'boolean'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));

    // Defaults and normalization
    // Keep explicit model slug if provided; otherwise default to standard (service/pricing will detect -fast via model or speed)
    if (!req.body.model) req.body.model = 'wan-video/wan-2.5-i2v';
    const d = String(req.body.duration ?? '5').toLowerCase();
    const dm = d.match(/(5|10)/); req.body.duration = dm ? Number(dm[1]) : 5;
    const r = String(req.body.resolution ?? '720p').toLowerCase();
    const rm = r.match(/(480|720|1080)/); req.body.resolution = rm ? `${rm[1]}p` : '720p';
    if (!req.body.mode && !req.body.kind && !req.body.type) req.body.mode = 'i2v'; // used by pricing util
    return next();
  }
];
