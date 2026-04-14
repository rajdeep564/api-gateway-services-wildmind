import { creditsService } from '../services/creditsService';

/**
 * Validation result for generation requests
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
  code?: string;
}

/**
 * Helper function to validate user has sufficient credits and storage before generation
 * 
 * @param uid - User ID
 * @param creditCost - Credit cost for the generation
 * @param estimatedSizeBytes - Estimated output file size in bytes (default: 10MB)
 * @returns Validation result with error details if invalid
 * 
 * @example
 * ```typescript
 * const validation = await validateGenerationRequest(uid, 500); // 500 credits, default 10MB
 * if (!validation.valid) {
 *   return res.status(validation.code === 'STORAGE_QUOTA_EXCEEDED' ? 402 : 400).json({
 *     error: validation.reason,
 *     code: validation.code,
 *   });
 * }
 * ```
 */
export async function validateGenerationRequest(
  uid: string,
  creditCost: number,
  estimatedSizeBytes: number = 10 * 1024 * 1024 // Default 10MB
): Promise<ValidationResult> {
  try {
    return await creditsService.validateBeforeGeneration(
      uid,
      creditCost,
      estimatedSizeBytes
    );
  } catch (error: any) {
    // If unexpected error, log and return generic error
    console.error('[VALIDATION] Unexpected error during generation validation:', error);
    return {
      valid: false,
      reason: 'Failed to validate generation request. Please try again.',
      code: 'VALIDATION_ERROR',
    };
  }
}

/**
 * Helper function to estimate file size based on generation type and parameters
 * 
 * @param type - Type of generation (image, video, etc.)
 * @param params - Generation parameters (resolution, duration, etc.)
 * @returns Estimated size in bytes
 */
export function estimateFileSize(type: 'image' | 'video', params?: {
  width?: number;
  height?: number;
  duration?: number;
  quality?: 'low' | 'medium' | 'high';
}): number {
  const { width = 1024, height = 1024, duration = 5, quality = 'medium' } = params || {};

  if (type === 'image') {
    // Estimate: pixels * bytes per pixel (JPEG compression factor)
    const pixels = width * height;
    const compressionFactor = quality === 'high' ? 0.5 : quality === 'low' ? 0.1 : 0.25;
    return Math.ceil(pixels * compressionFactor);
  }

  if (type === 'video') {
    // Estimate: bitrate * duration
    // Typical bitrates: low=1Mbps, medium=5Mbps, high=10Mbps
    const bitrate = quality === 'high' ? 10_000_000 : quality === 'low' ? 1_000_000 : 5_000_000;
    return Math.ceil((bitrate / 8) * duration); // Convert bits to bytes
  }

  return 10 * 1024 * 1024; // Default 10MB
}
