import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';

export function validateUpscale(req: Request, _res: Response, next: NextFunction) {
  const { image, model, scale, face_enhance, task } = req.body || {};
  if (!image || typeof image !== 'string') return next(new ApiError('image is required (url)', 400));
  if (model && typeof model !== 'string') return next(new ApiError('model must be string', 400));
  if (scale != null && (typeof scale !== 'number' || scale < 0 || scale > 10)) return next(new ApiError('scale must be 0-10', 400));
  if (face_enhance != null && typeof face_enhance !== 'boolean') return next(new ApiError('face_enhance must be boolean', 400));
  if (task != null) {
    if (typeof task !== 'string') return next(new ApiError('task must be string', 400));
    const allowed = new Set(['classical_sr','real_sr','compressed_sr']);
    if (!allowed.has(String(task))) return next(new ApiError("task must be one of 'classical_sr' | 'real_sr' | 'compressed_sr'", 400));
  }
  next();
}
