import { query } from 'express-validator';

export const validateLibrary = [
  query('limit').optional().toInt().isInt({ min: 1, max: 100 }),
  query('cursor').optional().isString(),
  query('nextCursor').optional().isString(),
  query('mode').optional().isIn(['video', 'image', 'music', 'branding', 'all']),
];

export const validateUploads = [
  query('limit').optional().toInt().isInt({ min: 1, max: 100 }),
  query('cursor').optional().isString(),
  query('nextCursor').optional().isString(),
  query('mode').optional().isIn(['video', 'image', 'music', 'branding', 'all']),
];

