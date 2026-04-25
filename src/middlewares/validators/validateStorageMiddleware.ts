import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../utils/errorHandler';
import { validateGenerationRequest, estimateFileSize } from '../../utils/validationHelpers';

/**
 * Middleware factory to validate storage limit before generation
 * Must be placed AFTER `makeCreditCost` middleware which sets req.context.creditCost
 * 
 * @param outputType - Type of output to estimate size for ('image' | 'video' | 'audio')
 */
export function validateStorage(outputType: 'image' | 'video' | 'audio') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uid = (req as any).uid;
      const context = (req as any).context;
      
      if (!uid) {
        throw new ApiError('Unauthorized: User ID missing', 401);
      }

      // creditCost might be 0 for free/turbo models, but we still check storage
      const creditCost = context?.creditCost ?? 0;

      // Estimate file size based on type and typical defaults
      // (Advanced: could parse req.body for resolution/duration to refine estimate)
      let estimatedSize = 0;
      if (outputType === 'image') {
        estimatedSize = estimateFileSize('image', { quality: 'medium' }); // ~1-2MB
      } else if (outputType === 'video') {
         // Default to 10s video estimate if body not parsed, or use body if available
         const duration = req.body?.duration || 10;
         estimatedSize = estimateFileSize('video', { duration });
      } else {
        estimatedSize = 5 * 1024 * 1024; // Audio ~5MB
      }
      
      const modelName = req.body?.model || context?.modelName || context?.meta?.model;
      const quantity = req.body?.num_images || req.body?.n || req.body?.max_images || context?.meta?.n || 1;
      
      const validation = await validateGenerationRequest(uid, creditCost, estimatedSize, modelName, quantity);

      if (!validation.valid) {
        // Map error codes to HTTP status
        const status = validation.code === 'STORAGE_QUOTA_EXCEEDED' ? 507 
                     : validation.code === 'INSUFFICIENT_CREDITS' ? 402 
                     : 400;
        
        throw new ApiError(
          validation.reason || 'Validation failed', 
          status, 
          { code: validation.code }
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
