import { Request, Response, NextFunction } from 'express';
import { validationResult, body } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';
import { FrameSize } from '../../../types/bfl';

export const ALLOWED_MODELS = [
  'flux-kontext-pro',
  'flux-kontext-max',
  'flux-pro-1.1',
  'flux-pro-1.1-ultra',
  'flux-pro',
  'flux-dev'
];

const allowedFrameSizes: FrameSize[] = [
  '1:1', '3:4', '4:3', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', '16:10', '10:16'
];

export const validateBflGenerate = [
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('model').isString().isIn(ALLOWED_MODELS).withMessage('invalid model'),
  body('generationType').optional().isIn(['text-to-image','logo','sticker-generation','text-to-video','text-to-music','mockup-generation','product-generation','ad-generation','live-chat','text-to-character']).withMessage('invalid generationType'),
  body('n').optional().isInt({ min: 1, max: 10 }).withMessage('n must be 1-10'),
  body('frameSize').optional().isIn(allowedFrameSizes).withMessage('invalid frameSize'),
  body('width').optional().isInt({ min: 16 }).withMessage('width must be a number'),
  body('height').optional().isInt({ min: 16 }).withMessage('height must be a number') ,
  body('output_format').optional().isIn(['jpeg','png']).withMessage('invalid output_format'),
  body('prompt_upsampling').optional().isBoolean().withMessage('prompt_upsampling must be boolean'),
  body('isPublic').optional().isBoolean().withMessage('isPublic must be boolean'),
  body('uploadedImages').optional().isArray().withMessage('uploadedImages must be array'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ApiError('Validation failed', 400, errors.array()));
    }

    next();
  }
];

// Consolidated validators for additional BFL operations
const common = [
  body('prompt').optional().isString(),
  body('generationType').optional().isIn(['text-to-image','logo','sticker-generation','text-to-video','text-to-music','mockup-generation','product-generation','ad-generation','live-chat','text-to-character']).withMessage('invalid generationType'),
  body('output_format').optional().isIn(['jpeg','png']).withMessage('invalid output_format'),
  body('prompt_upsampling').optional().isBoolean(),
  body('isPublic').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ApiError('Validation failed', 400, errors.array()));
    }

    next();
  }
];

export const validateBflFill = [
  body('image').isString().notEmpty().withMessage('image is required'),
  body('mask').optional().isString(),
  body('steps').optional().isInt({ min: 15, max: 50 }),
  body('guidance').optional().isFloat({ min: 1.5, max: 100 }),
  body('seed').optional().isInt(),
  ...common,
];

export const validateBflExpand = [
  body('image').isString().notEmpty().withMessage('image is required'),
  body('top').optional().isInt({ min: 0, max: 2048 }),
  body('bottom').optional().isInt({ min: 0, max: 2048 }),
  body('left').optional().isInt({ min: 0, max: 2048 }),
  body('right').optional().isInt({ min: 0, max: 2048 }),
  body('steps').optional().isInt({ min: 15, max: 50 }),
  body('guidance').optional().isFloat({ min: 1.5, max: 100 }),
  body('seed').optional().isInt(),
  ...common,
];

export const validateBflCanny = [
  body('prompt').isString().notEmpty(),
  body('control_image').optional().isString(),
  body('preprocessed_image').optional().isString(),
  body('canny_low_threshold').optional().isInt({ min: 0, max: 500 }),
  body('canny_high_threshold').optional().isInt({ min: 0, max: 500 }),
  body('steps').optional().isInt({ min: 15, max: 50 }),
  body('guidance').optional().isFloat({ min: 1, max: 100 }),
  body('seed').optional().isInt(),
  ...common,
];

export const validateBflDepth = [
  body('prompt').isString().notEmpty(),
  body('control_image').optional().isString(),
  body('preprocessed_image').optional().isString(),
  body('steps').optional().isInt({ min: 15, max: 50 }),
  body('guidance').optional().isFloat({ min: 1, max: 100 }),
  body('seed').optional().isInt(),
  ...common,
];

export const validateBflExpandWithFill = [
  body('image').isString().notEmpty().withMessage('image is required'),
  body('canvas_size').isArray({ min: 2, max: 2 }).withMessage('canvas_size must be [width, height]'),
  body('canvas_size.*').isInt({ min: 1, max: 5000 }).withMessage('canvas_size values must be 1-5000'),
  body('original_image_size').isArray({ min: 2, max: 2 }).withMessage('original_image_size must be [width, height]'),
  body('original_image_size.*').isInt({ min: 1, max: 5000 }).withMessage('original_image_size values must be 1-5000'),
  body('original_image_location').optional().isArray({ min: 2, max: 2 }).withMessage('original_image_location must be [x, y]'),
  body('original_image_location.*').optional().isInt(),
  body('steps').optional().isInt({ min: 15, max: 50 }),
  body('guidance').optional().isFloat({ min: 1.5, max: 100 }),
  body('seed').optional().isInt(),
  body('safety_tolerance').optional().isInt({ min: 0, max: 6 }),
  ...common,
];


