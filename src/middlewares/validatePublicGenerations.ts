import { query, param, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import { formatApiResponse } from '../utils/formatApiResponse';

export const validatePublicListGenerations = [
  // limit can be an integer >=1 or the string 'all'
  query('limit').optional().customSanitizer(v => (String(v).toLowerCase() === 'all' ? 'all' : v)).custom(v => {
    if (v === 'all') return true;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 1;
  }).withMessage('limit must be a positive integer or "all"'),
  query('page').optional().toInt().isInt({ min: 1 }),
  query('cursor').optional().isString(),
  query('generationType').optional().isIn([
    'text-to-image','logo','sticker-generation','text-to-video','text-to-music',
    'mockup-generation','product-generation','ad-generation','live-chat'
  ]),
  query('status').optional().isIn(['generating','completed','failed']),
  query('sortBy').optional().isIn(['createdAt','updatedAt','prompt']),
  query('sortOrder').optional().isIn(['asc','desc']),
  query('createdBy').optional().isString(),
];

export const validateGenerationId = [
  param('generationId').isString().notEmpty(),
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
