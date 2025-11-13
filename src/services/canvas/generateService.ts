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

/**
 * Map frontend model names to backend model names
 */
function mapModelToBackend(frontendModel: string): { service: 'bfl' | 'replicate' | 'fal'; backendModel: string } {
  const modelLower = frontendModel.toLowerCase().trim();
  
  // Replicate Seedream 4K - MUST check this FIRST before general seedream check
  // Check for "seedream" + "4k" or "4 k" or "v4 4k" patterns
  if (modelLower.includes('seedream') && (
    modelLower.includes('4k') || 
    modelLower.includes('4 k') || 
    (modelLower.includes('v4') && modelLower.includes('4k'))
  )) {
    return { service: 'replicate', backendModel: 'bytedance/seedream-4' };
  }
  
  // BFL Flux models - check in order of specificity
  if (modelLower.includes('flux-pro-1.1-ultra') || modelLower.includes('pro 1.1 ultra')) {
    return { service: 'bfl', backendModel: 'flux-pro-1.1-ultra' };
  }
  if (modelLower.includes('flux-pro-1.1') || (modelLower.includes('pro 1.1') && !modelLower.includes('ultra'))) {
    return { service: 'bfl', backendModel: 'flux-pro-1.1' };
  }
  if (modelLower.includes('flux-kontext-max') || modelLower.includes('kontext max')) {
    return { service: 'bfl', backendModel: 'flux-kontext-max' };
  }
  if (modelLower.includes('flux-kontext-pro') || modelLower.includes('kontext pro')) {
    return { service: 'bfl', backendModel: 'flux-kontext-pro' };
  }
  if (modelLower.includes('flux-dev')) {
    return { service: 'bfl', backendModel: 'flux-dev' };
  }
  if (modelLower.includes('flux-pro') && !modelLower.includes('1.1')) {
    return { service: 'bfl', backendModel: 'flux-pro' };
  }
  if (modelLower.includes('flux')) {
    // Default to flux-pro for generic "flux" mentions
    return { service: 'bfl', backendModel: 'flux-pro' };
  }
  
  // FAL models - check in order of specificity
  if (modelLower.includes('imagen-4-ultra') || modelLower.includes('imagen 4 ultra')) {
    return { service: 'fal', backendModel: 'imagen-4-ultra' };
  }
  if (modelLower.includes('imagen-4-fast') || modelLower.includes('imagen 4 fast')) {
    return { service: 'fal', backendModel: 'imagen-4-fast' };
  }
  if ((modelLower.includes('imagen-4') || modelLower.includes('imagen 4')) && !modelLower.includes('ultra') && !modelLower.includes('fast')) {
    return { service: 'fal', backendModel: 'imagen-4' };
  }
  if (modelLower.includes('nano banana') || modelLower.includes('gemini')) {
    return { service: 'fal', backendModel: 'gemini-25-flash-image' };
  }
  if (modelLower.includes('seedream')) {
    // This catches "seedream v4" (without 4K) - goes to FAL
    return { service: 'fal', backendModel: 'seedream-v4' };
  }
  
  // Default to FAL (Google Nano Banana)
  return { service: 'fal', backendModel: 'gemini-25-flash-image' };
}

