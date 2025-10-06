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

export function validateReplicateGenerate(req: Request, _res: Response, next: NextFunction) {
  const { prompt, model, size, width, height, aspect_ratio, max_images, image_input, sequential_image_generation } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return next(new ApiError('prompt is required', 400));
  if (model && typeof model !== 'string') return next(new ApiError('model must be string', 400));
  // Seedream-specific validations (soft)
  if (size != null && !['1K', '2K', '4K', 'custom'].includes(String(size))) return next(new ApiError("size must be one of '1K' | '2K' | '4K' | 'custom'", 400));
  if (width != null && (typeof width !== 'number' || width < 1024 || width > 4096)) return next(new ApiError('width must be 1024-4096', 400));
  if (height != null && (typeof height !== 'number' || height < 1024 || height > 4096)) return next(new ApiError('height must be 1024-4096', 400));
  if (aspect_ratio != null && !['match_input_image','1:1','4:3','3:4','16:9','9:16','3:2','2:3','21:9'].includes(String(aspect_ratio))) return next(new ApiError('invalid aspect_ratio', 400));
  if (max_images != null && (typeof max_images !== 'number' || max_images < 1 || max_images > 15)) return next(new ApiError('max_images must be 1-15', 400));
  if (sequential_image_generation != null && !['disabled','auto'].includes(String(sequential_image_generation))) return next(new ApiError("sequential_image_generation must be 'disabled' | 'auto'", 400));
  if (image_input != null) {
    if (!Array.isArray(image_input)) return next(new ApiError('image_input must be array of urls', 400));
    if (image_input.length > 10) return next(new ApiError('image_input supports up to 10 images', 400));
    for (const u of image_input) {
      if (typeof u !== 'string') return next(new ApiError('image_input must contain url strings', 400));
    }
  }
  next();
}


