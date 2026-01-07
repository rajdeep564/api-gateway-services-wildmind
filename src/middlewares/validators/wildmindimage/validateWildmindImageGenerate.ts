import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';

export function validateWildmindImageGenerate(req: Request, _res: Response, next: NextFunction) {
  const { prompt, model, n, num_images, seed } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return next(new ApiError('prompt is required', 400));
  }

  if (model != null && typeof model !== 'string') {
    return next(new ApiError('model must be a string', 400));
  }

  const resolvedModel = String(model || 'wildmindimage');
  if (resolvedModel !== 'wildmindimage') {
    return next(new ApiError('invalid model for WILDMINDIMAGE endpoint', 400));
  }

  const requested = num_images ?? n;
  if (requested != null) {
    const parsed = Number(requested);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
      return next(new ApiError('n/num_images must be an integer between 1 and 4', 400));
    }
  }

  if (seed != null) {
    const parsedSeed = Number(seed);
    if (!Number.isFinite(parsedSeed) || !Number.isInteger(parsedSeed)) {
      return next(new ApiError('seed must be an integer', 400));
    }
  }

  return next();
}