export async function generateForCanvas(
  uid: string,
  request: CanvasGenerationRequest
): Promise<{ mediaId: string; url: string; storagePath: string; generationId?: string }> {
  // Map frontend model name to backend model name and service
  const { service, backendModel } = mapModelToBackend(request.model);
  
  // Debug logging
  console.log('[generateForCanvas] Model mapping:', {
    frontend: request.model,
    backend: backendModel,
    service,
  });
  
  let imageUrl: string;
  let generationId: string | undefined;

  try {
    // Use provided aspectRatio or calculate from width/height
    const aspectRatio = request.aspectRatio || calculateAspectRatio(request.width, request.height);
    
    if (service === 'bfl') {
      // Use BFL service for Flux models
      // BFL supports width/height directly, or frameSize for standard ratios
      const bflPayload: any = {
        prompt: request.prompt,
        model: backendModel, // Use mapped backend model name
        n: 1,
      };
      
      // Use width/height if provided, otherwise use frameSize from aspectRatio
      if (request.width && request.height) {
        bflPayload.width = request.width;
        bflPayload.height = request.height;
      } else {
        bflPayload.frameSize = aspectRatio as any;
      }
      
      const result = await bflService.generate(uid, bflPayload);
      
      imageUrl = result.images?.[0]?.url || result.images?.[0]?.originalUrl || '';
      generationId = result.historyId;
    } else if (service === 'replicate') {
      // Use Replicate service for Seedream 4K
      // Ensure model is in correct format (owner/name)
      if (!backendModel.includes('/')) {
        console.error('[generateForCanvas] Invalid Replicate model format:', backendModel);
        throw new ApiError(`Invalid model format for Replicate: ${backendModel}. Expected format: owner/name`, 400);
      }
      
      const result = await replicateService.generateImage(uid, {
        prompt: request.prompt,
        model: backendModel, // Use mapped backend model name: 'bytedance/seedream-4'
        aspect_ratio: aspectRatio,
        ...(request.width && request.height && {
          width: request.width,
          height: request.height,
        }),
      });
      
      imageUrl = result.data?.images?.[0]?.url || result.data?.images?.[0]?.originalUrl || '';
      generationId = result.data?.historyId;
    } else {
      // Use FAL service (default for Google Nano Banana, Seedream v4, Imagen)
      const result = await falService.generate(uid, {
        prompt: request.prompt,
        model: backendModel, // Use mapped backend model name
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
    console.error('[generateForCanvas] Service error:', {
      message: error.message,
      statusCode: error.statusCode,
      stack: error.stack,
      service,
      backendModel,
    });
    
    // If it's already an ApiError, re-throw it
    if (error instanceof ApiError) {
      throw error;
    }
    
    // Otherwise, wrap it in an ApiError
    throw new ApiError(
      error.message || 'Generation failed',
      error.statusCode || error.status || 500
    );
  }
}

/**
 * Generate video for Canvas using Seedance 1.0 Pro
 */
export async function generateVideoForCanvas(
  uid: string,
  request: {
    prompt: string;
    model: string;
    aspectRatio?: string;
    duration?: number;
    resolution?: string;
    projectId: string;
    elementId?: string;
  }
): Promise<{ mediaId: string; url: string; storagePath: string; generationId?: string; taskId?: string }> {
  // Seedance 1.0 Pro uses Replicate service
  const replicate = (replicateService as any);
  
  if (!replicate.seedanceT2vSubmit) {
    throw new ApiError('Seedance T2V service not available', 500);
  }

  // Map aspect ratio to Seedance format
  const aspectRatio = request.aspectRatio || '16:9';
  const duration = request.duration || 5; // Default 5 seconds
  const resolution = request.resolution || '1080p'; // Default 1080p

  try {
    // Submit video generation job
    const result = await replicate.seedanceT2vSubmit(uid, {
      prompt: request.prompt,
      model: 'bytedance/seedance-1-pro', // Seedance 1.0 Pro
      duration,
      resolution,
      aspect_ratio: aspectRatio,
      isPublic: false, // Canvas videos are private by default
    });

    // For queue-based generation, we return the taskId
    // The video URL will be available later via polling
    return {
      mediaId: '', // Will be set when video is ready
      url: '', // Will be set when video is ready
      storagePath: '', // Will be set when video is ready
      generationId: result.historyId,
      taskId: result.requestId, // Replicate prediction ID
    };
  } catch (error: any) {
    console.error('[generateVideoForCanvas] Service error:', {
      message: error.message,
      statusCode: error.statusCode,
      stack: error.stack,
    });
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    throw new ApiError(
      error.message || 'Video generation failed',
      error.statusCode || error.status || 500
    );
  }
}

export const generateService = {
  generateForCanvas,
  generateVideoForCanvas,
};