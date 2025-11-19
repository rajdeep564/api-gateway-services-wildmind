import { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

const runValidation = (req: Request, _res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
  next();
};

export const validateRunwayStatus = [
  param('id').isString().notEmpty(),
  runValidation
];

// Text to image
const TTI_RATIOS = new Set([
  '1920:1080', '1080:1920', '1024:1024', '1360:768', '1080:1080', '1168:880',
  '1440:1080', '1080:1440', '1808:768', '2112:912', '1280:720', '720:1280',
  '720:720', '960:720', '720:960', '1680:720', '1344:768', '768:1344', '1184:864',
  '864:1184', '1536:672'
]);

export const validateRunwayTextToImage = [
  body('promptText').isString().isLength({ min: 1, max: 1000 }),
  body('generationType').optional().isIn(['text-to-image','logo','sticker-generation','text-to-video','text-to-music','mockup-generation','product-generation','ad-generation','live-chat']).withMessage('invalid generationType'),
  body('ratio').isString().custom(v => TTI_RATIOS.has(v)),
  body('model').isString().isIn(['gen4_image_turbo', 'gen4_image', 'gemini_2.5_flash']),
  body('seed').optional().isInt({ min: 0, max: 4294967295 }),
  body('referenceImages').optional().isArray({ max: 3 }),
  body('referenceImages.*.uri').optional().isString(),
  runValidation
];

// Image to video (promptImage can be string or array of {uri, position})
const I2V_RATIOS_GEN4_TURBO = new Set(['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672']);
const I2V_RATIOS_GEN3A_TURBO = new Set(['1280:768', '768:1280']);
const I2V_RATIOS_VEO3 = new Set(['1280:720', '720:1280']);

export const validateRunwayImageToVideo = [
  body('model').isString().isIn(['gen4_turbo', 'gen3a_turbo', 'veo3']),
  body('generationType').optional().isIn(['text-to-image','logo','sticker-generation','text-to-video','text-to-music','mockup-generation','product-generation','ad-generation','live-chat']).withMessage('invalid generationType'),
  body('ratio').isString().custom((v, { req }) => {
    const m = req.body.model;
    if (m === 'gen4_turbo') return I2V_RATIOS_GEN4_TURBO.has(v);
    if (m === 'gen3a_turbo') return I2V_RATIOS_GEN3A_TURBO.has(v);
    if (m === 'veo3') return I2V_RATIOS_VEO3.has(v);
    return false;
  }),
  body('duration').optional().isInt({ min: 5, max: 10 }).custom((v, { req }) => {
    const m = req.body.model;
    if (m === 'veo3') return Number(v) === 8;
    // gen4_turbo, gen3a_turbo must be 5 or 10
    return v === 5 || v === 10;
  }),
  body('promptText').optional().isString().isLength({ max: 1000 }),
  body('seed').optional().isInt({ min: 0, max: 4294967295 }),
  body('contentModeration').optional().isObject(),
  body('contentModeration.publicFigureThreshold').optional().isIn(['auto', 'low']),
  body('promptImage').custom(value => {
    // string or array of {uri, position}
    if (typeof value === 'string') return value.startsWith('http') || value.startsWith('data:');
    if (Array.isArray(value)) {
      return value.every((p) => typeof p.uri === 'string' && (p.position === 'first' || p.position === 'last'));
    }
    return false;
  }),
  runValidation
];

// Text to video (veo3 only)
export const validateRunwayTextToVideo = [
  body('model').equals('veo3'),
  body('generationType').optional().isIn(['text-to-image','logo','sticker-generation','text-to-video','text-to-music','mockup-generation','product-generation','ad-generation','live-chat']).withMessage('invalid generationType'),
  body('promptText').isString().isLength({ min: 1, max: 1000 }),
  body('ratio').isIn(['1280:720', '720:1280']),
  body('duration').equals('8').toInt(),
  body('seed').optional().isInt({ min: 0, max: 4294967295 }),
  runValidation
];

// Video to video
const V2V_RATIOS = new Set(['1280:720','720:1280','1104:832','960:960','832:1104','1584:672','848:480','640:480']);
export const validateRunwayVideoToVideo = [
  body('model').equals('gen4_aleph'),
  body('generationType').optional().isIn(['text-to-image','logo','sticker-generation','text-to-video','text-to-music','mockup-generation','product-generation','ad-generation','live-chat']).withMessage('invalid generationType'),
  body('videoUri').isString().notEmpty(),
  body('promptText').isString().isLength({ min: 1, max: 1000 }),
  body('ratio').isString().custom(v => V2V_RATIOS.has(v)),
  body('references').optional().isArray(),
  body('references.*.type').optional().equals('image'),
  body('references.*.uri').optional().isString(),
  body('seed').optional().isInt({ min: 0, max: 4294967295 }),
  body('contentModeration').optional().isObject(),
  body('contentModeration.publicFigureThreshold').optional().isIn(['auto', 'low']),
  runValidation
];

// Video upscale
export const validateRunwayVideoUpscale = [
  body('model').equals('upscale_v1'),
  body('videoUri').isString().notEmpty(),
  runValidation
];

// Character Performance (act_two)
const ACT_TWO_RATIOS = new Set(['1280:720', '720:1280', '960:960', '1104:832', '832:1104', '1584:672']);
export const validateRunwayCharacterPerformance = [
  body('model').equals('act_two'),
  body('generationType').optional().isIn(['text-to-image','logo','sticker-generation','text-to-video','video-to-video','text-to-music','mockup-generation','product-generation','ad-generation','live-chat']).withMessage('invalid generationType'),
  body('character').isObject().custom((value) => {
    if (!value.type || !['image', 'video'].includes(value.type)) return false;
    if (!value.uri || typeof value.uri !== 'string') return false;
    // Validate URI format (data URI or HTTPS URL)
    if (value.type === 'image') {
      return value.uri.startsWith('data:image/') || value.uri.startsWith('https://');
    }
    if (value.type === 'video') {
      return value.uri.startsWith('data:video/') || value.uri.startsWith('https://');
    }
    return false;
  }),
  body('reference').isObject().custom((value) => {
    if (value.type !== 'video') return false;
    if (!value.uri || typeof value.uri !== 'string') return false;
    return value.uri.startsWith('data:video/') || value.uri.startsWith('https://');
  }),
  body('ratio').isString().custom(v => ACT_TWO_RATIOS.has(v)),
  body('seed').optional().isInt({ min: 0, max: 4294967295 }),
  body('bodyControl').optional().isBoolean(),
  body('expressionIntensity').optional().isInt({ min: 1, max: 5 }),
  body('contentModeration').optional().isObject(),
  body('contentModeration.publicFigureThreshold').optional().isIn(['auto', 'low']),
  runValidation
];


