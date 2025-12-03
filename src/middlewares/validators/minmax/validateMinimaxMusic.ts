import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

export const validateMinimaxMusic = [
  body('model').optional().isString().equals('music-2.0').withMessage('model must be "music-2.0"'),
  body('generationType').optional().isIn(['text-to-image','logo','sticker-generation','text-to-video','text-to-music','mockup-generation','product-generation','ad-generation','live-chat']).withMessage('invalid generationType'),
  body('prompt').isString().isLength({ min: 10, max: 2000 }).withMessage('prompt is required and must be 10-2000 characters'),
  body('lyrics').isString().isLength({ min: 10, max: 3000 }).withMessage('lyrics is required and must be 10-3000 characters'),
  body('stream').optional().isBoolean(),
  body('output_format').optional().isIn(['hex', 'url']),
  body('audio_setting').optional().isObject(),
  body('audio_setting.sample_rate').optional().isIn([16000, 24000, 32000, 44100]),
  body('audio_setting.bitrate').optional().isIn([32000, 64000, 128000, 256000]),
  body('audio_setting.format').optional().isIn(['mp3', 'wav', 'pcm']),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    
    // Check for profanity in prompt
    if (req.body?.prompt && typeof req.body.prompt === 'string') {
      const { validatePrompt } = require('../../../utils/profanityFilter');
      const profanityCheck = validatePrompt(req.body.prompt);
      if (!profanityCheck.isValid) {
        return next(new ApiError(profanityCheck.error || 'Prompt contains inappropriate language', 400));
      }
    }
    
    // Check for profanity in lyrics
    if (req.body?.lyrics && typeof req.body.lyrics === 'string') {
      const { validatePrompt } = require('../../../utils/profanityFilter');
      const profanityCheck = validatePrompt(req.body.lyrics);
      if (!profanityCheck.isValid) {
        return next(new ApiError(profanityCheck.error || 'Lyrics contain inappropriate language', 400));
      }
    }
    
    next();
  }
];


