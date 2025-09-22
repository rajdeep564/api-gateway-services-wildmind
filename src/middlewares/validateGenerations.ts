import { body, query, validationResult, oneOf } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import { formatApiResponse } from '../utils/formatApiResponse';

export const validateCreateGeneration = [
  body('prompt').isString().trim().isLength({ min: 1, max: 4000 }),
  body('model').isString().trim().isLength({ min: 1, max: 200 }),
  body('generationType').isIn(['text-to-image','logo','sticker','text-to-video','text-to-music','mockup','product','ad','live-chat']),
  body('visibility').optional().isIn(['private','public','unlisted']),
  body('tags').optional().isArray({ max: 30 }),
  body('tags.*').optional().isString().isLength({ max: 40 }),
  body('nsfw').optional().isBoolean(),
];

export const validateUpdateGenerationStatus = [
  body('status').isIn(['completed','failed']),
  oneOf([
    [
      body('status').equals('completed'),
      body('images').optional().isArray({ max: 30 }),
      body('images.*.id').optional().isString(),
      body('images.*.url').optional().isURL(),
      body('images.*.storagePath').optional().isString(),
      body('images.*.originalUrl').optional().isURL(),
      body('videos').optional().isArray({ max: 10 }),
      body('videos.*.id').optional().isString(),
      body('videos.*.url').optional().isURL(),
      body('videos.*.storagePath').optional().isString(),
      body('videos.*.thumbUrl').optional().isURL(),
      body('isPublicReady').optional().isBoolean(),
      body('tags').optional().isArray({ max: 30 }),
      body('tags.*').optional().isString().isLength({ max: 40 }),
      body('nsfw').optional().isBoolean(),
    ],
    [
      body('status').equals('failed'),
      body('error').isString().trim().isLength({ min: 1, max: 2000 }),
    ],
  ]),
];

export const validateListGenerations = [
  query('limit').optional().toInt().isInt({ min: 1, max: 50 }),
  query('cursor').optional().isString(),
  query('status').optional().isIn(['generating','completed','failed']),
  query('generationType').optional().isIn(['text-to-image','logo','sticker','text-to-video','text-to-music','mockup','product','ad','live-chat']),
];

export function handleValidationErrors(req: Request, res: Response, next: NextFunction) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return res.status(400).json(
      formatApiResponse('error', 'Validation failed', { errors: result.array() })
    );
  }
  return next();
}


