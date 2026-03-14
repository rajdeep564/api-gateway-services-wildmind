import { body, validationResult } from 'express-validator';
import type { Request, Response, NextFunction } from 'express';

const VALID_ASPECT_RATIOS = ['16:9', '9:16'] as const;
const VALID_FPS = [24, 25, 48, 50] as const;
const VALID_CAMERA_MOTIONS = [
    'dolly_in', 'dolly_out', 'dolly_left', 'dolly_right',
    'jib_up', 'jib_down', 'static', 'focus_shift', 'none'
] as const;
const VALID_DURATIONS = [6, 8, 10, 12, 14, 16, 18, 20] as const;

export const validateLtx23FastT2V = [
    body('prompt')
        .exists({ checkFalsy: true })
        .withMessage('prompt is required')
        .isString()
        .withMessage('prompt must be a string')
        .isLength({ max: 2000 })
        .withMessage('prompt must be at most 2000 characters'),

    body('resolution')
        .optional()
        .isString()
        .customSanitizer((v: string) => {
            const s = String(v).toLowerCase();
            if (s.includes('4k') || s.includes('2160')) return '4k';
            if (s.includes('2k') || s.includes('1440')) return '2k';
            return '1080p';
        }),

    body('duration')
        .optional()
        .customSanitizer((v: any) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return 6;
            // Round to nearest even duration in the valid set
            const rounded = Math.round(n / 2) * 2;
            if (VALID_DURATIONS.includes(rounded as any)) return rounded;
            if (rounded < 6) return 6;
            if (rounded > 20) return 20;
            return 6;
        }),

    body('aspect_ratio')
        .optional()
        .isString()
        .customSanitizer((v: string) => {
            const s = String(v);
            return VALID_ASPECT_RATIOS.includes(s as any) ? s : '16:9';
        }),

    body('fps')
        .optional()
        .customSanitizer((v: any) => {
            const n = Number(v);
            if (VALID_FPS.includes(n as any)) return n;
            return 25;
        }),

    body('camera_motion')
        .optional()
        .isString()
        .customSanitizer((v: string) => {
            const s = String(v).toLowerCase();
            return VALID_CAMERA_MOTIONS.includes(s as any) ? s : 'none';
        }),

    body('generate_audio')
        .optional()
        .customSanitizer((v: any) => {
            if (v === false || v === 'false') return false;
            return true; // Default to true
        }),

    body('seed')
        .optional()
        .isInt()
        .withMessage('seed must be an integer'),

    body('isPublic')
        .optional()
        .isBoolean()
        .withMessage('isPublic must be a boolean'),

    // Custom validation: durations > 10s only at 1080p with 24/25 fps
    (req: Request, _res: Response, next: NextFunction) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return next();
        }

        const duration = req.body.duration ?? 6;
        const resolution = req.body.resolution ?? '1080p';
        const fps = req.body.fps ?? 25;

        if (duration > 10) {
            if (resolution !== '1080p') {
                req.body.duration = 10;
            } else if (![24, 25].includes(fps)) {
                req.body.fps = 25;
            }
        }

        next();
    }
];
