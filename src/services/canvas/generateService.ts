import { CanvasGenerationRequest } from '../../types/canvas';
import { bflService } from '../bflService';
import { falService } from '../falService';
import { replicateService } from '../replicateService';
import { mediaRepository } from '../../repository/canvas/mediaRepository';
import { uploadFromUrlToZata } from '../../utils/storage/zataUpload';
import { ApiError } from '../../utils/errorHandler';

/**
 * Convert width/height to a valid aspect ratio string
 */
function calculateAspectRatio(width?: number, height?: number): string {
  if (!width || !height) return '1:1';
  
  const ratio = width / height;
  
  // Map to closest standard aspect ratio
  if (Math.abs(ratio - 1) < 0.1) return '1:1';
  if (Math.abs(ratio - 16/9) < 0.1) return '16:9';
  if (Math.abs(ratio - 9/16) < 0.1) return '9:16';
  if (Math.abs(ratio - 4/3) < 0.1) return '4:3';
  if (Math.abs(ratio - 3/4) < 0.1) return '3:4';
  if (Math.abs(ratio - 3/2) < 0.1) return '3:2';
  if (Math.abs(ratio - 2/3) < 0.1) return '2:3';
  if (Math.abs(ratio - 21/9) < 0.1) return '21:9';
  if (Math.abs(ratio - 9/21) < 0.1) return '9:21';
  if (Math.abs(ratio - 16/10) < 0.1) return '16:10';
  if (Math.abs(ratio - 10/16) < 0.1) return '10:16';
  
  // Default to 1:1 if no match
  return '1:1';
}

export async function generateForCanvas(
  uid: string,
  request: CanvasGenerationRequest
): Promise<{ mediaId: string; url: string; storagePath: string; generationId?: string }> {
  // Determine which service to use based on model
  const modelLower = request.model.toLowerCase();
  let imageUrl: string;
  let generationId: string | undefined;

  try {
    if (modelLower.includes('flux')) {
      // Use BFL service
      // BFL supports width/height directly, or frameSize for standard ratios
      const aspectRatio = calculateAspectRatio(request.width, request.height);
      const bflPayload: any = {
        prompt: request.prompt,
        model: request.model,
        n: 1,
      };
      
      // Use width/height if provided, otherwise use frameSize
      if (request.width && request.height) {
        bflPayload.width = request.width;
        bflPayload.height = request.height;
      } else {
        bflPayload.frameSize = aspectRatio as any;
      }
      
      const result = await bflService.generate(uid, bflPayload);
      
      imageUrl = result.images?.[0]?.url || result.images?.[0]?.originalUrl || '';
      generationId = result.historyId;
    } else if (modelLower.includes('seedream') || modelLower.includes('replicate')) {
      // Use Replicate service
      const aspectRatio = calculateAspectRatio(request.width, request.height);
      const result = await replicateService.generateImage(uid, {
        prompt: request.prompt,
        model: request.model,
        aspect_ratio: aspectRatio,
        ...(request.width && request.height && {
          width: request.width,
          height: request.height,
        }),
      });
      
      imageUrl = result.data?.images?.[0]?.url || result.data?.images?.[0]?.originalUrl || '';
      generationId = result.data?.historyId;
    } else {
      // Use FAL service (default)
      const aspectRatio = calculateAspectRatio(request.width, request.height);
      const result = await falService.generate(uid, {
        prompt: request.prompt,
        model: request.model,
        aspect_ratio: aspectRatio as any,
        num_images: 1,
      } as any);
      
      imageUrl = result.images?.[0]?.url || result.images?.[0]?.originalUrl || '';
      generationId = result.historyId;
    }

    if (!imageUrl) {
      throw new ApiError('Failed to generate image', 500);
    }

    // Upload to Zata
    const username = uid; // Use UID as fallback
    const keyPrefix = `canvas/${request.meta.projectId}`;
    const zataResult = await uploadFromUrlToZata({
      sourceUrl: imageUrl,
      keyPrefix,
      fileName: `${Date.now()}`,
    });

    // Create media record
    const media = await mediaRepository.createMedia({
      url: zataResult.publicUrl,
      storagePath: zataResult.key,
      origin: 'canvas',
      projectId: request.meta.projectId,
      referencedByCount: 0, // Will be incremented when element references it
      metadata: {
        width: request.width,
        height: request.height,
        format: 'jpg',
      },
    });

    return {
      mediaId: media.id,
      url: zataResult.publicUrl,
      storagePath: zataResult.key,
      generationId,
    };
  } catch (error: any) {
    throw new ApiError(
      error.message || 'Generation failed',
      error.statusCode || 500
    );
  }
}

export const generateService = {
  generateForCanvas,
};