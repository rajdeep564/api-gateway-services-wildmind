import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';

/**
 * Validator for new Turbo model (placeholder - update model name)
 * Schema supports: prompt, width, height, num_inference_steps, guidance_scale, seed, output_format, output_quality
 */
export function validateNewTurboModel(req: Request, _res: Response, next: NextFunction) {
  const { prompt, width, height, num_inference_steps, guidance_scale, seed, output_format, output_quality } = req.body || {};
  
  if (!prompt || typeof prompt !== 'string') {
    return next(new ApiError('prompt is required', 400));
  }

  // Width validation: 64-2048, default 1024
  if (width != null) {
    if (typeof width !== 'number' || !Number.isInteger(width) || width < 64 || width > 2048) {
      return next(new ApiError('width must be an integer between 64 and 2048', 400));
    }
  }

  // Height validation: 64-2048, default 1024
  if (height != null) {
    if (typeof height !== 'number' || !Number.isInteger(height) || height < 64 || height > 2048) {
      return next(new ApiError('height must be an integer between 64 and 2048', 400));
    }
  }

  // Num inference steps validation: 1-50, default 8
  if (num_inference_steps != null) {
    if (typeof num_inference_steps !== 'number' || !Number.isInteger(num_inference_steps) || num_inference_steps < 1 || num_inference_steps > 50) {
      return next(new ApiError('num_inference_steps must be an integer between 1 and 50', 400));
    }
  }

  // Guidance scale validation: 0-50, default 50
  if (guidance_scale != null) {
    if (typeof guidance_scale !== 'number' || guidance_scale < 0 || guidance_scale > 50) {
      return next(new ApiError('guidance_scale must be a number between 0 and 50', 400));
    }
  }

  // Seed validation: nullable integer
  if (seed != null) {
    if (typeof seed !== 'number' || !Number.isInteger(seed)) {
      return next(new ApiError('seed must be an integer', 400));
    }
  }

  // Output format validation: png, jpg, webp, default jpg
  if (output_format != null) {
    if (!['png', 'jpg', 'webp'].includes(String(output_format))) {
      return next(new ApiError('output_format must be one of: png, jpg, webp', 400));
    }
  }

  // Output quality validation: 0-100, default 80
  if (output_quality != null) {
    if (typeof output_quality !== 'number' || !Number.isInteger(output_quality) || output_quality < 0 || output_quality > 100) {
      return next(new ApiError('output_quality must be an integer between 0 and 100', 400));
    }
  }

  next();
}

