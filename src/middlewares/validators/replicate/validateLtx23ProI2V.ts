import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';

const VALID_TASKS = ['text_to_video', 'image_to_video', 'audio_to_video', 'retake', 'extend'] as const;
const VALID_RESOLUTIONS = ['1080p', '2k', '4k'] as const;

const VALID_DURATIONS = [6, 8, 10] as const;
const VALID_ASPECT_RATIOS = ['16:9', '9:16'] as const;
const VALID_FPS = [24, 25, 48, 50] as const;
const VALID_CAMERA_MOTIONS = [
  'none',
  'dolly_in',
  'dolly_out',
  'dolly_left',
  'dolly_right',
  'jib_up',
  'jib_down',
  'static',
  'focus_shift'
] as const;
const VALID_EXTEND_MODES = ['start', 'end'] as const;
const VALID_RETAKE_MODES = ['replace_audio', 'replace_video', 'replace_audio_and_video'] as const;

function normalizeDuration(value: any): 6 | 8 | 10 {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 6) return 6;
  if (n <= 8) return 8;
  return 10;
}

function normalizeResolution(value: any): '1080p' | '2k' | '4k' {
  const s = String(value ?? '1080p').toLowerCase();
  if (s.includes('4k') || s.includes('2160')) return '4k';
  if (s.includes('2k') || s.includes('1440')) return '2k';
  return '1080p';
}

export const validateLtx23ProI2V = [
  body('prompt').isString().withMessage('prompt is required').isLength({ min: 1, max: 2000 }),
  body('image').isString().withMessage('image is required for image_to_video').isLength({ min: 5 }),
  body('last_frame_image').optional().isString().isLength({ min: 5 }).withMessage('last_frame_image must be a valid URI'),
  body('task').optional().isIn(VALID_TASKS as readonly string[]),
  body('duration').optional().isInt(),
  body('resolution')
    .optional()
    .customSanitizer((v) => normalizeResolution(v))
    .isIn(VALID_RESOLUTIONS as readonly string[])
    .withMessage('resolution must be one of 1080p, 2k, 4k'),
  body('aspect_ratio').optional().isIn(VALID_ASPECT_RATIOS as readonly string[]),
  body('fps').optional().custom((v) => v == null || VALID_FPS.includes(Number(v) as any)).withMessage('fps must be one of 24, 25, 48, 50'),
  body('camera_motion').optional().isIn(VALID_CAMERA_MOTIONS as readonly string[]),
  body('generate_audio').optional().isBoolean(),
  body('audio').optional().isString().isLength({ min: 5 }).withMessage('audio must be a valid URI'),
  body('video').optional().isString().isLength({ min: 5 }).withMessage('video must be a valid URI'),
  body('retake_start_time').optional().isFloat({ min: 0 }),
  body('retake_duration').optional().isFloat({ min: 2 }),
  body('retake_mode').optional().isIn(VALID_RETAKE_MODES as readonly string[]),
  body('extend_mode').optional().isIn(VALID_EXTEND_MODES as readonly string[]),
  body('seed').optional().isInt(),
  body('isPublic').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));

    req.body.task = 'image_to_video';
    req.body.duration = normalizeDuration(req.body.duration);
    req.body.resolution = normalizeResolution(req.body.resolution);
    req.body.aspect_ratio = VALID_ASPECT_RATIOS.includes(req.body.aspect_ratio) ? req.body.aspect_ratio : '16:9';
    req.body.fps = VALID_FPS.includes(Number(req.body.fps) as any) ? Number(req.body.fps) : 25;
    req.body.camera_motion = VALID_CAMERA_MOTIONS.includes(req.body.camera_motion) ? req.body.camera_motion : 'none';
    req.body.generate_audio = req.body.generate_audio === false || req.body.generate_audio === 'false' ? false : true;
    req.body.extend_mode = VALID_EXTEND_MODES.includes(req.body.extend_mode) ? req.body.extend_mode : 'end';
    req.body.retake_mode = VALID_RETAKE_MODES.includes(req.body.retake_mode) ? req.body.retake_mode : 'replace_audio_and_video';
    req.body.retake_start_time = Math.max(0, Number(req.body.retake_start_time ?? 0));
    req.body.retake_duration = Math.max(2, Number(req.body.retake_duration ?? 2));
    req.body.mode = 'i2v';

    if (!VALID_DURATIONS.includes(req.body.duration)) {
      req.body.duration = normalizeDuration(req.body.duration);
    }

    return next();
  }
];
