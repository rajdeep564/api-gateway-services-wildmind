import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';

export function validateRemoveBg(req: Request, _res: Response, next: NextFunction) {
  const { image, format, reverse, threshold, background_type, model } = req.body || {};
  if (!image || typeof image !== 'string') return next(new ApiError('image is required (url)', 400));
  if (format && !['png', 'jpg', 'jpeg', 'webp'].includes(String(format).toLowerCase())) return next(new ApiError('Invalid format', 400));
  if (reverse != null && typeof reverse !== 'boolean') return next(new ApiError('reverse must be boolean', 400));
  if (threshold != null && (typeof threshold !== 'number' || threshold < 0 || threshold > 1)) return next(new ApiError('threshold must be 0.0-1.0', 400));
  if (background_type != null && typeof background_type !== 'string') return next(new ApiError('background_type must be string', 400));
  if (model && typeof model !== 'string') return next(new ApiError('model must be string', 400));
  next();
}
 


