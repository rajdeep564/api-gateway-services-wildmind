import { CanvasGenerationRequest } from '../../types/canvas';
import { bflService } from '../bflService';
import { falService, falQueueService } from '../falService';
import { replicateService } from '../replicateService';
import { minimaxService } from '../minimaxService';
import { runwayService } from '../runwayService';
import { mediaRepository } from '../../repository/canvas/mediaRepository';
import { uploadFromUrlToZata } from '../../utils/storage/zataUpload';
import { ApiError } from '../../utils/errorHandler';
import { authRepository } from '../../repository/auth/authRepository';
import { generationHistoryRepository } from '../../repository/generationHistoryRepository';
import { env } from '../../config/env';

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
): Promise<{ mediaId: string; url: string; storagePath: string; generationId?: string; images?: Array<{ mediaId: string; url: string; storagePath: string }> }> {
  // Map frontend model name to backend model name and service
  const { service, backendModel } = mapModelToBackend(request.model);
  
  // Debug logging
  console.log('[generateForCanvas] Model mapping:', {
    frontend: request.model,
    backend: backendModel,
    service,
  });
  
  const imageCount = request.imageCount || 1;
  const clampedImageCount = Math.max(1, Math.min(4, imageCount)); // Limit to 1-4 images
  
  let imageUrl: string;
  let imageStoragePath: string | undefined;
  let generationId: string | undefined;
  let allImages: Array<{ mediaId: string; url: string; storagePath: string }> = [];

  try {
    // Use provided aspectRatio or calculate from width/height
    const aspectRatio = request.aspectRatio || calculateAspectRatio(request.width, request.height);
    const creator = await authRepository.getUserById(uid);
    const username = creator?.username || uid;
    const canvasKeyPrefix = `users/${username}/canvas/${request.meta.projectId}`;
    
    if (service === 'bfl') {
      // Use BFL service for Flux models
      // BFL supports width/height directly, or frameSize for standard ratios
      const bflPayload: any = {
        prompt: request.prompt,
        model: backendModel, // Use mapped backend model name
        n: clampedImageCount, // Pass imageCount to generate multiple images
        storageKeyPrefixOverride: canvasKeyPrefix,
      };
      
      // Use width/height if provided, otherwise use frameSize from aspectRatio
      if (request.width && request.height) {
        bflPayload.width = request.width;
        bflPayload.height = request.height;
      } else {
        bflPayload.frameSize = aspectRatio as any;
      }
      
      const result = await bflService.generate(uid, bflPayload);
      
      // Handle multiple images from BFL
      if (clampedImageCount > 1 && result.images && result.images.length > 0) {
        // Process all generated images
        for (const img of result.images) {
          const imgUrl = img.url || img.originalUrl || '';
          const imgStoragePath = (img as any).storagePath;
          
          // Ensure we have a Zata-stored URL
          let finalUrl = imgUrl;
          let finalKey = imgStoragePath || '';
          if (!finalKey || !(finalUrl || '').includes('/users/')) {
            const zataResult = await uploadFromUrlToZata({
              sourceUrl: imgUrl,
              keyPrefix: canvasKeyPrefix,
              fileName: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            });
            finalUrl = zataResult.publicUrl;
            finalKey = zataResult.key;
          }
          
          // Create media record for each image
          const media = await mediaRepository.createMedia({
            url: finalUrl,
            storagePath: finalKey,
            origin: 'canvas',
            projectId: request.meta.projectId,
            referencedByCount: 0,
            metadata: {
              width: request.width,
              height: request.height,
              format: 'jpg',
            },
          });
          
          allImages.push({
            mediaId: media.id,
            url: finalUrl,
            storagePath: finalKey,
          });
        }
        
        // Return first image for backward compatibility, plus all images
        imageUrl = allImages[0]?.url || '';
        imageStoragePath = allImages[0]?.storagePath;
      } else {
        // Single image (backward compatible)
      imageUrl = result.images?.[0]?.url || result.images?.[0]?.originalUrl || '';
      imageStoragePath = (result as any)?.images?.[0]?.storagePath;
      }
      
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
        storageKeyPrefixOverride: canvasKeyPrefix,
        ...(request.width && request.height && {
          width: request.width,
          height: request.height,
        }),
      });
      
      imageUrl = (result as any)?.images?.[0]?.url || (result as any)?.images?.[0]?.originalUrl || '';
      imageStoragePath = (result as any)?.images?.[0]?.storagePath;
      generationId = result.data?.historyId;
    } else {
      // Use FAL service (default for Google Nano Banana, Seedream v4, Imagen)
      const result = await falService.generate(uid, {
        prompt: request.prompt,
        model: backendModel, // Use mapped backend model name
        aspect_ratio: aspectRatio as any,
        num_images: clampedImageCount, // Pass imageCount to generate multiple images
        storageKeyPrefixOverride: canvasKeyPrefix,
        forceSyncUpload: true,
      } as any);
      
      // Handle multiple images from FAL
      // When imageCount > 1, FAL service returns all images in result.images array
      // FAL service creates parallel promises, each generating 1 image, then returns all in images array
      console.log(`[generateForCanvas] FAL service called with num_images: ${clampedImageCount}`);
      console.log(`[generateForCanvas] FAL result.images:`, result.images ? `${result.images.length} images` : 'no images array');
      
      if (clampedImageCount > 1) {
        // Ensure we have images array - FAL should return all images when num_images > 1
        const falImages = result.images && Array.isArray(result.images) && result.images.length > 0 
          ? result.images 
          : [];
        
        console.log(`[generateForCanvas] Processing ${falImages.length} images (requested ${clampedImageCount})`);
        
        if (falImages.length === 0) {
          console.warn(`[generateForCanvas] WARNING: Requested ${clampedImageCount} images but FAL returned 0 images. Result:`, JSON.stringify(result, null, 2));
        }
        
        // Process all generated images
        for (const img of falImages) {
          const imgUrl = img.url || img.originalUrl || '';
          const imgStoragePath = (img as any).storagePath;
          
          // Ensure we have a Zata-stored URL
          let finalUrl = imgUrl;
          let finalKey = imgStoragePath || '';
          if (!finalKey || !(finalUrl || '').includes('/users/')) {
            const zataResult = await uploadFromUrlToZata({
              sourceUrl: imgUrl,
              keyPrefix: canvasKeyPrefix,
              fileName: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            });
            finalUrl = zataResult.publicUrl;
            finalKey = zataResult.key;
          }
          
          // Create media record for each image
          const media = await mediaRepository.createMedia({
            url: finalUrl,
            storagePath: finalKey,
            origin: 'canvas',
            projectId: request.meta.projectId,
            referencedByCount: 0,
            metadata: {
              width: request.width,
              height: request.height,
              format: 'jpg',
            },
          });
          
          allImages.push({
            mediaId: media.id,
            url: finalUrl,
            storagePath: finalKey,
          });
        }
        
        // Return first image for backward compatibility, plus all images
        imageUrl = allImages[0]?.url || '';
        imageStoragePath = allImages[0]?.storagePath;
      } else {
        // Single image (backward compatible)
      imageUrl = result.images?.[0]?.url || result.images?.[0]?.originalUrl || '';
      imageStoragePath = (result as any)?.images?.[0]?.storagePath;
      }
      
      generationId = result.historyId;
    }

    // If we already processed multiple images, return them
    if (allImages.length > 0) {
      return {
        mediaId: allImages[0].mediaId,
        url: allImages[0].url,
        storagePath: allImages[0].storagePath,
        generationId,
        images: allImages,
      };
    }

    // Single image path (backward compatible)
    if (!imageUrl) {
      throw new ApiError('Failed to generate image', 500);
    }

    // Ensure we have a Zata-stored URL under canvas path; if provider didn't return storagePath, upload once
    let finalUrl = imageUrl;
    let finalKey = imageStoragePath || '';
    if (!finalKey || !(finalUrl || '').includes('/users/')) {
      const zataResult = await uploadFromUrlToZata({
        sourceUrl: imageUrl,
        keyPrefix: canvasKeyPrefix,
        fileName: `${Date.now()}`,
      });
      finalUrl = zataResult.publicUrl;
      finalKey = zataResult.key;
    }

    // Create media record
    const media = await mediaRepository.createMedia({
      url: finalUrl,
      storagePath: finalKey,
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
      url: finalUrl,
      storagePath: finalKey,
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
 * Map frontend video model names to backend service and configuration
 */
interface VideoModelConfig {
  service: 'fal' | 'replicate' | 'minimax' | 'runway';
  method: string; // Service method name
  backendModel?: string; // Backend model identifier
  isFast?: boolean; // For models with fast variants
  mode?: string; // For Kling (standard/pro) and Runway (text_to_video/image_to_video)
}

function mapVideoModelToBackend(frontendModel: string): VideoModelConfig {
  const modelLower = frontendModel.toLowerCase().trim();
  
  // FAL Models
  if (modelLower.includes('sora 2 pro') || modelLower === 'sora 2 pro') {
    return { service: 'fal', method: 'sora2ProT2vSubmit', backendModel: 'fal-ai/sora-2/text-to-video/pro' };
  }
  if (modelLower.includes('veo 3.1 fast') || modelLower.includes('veo 3.1 fast') || modelLower === 'veo 3.1 fast') {
    return { service: 'fal', method: 'veo31TtvSubmit', backendModel: 'fal-ai/veo3.1/fast', isFast: true };
  }
  if (modelLower.includes('veo 3.1') || modelLower.includes('veo 3.1') || modelLower === 'veo 3.1') {
    return { service: 'fal', method: 'veo31TtvSubmit', backendModel: 'fal-ai/veo3.1', isFast: false };
  }
  if (modelLower.includes('veo 3 fast pro') || modelLower === 'veo 3 fast pro') {
    return { service: 'fal', method: 'veoTtvSubmit', backendModel: 'fal-ai/veo3/fast', isFast: true };
  }
  if (modelLower.includes('veo 3 pro') || modelLower === 'veo 3 pro') {
    return { service: 'fal', method: 'veoTtvSubmit', backendModel: 'fal-ai/veo3', isFast: false };
  }
  if (modelLower.includes('ltx v2 fast') || modelLower === 'ltx v2 fast') {
    return { service: 'fal', method: 'ltx2FastT2vSubmit', backendModel: 'fal-ai/ltxv-2/text-to-video/fast', isFast: true };
  }
  if (modelLower.includes('ltx v2 pro') || modelLower === 'ltx v2 pro') {
    return { service: 'fal', method: 'ltx2ProT2vSubmit', backendModel: 'fal-ai/ltxv-2/text-to-video', isFast: false };
  }
  
  // Replicate Models
  if (modelLower.includes('seedance 1.0 lite') || modelLower === 'seedance 1.0 lite') {
    return { service: 'replicate', method: 'seedanceT2vSubmit', backendModel: 'bytedance/seedance-1-lite' };
  }
  if (modelLower.includes('seedance 1.0 pro') || modelLower === 'seedance 1.0 pro' || modelLower.includes('seedance')) {
    return { service: 'replicate', method: 'seedanceT2vSubmit', backendModel: 'bytedance/seedance-1-pro' };
  }
  if (modelLower.includes('pixverse v5') || modelLower === 'pixverse v5' || modelLower.includes('pixverse')) {
    return { service: 'replicate', method: 'pixverseT2vSubmit', backendModel: 'pixverseai/pixverse-v5' };
  }
  if (modelLower.includes('wan 2.5 fast') || modelLower === 'wan 2.5 fast') {
    return { service: 'replicate', method: 'wanT2vSubmit', backendModel: 'wan-video/wan-2.5-t2v-fast', isFast: true };
  }
  if (modelLower.includes('wan 2.5') || modelLower === 'wan 2.5' || modelLower.includes('wan')) {
    return { service: 'replicate', method: 'wanT2vSubmit', backendModel: 'wan-video/wan-2.5-t2v', isFast: false };
  }
  if (modelLower.includes('kling 2.5 turbo pro') || modelLower === 'kling 2.5 turbo pro') {
    return { service: 'replicate', method: 'klingT2vSubmit', backendModel: 'kwaivgi/kling-v2.5-turbo-pro', mode: 'pro' };
  }
  // Catch-all for any other Kling models (should not happen after removing 2.1 models)
  if (modelLower.includes('kling')) {
    console.warn(`[mapVideoModelToBackend] Unsupported Kling model "${frontendModel}", defaulting to Kling 2.5 Turbo Pro`);
    return { service: 'replicate', method: 'klingT2vSubmit', backendModel: 'kwaivgi/kling-v2.5-turbo-pro', mode: 'pro' };
  }
  
  // MiniMax Models
  if (modelLower.includes('minimax-hailuo-02') || modelLower === 'minimax-hailuo-02' || modelLower.includes('hailuo')) {
    return { service: 'minimax', method: 'generateVideo', backendModel: 'MiniMax-Hailuo-02' };
  }
  if (modelLower.includes('t2v-01-director') || modelLower === 't2v-01-director') {
    return { service: 'minimax', method: 'generateVideo', backendModel: 'T2V-01-Director' };
  }
  if (modelLower.includes('i2v-01-director') || modelLower === 'i2v-01-director') {
    return { service: 'minimax', method: 'generateVideo', backendModel: 'I2V-01-Director' };
  }
  if (modelLower.includes('s2v-01') || modelLower === 's2v-01') {
    return { service: 'minimax', method: 'generateVideo', backendModel: 'S2V-01' };
  }
  
  // Runway Models
  if (modelLower.includes('gen-4 turbo') || modelLower === 'gen-4 turbo') {
    return { service: 'runway', method: 'videoGenerate', backendModel: 'gen4_turbo', mode: 'text_to_video' };
  }
  if (modelLower.includes('gen-3a turbo') || modelLower === 'gen-3a turbo') {
    return { service: 'runway', method: 'videoGenerate', backendModel: 'gen3a_turbo', mode: 'text_to_video' };
  }
  
  // Default to Seedance Pro if model not recognized
  console.warn(`[mapVideoModelToBackend] Unknown model "${frontendModel}", defaulting to Seedance 1.0 Pro`);
  return { service: 'replicate', method: 'seedanceT2vSubmit', backendModel: 'bytedance/seedance-1-pro' };
}

/**
 * Generate video for Canvas - supports all 21 video generation models
 * Routes to FAL, Replicate, MiniMax, or Runway based on model name
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
    firstFrameUrl?: string;
    lastFrameUrl?: string;
  }
): Promise<{ mediaId: string; url: string; storagePath: string; generationId?: string; taskId?: string; provider?: string }> {
  if (!request.prompt) {
    throw new ApiError('Prompt is required', 400);
  }
  if (!request.model) {
    throw new ApiError('Model is required', 400);
  }

  const modelConfig = mapVideoModelToBackend(request.model);
  const aspectRatio = request.aspectRatio || '16:9';
  const duration = request.duration || 5;
  const resolution = request.resolution || '1080p';

  console.log('[generateVideoForCanvas] Request received:', {
    userId: uid,
    model: request.model,
    hasPrompt: !!request.prompt,
    hasMeta: !!(request.aspectRatio || request.duration || request.resolution),
    projectId: request.projectId,
    hasFirstFrame: !!request.firstFrameUrl,
    hasLastFrame: !!request.lastFrameUrl,
  });

  console.log('[generateVideoForCanvas] Model mapping:', {
    frontend: request.model,
    service: modelConfig.service,
    method: modelConfig.method,
    backendModel: modelConfig.backendModel,
  });

  try {
    let result: any;
    const isVeo31Model = modelConfig.method?.startsWith('veo31');
    const hasFirstLastFrames = Boolean(isVeo31Model && request.firstFrameUrl && request.lastFrameUrl);
    const hasSingleFrame = Boolean(isVeo31Model && request.firstFrameUrl && !request.lastFrameUrl);

    // Route to appropriate service
    if (modelConfig.service === 'fal') {
      if (!falQueueService) {
        throw new ApiError('FAL queue service not available', 500);
      }
      const method = falQueueService[modelConfig.method as keyof typeof falQueueService];
      if (!method) {
        throw new ApiError(`FAL method ${modelConfig.method} not available`, 500);
      }

      // Prepare FAL payload
      const falPayload: any = {
        prompt: request.prompt,
        aspect_ratio: aspectRatio,
        resolution: resolution,
        isPublic: false,
      };

      // FAL Sora 2 expects duration as number, Veo expects as string "8s"
      const isSora2 = modelConfig.method.includes('sora2');
      const isLtx = modelConfig.method.includes('ltx');
      if (isSora2 || isLtx) {
        falPayload.duration = duration; // Number for Sora 2 and LTX
      } else {
        falPayload.duration = `${duration}s`; // String for Veo models
      }

      if (hasFirstLastFrames) {
        falPayload.first_frame_url = request.firstFrameUrl;
        falPayload.last_frame_url = request.lastFrameUrl;
        falPayload.start_image_url = request.firstFrameUrl;
        falPayload.last_frame_image_url = request.lastFrameUrl;
      } else if (hasSingleFrame) {
        falPayload.image_url = request.firstFrameUrl;
      }

      // Call FAL service method
      // Some methods take fast parameter, others don't
      if (hasFirstLastFrames) {
        const firstLastMethodName = modelConfig.isFast ? 'veo31FirstLastFastSubmit' : 'veo31FirstLastSubmit';
        const firstLastMethod = falQueueService[firstLastMethodName as keyof typeof falQueueService];
        if (!firstLastMethod) {
          throw new ApiError(`FAL method ${firstLastMethodName} not available`, 500);
        }
        result = await (firstLastMethod as any)(uid, falPayload);
      } else if (hasSingleFrame) {
        const i2vMethod = falQueueService.veo31I2vSubmit;
        if (!i2vMethod) {
          throw new ApiError('FAL method veo31I2vSubmit not available', 500);
        }
        result = await (i2vMethod as any)(uid, falPayload, modelConfig.isFast ?? false);
      } else if (modelConfig.method === 'veo31TtvSubmit' || modelConfig.method === 'veo31I2vSubmit') {
        // Veo 3.1 methods take fast parameter
        result = await (method as any)(uid, falPayload, modelConfig.isFast ?? false);
      } else if (modelConfig.method === 'veoTtvSubmit' || modelConfig.method === 'veoI2vSubmit') {
        // Veo 3 methods take fast parameter
        result = await (method as any)(uid, falPayload, modelConfig.isFast ?? false);
      } else {
        // Sora 2 and LTX methods don't take fast parameter
        result = await (method as any)(uid, falPayload);
      }

    } else if (modelConfig.service === 'replicate') {
      const replicate = replicateService as any;
      const method = replicate[modelConfig.method];
      if (!method) {
        throw new ApiError(`Replicate method ${modelConfig.method} not available`, 500);
      }

      // Prepare Replicate payload
      const replicatePayload: any = {
      prompt: request.prompt,
        model: modelConfig.backendModel, // Pass backend model name (e.g., 'kwaivgi/kling-v2.1')
        duration: duration,
      aspect_ratio: aspectRatio,
        isPublic: false,
      };

      // PixVerse uses "quality" instead of "resolution" for T2V (no image/frame parameters)
      if (modelConfig.method === 'pixverseT2vSubmit') {
        replicatePayload.quality = resolution;
        replicatePayload.resolution = resolution; // Also pass resolution for compatibility
        // Ensure no image/frame parameters are passed for T2V
        delete replicatePayload.image;
        delete replicatePayload.start_image;
        delete replicatePayload.first_frame;
      } else {
        replicatePayload.resolution = resolution;
      }

      // WAN uses "size" parameter derived from resolution and aspect ratio
      if (modelConfig.method === 'wanT2vSubmit') {
        // Map resolution + aspect ratio to WAN size format
        // Valid sizes: "1280*720", "720*1280", "1920*1080", "1080*1920"
        let wanSize = '1280*720'; // Default
        
        if (resolution === '720p') {
          // 720p: 16:9 = 1280*720, 9:16 = 720*1280, 1:1 = 1280*720 (use 16:9 format)
          if (aspectRatio === '9:16') {
            wanSize = '720*1280';
          } else {
            wanSize = '1280*720'; // 16:9 or 1:1
          }
        } else if (resolution === '1080p') {
          // 1080p: 16:9 = 1920*1080, 9:16 = 1080*1920, 1:1 = 1920*1080 (use 16:9 format)
          if (aspectRatio === '9:16') {
            wanSize = '1080*1920';
          } else {
            wanSize = '1920*1080'; // 16:9 or 1:1
          }
        } else if (resolution === '480p') {
          // 480p is not supported by WAN, fallback to 720p
          wanSize = aspectRatio === '9:16' ? '720*1280' : '1280*720';
        }
        
        replicatePayload.size = wanSize;
      }

      // Add mode for Kling models
      if (modelConfig.mode) {
        replicatePayload.mode = modelConfig.mode;
      }

      // Add speed for WAN fast models
      if (modelConfig.isFast && modelConfig.method === 'wanT2vSubmit') {
        replicatePayload.speed = 'fast';
      }

      result = await method(uid, replicatePayload);

    } else if (modelConfig.service === 'minimax') {
      const minimax = minimaxService as any;
      const method = minimax.generateVideo; // Use generateVideo method
      if (!method) {
        throw new ApiError('MiniMax generateVideo method not available', 500);
      }

      // Prepare MiniMax payload (needs apiKey and groupId)
      const apiKey = env.minimaxApiKey as string;
      const groupId = env.minimaxGroupId as string;
      if (!apiKey || !groupId) {
        throw new ApiError('MiniMax API key or group ID not configured', 500);
      }

      // MiniMax-Hailuo-02: 512P is only supported with first_frame_image (I2V)
      // For text-to-video, we need to use 768P or 1080P instead
      let validResolution = resolution;
      if (modelConfig.backendModel === 'MiniMax-Hailuo-02' && resolution === '512P') {
        // Default to 768P for T2V when 512P is selected
        validResolution = '768P';
        // eslint-disable-next-line no-console
        console.log('[generateVideoForCanvas] MiniMax-Hailuo-02: 512P not supported for T2V, using 768P instead');
      }

      const minimaxPayload: any = {
        model: modelConfig.backendModel,
        prompt: request.prompt,
        duration: duration,
        resolution: validResolution,
        generationType: 'text-to-video',
        isPublic: false,
      };

      // MiniMax generateVideo takes (apiKey, groupId, body)
      const taskResult = await method(apiKey, groupId, minimaxPayload);
      
      // Create history entry (similar to minimaxController.videoStart)
      const creator = await authRepository.getUserById(uid);
      const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: request.prompt,
        model: modelConfig.backendModel || 'MiniMax-Hailuo-02',
        generationType: 'text-to-video',
        visibility: 'private',
        isPublic: false,
        createdBy: { uid, username: creator?.username, email: (creator as any)?.email },
        duration: duration,
        resolution: resolution,
      } as any);
      
      await generationHistoryRepository.update(uid, historyId, {
        provider: 'minimax',
        providerTaskId: taskResult.taskId,
      } as any);

      result = {
        requestId: taskResult.taskId,
        historyId,
        model: modelConfig.backendModel,
        status: 'submitted',
      };

    } else if (modelConfig.service === 'runway') {
      const runway = runwayService as any;
      const method = runway.videoGenerate;
      if (!method) {
        throw new ApiError('Runway videoGenerate method not available', 500);
      }

      // Convert aspect ratio from "16:9" to "1280:720" format for Runway
      // Runway Gen-4 Turbo supports: 1280:720, 720:1280, 1104:832, 832:1104, 960:960, 1584:672
      // Runway Gen-3a Turbo supports: 1280:768, 768:1280
      // Runway Veo3 supports: 1280:720, 720:1280
      const ratioMap: Record<string, Record<string, string>> = {
        'gen4_turbo': {
          '16:9': '1280:720',
          '9:16': '720:1280',
          '1:1': '960:960',
          '4:3': '1104:832',
          '3:4': '832:1104',
        },
        'gen3a_turbo': {
          '16:9': '1280:768',
          '9:16': '768:1280',
        },
      };
      const modelRatioMap = ratioMap[modelConfig.backendModel || 'gen4_turbo'] || ratioMap['gen4_turbo'];
      const runwayRatio = modelRatioMap[aspectRatio] || modelRatioMap['16:9'] || '1280:720';

      // Prepare Runway payload
      const runwayPayload: any = {
        mode: modelConfig.mode || 'text_to_video',
        [modelConfig.mode || 'text_to_video']: {
          model: modelConfig.backendModel,
          promptText: request.prompt,
          ratio: runwayRatio,
          duration: duration,
        },
        isPublic: false,
      };

      result = await method(uid, runwayPayload);
    } else {
      throw new ApiError(`Unknown service: ${modelConfig.service}`, 500);
    }

    // Attach canvas project linkage
    try {
      if (result?.historyId && request.projectId) {
        await generationHistoryRepository.update(uid, result.historyId, { canvasProjectId: request.projectId } as any);
      }
    } catch (e) {
      console.warn('[generateVideoForCanvas] Failed to tag history with canvasProjectId', e);
    }

    // Return result (queue-based generation returns taskId)
    // Include provider/service info so frontend knows which endpoint to poll
    return {
      mediaId: '', // Will be set when video is ready
      url: '', // Will be set when video is ready
      storagePath: '', // Will be set when video is ready
      generationId: result.historyId,
      taskId: result.requestId || result.taskId, // Provider task ID
      provider: modelConfig.service, // 'fal', 'replicate', 'minimax', or 'runway'
    };
  } catch (error: any) {
    console.error('[generateVideoForCanvas] Service error:', {
      message: error.message,
      statusCode: error.statusCode,
      stack: error.stack,
      model: request.model,
      service: modelConfig.service,
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