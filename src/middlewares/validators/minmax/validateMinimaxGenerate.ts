import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

const validAspectRatios = ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'];

export const validateMinimaxGenerate = [
  body('prompt').isString().notEmpty(),
  body('generationType').optional().isIn(['text-to-image','logo','sticker-generation','text-to-video','text-to-music','mockup-generation','product-generation','ad-generation','live-chat']).withMessage('invalid generationType'),
  body('n').optional().isInt({ min: 1, max: 9 }),
  body('aspect_ratio').optional().isIn(validAspectRatios),
  body('width').optional().isInt({ min: 512, max: 2048 }),
  body('height').optional().isInt({ min: 512, max: 2048 }),
  body().custom((value) => {
    const { width, height } = value;
    if ((width !== undefined || height !== undefined) && !(width !== undefined && height !== undefined)) {
      throw new Error('Both width and height must be provided together');
    }
    if (width !== undefined && height !== undefined) {
      if (width % 8 !== 0 || height % 8 !== 0) throw new Error('Width and height must be multiples of 8');
    }
    return true;
  }),
  body('subject_reference').optional().isArray({ min: 1, max: 1 }),
  body('subject_reference.*.type').optional().equals('character'),
  body('subject_reference.*.image_file').optional().isString().notEmpty(),
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
    
    next();
  }
];


