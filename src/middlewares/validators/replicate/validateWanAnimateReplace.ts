import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

export const validateWanAnimateReplace = [
  body('model').optional().isString(),
  body('video').isString().withMessage('video is required and must be a string URL or data URI'),
  body('character_image').isString().withMessage('character_image is required and must be a string URL or data URI'),
  body('seed').optional().isInt().withMessage('seed must be an integer'),
  body('go_fast').optional().isBoolean().withMessage('go_fast must be a boolean'),
  body('refert_num').optional().isIn([1, 5]).withMessage('refert_num must be 1 or 5'),
  body('resolution').optional().isIn(['720', '480']).withMessage('resolution must be 720 or 480'),
  body('merge_audio').optional().isBoolean().withMessage('merge_audio must be a boolean'),
  body('frames_per_second').optional().isInt({ min: 5, max: 60 }).withMessage('frames_per_second must be between 5 and 60'),
  body('isPublic').optional().isBoolean(),
  body('originalPrompt').optional().isString(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ApiError('Validation failed', 400, errors.array()));
    }

    // Default model if not provided
    if (!req.body.model) {
      req.body.model = 'wan-video/wan-2.2-animate-replace';
    }

    // Set defaults
    if (req.body.go_fast === undefined) {
      req.body.go_fast = true;
    }
    if (req.body.refert_num === undefined) {
      req.body.refert_num = 1;
    }
    if (req.body.resolution === undefined) {
      req.body.resolution = '720';
    }
    if (req.body.merge_audio === undefined) {
      req.body.merge_audio = true;
    }
    if (req.body.frames_per_second === undefined) {
      req.body.frames_per_second = 24;
    }

    return next();
  },
];


