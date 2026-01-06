import { CanvasGenerationRequest } from '../../types/canvas';
import { bflService } from '../bflService';
import { falService, falQueueService } from '../falService';
import { replicateService } from '../replicateService';
import { minimaxService } from '../minimaxService';
import { runwayService } from '../runwayService';
import { mediaRepository } from '../../repository/canvas/mediaRepository';
import { uploadFromUrlToZata, uploadBufferToZata, uploadDataUriToZata } from '../../utils/storage/zataUpload';
import { ApiError } from '../../utils/errorHandler';
import { authRepository } from '../../repository/auth/authRepository';
import { generationHistoryRepository } from '../../repository/generationHistoryRepository';
import { env } from '../../config/env';
import { probeImageMeta } from '../../utils/media/imageProbe';
import sharp from 'sharp';
import axios from 'axios';
import { createStoryboard, downloadImageAsBuffer, StoryboardFrame } from '../../utils/createStoryboard';
import { Agent as HttpsAgent } from 'https';
import { processGoogleGeminiFlash } from '../replaceService';

// Zata sometimes has TLS issues; proxy route already works around it.
// For server-side downloads (to inline images for Replicate), we use a permissive agent.
const insecureHttpsAgent = new HttpsAgent({ rejectUnauthorized: false, keepAlive: true });

function guessContentTypeFromUrl(url: string): string {
  const lower = (url || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/jpeg';
}

/**
 * Replicate runs remotely and cannot fetch localhost URLs.
 * If the input image URL is a localhost/proxy URL, download it server-side and inline as a data URI.
 */
async function inlineImageForReplicateIfNeeded(imageUrl: string): Promise<{ image: string; wasInlined: boolean }> {
  if (!imageUrl || typeof imageUrl !== 'string') return { image: imageUrl as any, wasInlined: false };

  // Already a data URI? Leave as-is.
  if (imageUrl.startsWith('data:')) return { image: imageUrl, wasInlined: false };

  const isLocalhost =
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//i.test(imageUrl);
  const isProxyResource =
    /\/api\/proxy\/resource\//i.test(imageUrl) || /\/proxy\/resource\//i.test(imageUrl);
  const isZataEndpoint = Boolean(env?.zataEndpoint) && imageUrl.startsWith(String(env.zataEndpoint));

  // Only inline when Replicate wouldn't be able to fetch it reliably.
  if (!isLocalhost && !isProxyResource && !isZataEndpoint) {
    return { image: imageUrl, wasInlined: false };
  }

  try {
    const resp = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      // Only matters for https URLs; safe to include for all.
      httpsAgent: insecureHttpsAgent as any,
      maxContentLength: 25 * 1024 * 1024, // 25MB safety cap
      maxBodyLength: 25 * 1024 * 1024,
      validateStatus: () => true,
    });

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`Failed to download image. Status ${resp.status}`);
    }

    const contentTypeHeader = (resp.headers?.['content-type'] as string | undefined) || '';
    const contentType = contentTypeHeader.split(';')[0] || guessContentTypeFromUrl(imageUrl);
    const base64 = Buffer.from(resp.data).toString('base64');
    const dataUri = `data:${contentType};base64,${base64}`;
    return { image: dataUri, wasInlined: true };
  } catch (e: any) {
    // If we can't inline it, fall back to original URL so caller gets Replicate's error.
    console.warn('[inlineImageForReplicateIfNeeded] Failed to inline image, falling back to URL:', {
      imageUrl: imageUrl.substring(0, 120),
      error: e?.message || String(e),
    });
    return { image: imageUrl, wasInlined: false };
  }
}

/**
 * Convert width/height to a valid aspect ratio string
 */
function calculateAspectRatio(width?: number, height?: number): string {
  if (!width || !height) return '1:1';

  const ratio = width / height;

  // Map to closest standard aspect ratio
  if (Math.abs(ratio - 1) < 0.1) return '1:1';
  if (Math.abs(ratio - 16 / 9) < 0.1) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.1) return '9:16';
  if (Math.abs(ratio - 4 / 3) < 0.1) return '4:3';
  if (Math.abs(ratio - 3 / 4) < 0.1) return '3:4';
  if (Math.abs(ratio - 3 / 2) < 0.1) return '3:2';
  if (Math.abs(ratio - 2 / 3) < 0.1) return '2:3';
  if (Math.abs(ratio - 21 / 9) < 0.1) return '21:9';
  if (Math.abs(ratio - 9 / 21) < 0.1) return '9:21';
  if (Math.abs(ratio - 16 / 10) < 0.1) return '16:10';
  if (Math.abs(ratio - 10 / 16) < 0.1) return '10:16';

  // Default to 1:1 if no match
  return '1:1';
}

/**
 * Map frontend model names to backend model names
 */
export function mapModelToBackend(frontendModel: string): { service: 'bfl' | 'replicate' | 'fal' | 'runway'; backendModel: string; resolution?: string } {
  const modelLower = frontendModel.toLowerCase().trim();

  // Extract resolution from model name if present (e.g., "Google nano banana pro 2K" -> resolution: "2K")
  // Check in reverse order (4K, 2K, 1K) to match longer suffixes first
  let resolution: string | undefined;
  const resolutions = ['4k', '2k', '1k'];
  for (const res of resolutions) {
    // Check if model ends with resolution (with or without space before it)
    if (modelLower.endsWith(' ' + res) || modelLower.endsWith(res)) {
      resolution = res.toUpperCase(); // Return as '1K', '2K', '4K'
      break;
    }
  }

  // Runway models - check FIRST before other models
  if (modelLower.includes('runway gen4 image turbo') || modelLower.includes('gen4 image turbo') || modelLower === 'runway gen4 image turbo') {
    return { service: 'runway', backendModel: 'gen4_image_turbo' };
  }
  if (modelLower.includes('runway gen4 image') || modelLower.includes('gen4 image') || modelLower === 'runway gen4 image') {
    return { service: 'runway', backendModel: 'gen4_image' };
  }

  // Seedream 4.5 - MUST check BEFORE Seedream 4K check to avoid false matches
  // Check for "seedream 4.5", "seedream-4.5", "seedream_v45", etc. (with or without resolution suffix)
  const seedream45Base = modelLower.replace(/\s+(1k|2k|4k)$/, ''); // Remove resolution suffix for matching
  if (seedream45Base.includes('seedream-4.5') || seedream45Base.includes('seedream_v45') || seedream45Base.includes('seedreamv45') ||
    (seedream45Base.includes('seedream') && (seedream45Base.includes('4.5') || seedream45Base.includes('v4.5') || seedream45Base.includes('v45')))) {
    return { service: 'fal', backendModel: 'seedream-4.5', resolution };
  }

  // Replicate Seedream 4K - MUST check AFTER Seedream 4.5 to avoid false matches
  // Check for "seedream" + "4k" or "4 k" or "v4 4k" patterns (but NOT "4.5")
  if (modelLower.includes('seedream') && (
    modelLower.includes('4k') ||
    modelLower.includes('4 k') ||
    (modelLower.includes('v4') && modelLower.includes('4k'))
  ) && !modelLower.includes('4.5') && !modelLower.includes('v4.5') && !modelLower.includes('v45')) {
    // Switch to FAL for Seedream v4 to avoid Replicate credit issues
    return { service: 'fal', backendModel: 'fal-ai/bytedance/seedream/v4/text-to-image', resolution };
  }

  // Z Image Turbo - Replicate model (prunaai/z-image-turbo)
  if (modelLower.includes('z-image-turbo') || modelLower === 'z-image-turbo') {
    return { service: 'replicate', backendModel: 'z-image-turbo' };
  }

  // P-Image - Replicate model (prunaai/p-image)
  if (modelLower.includes('p-image') && !modelLower.includes('p-image-edit')) {
    return { service: 'replicate', backendModel: 'prunaai/p-image' };
  }

  // Qwen Image Edit - Replicate model (qwen/qwen-image-edit-2511)
  // Frontend often sends the short alias "qwen-image-edit"
  if (modelLower === 'qwen-image-edit' || modelLower.includes('qwen image edit') || modelLower.includes('qwen-image-edit')) {
    return { service: 'replicate', backendModel: 'qwen/qwen-image-edit-2511' };
  }

  // ChatGPT 1.5 - Replicate model (openai/gpt-image-1.5)
  if (modelLower.includes('chatgpt 1.5') || modelLower.includes('chat-gpt-1.5') || modelLower === 'openai/gpt-image-1.5') {
    return { service: 'replicate', backendModel: 'openai/gpt-image-1.5' };
  }

  // Explicit mapping for Flux 2 Pro to FAL as requested by user
  if (modelLower.includes('flux 2 pro') || modelLower.includes('flux-2-pro')) {
    return { service: 'fal', backendModel: 'fal-ai/flux-2-pro', resolution };
  }
  if (modelLower.includes('flux-pro/v1.1-ultra') || (modelLower.includes('pro 1.1') && modelLower.includes('ultra'))) {
    return { service: 'fal', backendModel: 'fal-ai/flux-pro/v1.1-ultra', resolution };
  }
  if (modelLower.includes('flux-pro-1.1') || (modelLower.includes('pro 1.1') && !modelLower.includes('ultra'))) {
    return { service: 'bfl', backendModel: 'flux-pro-1.1', resolution };
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
  // Google Nano Banana Pro - Fal model
  // Check if model contains nano banana pro (without resolution suffix for matching)
  const nanoBananaProBase = modelLower.replace(/\s+(1k|2k|4k)$/, ''); // Remove resolution suffix for matching
  if (nanoBananaProBase.includes('google nano banana pro') || nanoBananaProBase.includes('nano banana pro')) {
    return { service: 'fal', backendModel: 'google/nano-banana-pro', resolution };
  }

  if (modelLower.includes('nano banana') || modelLower.includes('gemini')) {
    return { service: 'fal', backendModel: 'gemini-25-flash-image' };
  }
  if (modelLower.includes('flux 2 pro') || modelLower.includes('flux-2-pro')) {
    return { service: 'fal', backendModel: 'flux-2-pro', resolution };
  }

  // Seedream v4 (without 4K) - goes to FAL
  // This check comes after Seedream 4.5 and Seedream 4K checks
  if (modelLower.includes('seedream') && !modelLower.includes('4.5') && !modelLower.includes('v4.5') && !modelLower.includes('v45') && !modelLower.includes('4k')) {
    return { service: 'fal', backendModel: 'seedream-v4' };
  }

  if (modelLower.includes('z image turbo') || modelLower.includes('z-image-turbo')) {
    return { service: 'replicate', backendModel: 'new-turbo-model' };
  }

  // Default to FAL (Google Nano Banana)
  return { service: 'fal', backendModel: 'gemini-25-flash-image' };
}

export async function generateForCanvas(
  uid: string,
  request: CanvasGenerationRequest
): Promise<{ mediaId: string; url: string; storagePath: string; generationId?: string; images?: Array<{ mediaId: string; url: string; storagePath: string }> }> {
  // Map frontend model name to backend model name and service
  const { service, backendModel, resolution: extractedResolution } = mapModelToBackend(request.model);

  // Debug logging
  console.log('[generateForCanvas] Model mapping:', {
    frontend: request.model,
    backend: backendModel,
    service,
    extractedResolution,
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

      // Handle reference images based on scene number
      // Scene 1: Only reference images (1 input)
      // Scene 2+: Reference image (first one) + previous scene image (2 inputs)
      const sourceImageUrl = (request as any).sourceImageUrl as string | undefined;
      const sceneNumber = (request as any).sceneNumber as number | undefined;
      const previousSceneImageUrl = (request as any).previousSceneImageUrl as string | undefined;

      if (sourceImageUrl || previousSceneImageUrl) {
        const referenceImages: string[] = [];

        if (sceneNumber === 1) {
          // Scene 1: All reference images
          if (sourceImageUrl) {
            const refImages = sourceImageUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
            referenceImages.push(...refImages);
          }
        } else if (sceneNumber && sceneNumber > 1) {
          // Scene 2+: First reference image + previous scene image
          if (sourceImageUrl) {
            const refImages = sourceImageUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
            if (refImages.length > 0) {
              referenceImages.push(refImages[0]); // Only first reference image
            }
          }
          if (previousSceneImageUrl) {
            referenceImages.push(previousSceneImageUrl);
          }
        } else {
          // Fallback: Use all provided images
          if (sourceImageUrl) {
            const refImages = sourceImageUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
            referenceImages.push(...refImages);
          }
          if (previousSceneImageUrl) {
            referenceImages.push(previousSceneImageUrl);
          }
        }

        if (referenceImages.length > 0) {
          bflPayload.uploadedImages = referenceImages;
        }
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
      // Use Replicate service for Seedream 4K, Z Image Turbo, P-Image, etc.
      // Most models use owner/name format, but z-image-turbo/new-turbo-model is handled specially
      if (!backendModel.includes('/') && backendModel !== 'z-image-turbo' && backendModel !== 'new-turbo-model' && backendModel !== 'p-image') {
        console.error('[generateForCanvas] Invalid Replicate model format:', backendModel);
        throw new ApiError(`Invalid model format for Replicate: ${backendModel}. Expected format: owner/name`, 400);
      }

      const replicatePayload: any = {
        prompt: request.prompt,
        model: backendModel,
        aspect_ratio: aspectRatio,
        storageKeyPrefixOverride: canvasKeyPrefix,
        ...(request.width && request.height && {
          width: request.width,
          height: request.height,
        }),
        // Merge GPT-specific options or other custom parameters
        ...(request.options || {}),
      };

      // Enforce 90% compression for ChatGPT 1.5 as per user requirement
      if (backendModel === 'openai/gpt-image-1.5') {
        replicatePayload.output_compression = 90;
        console.log('[generateForCanvas] Enforcing 90% compression for ChatGPT 1.5');
      }

      // Add num_images for models that support multiple images (z-image-turbo, p-image, gpt-image-1.5, qwen)
      const isZTurbo = backendModel === 'z-image-turbo' || backendModel === 'new-turbo-model';
      const isPImage = backendModel === 'prunaai/p-image' || backendModel === 'p-image';
      const isGptImage15 = backendModel === 'openai/gpt-image-1.5';
      const isQwen = backendModel.startsWith('qwen/');

      if ((isZTurbo || isPImage || isGptImage15 || isQwen) && clampedImageCount > 1) {
        (replicatePayload as any).__num_images = clampedImageCount;
      }

      // Handle reference images based on scene number
      // Scene 1: Only reference images (1 input)
      // Scene 2+: Reference image (first one) + previous scene image (2 inputs)
      const sourceImageUrl = (request as any).sourceImageUrl as string | undefined;
      const sceneNumber = (request as any).sceneNumber as number | undefined;
      const previousSceneImageUrl = (request as any).previousSceneImageUrl as string | undefined;

      if (sourceImageUrl || previousSceneImageUrl) {
        const referenceImages: string[] = [];

        if (sceneNumber === 1) {
          // Scene 1: All reference images
          if (sourceImageUrl) {
            const refImages = sourceImageUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
            referenceImages.push(...refImages);
          }
        } else if (sceneNumber && sceneNumber > 1) {
          // Scene 2+: First reference image + previous scene image
          if (sourceImageUrl) {
            const refImages = sourceImageUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
            if (refImages.length > 0) {
              referenceImages.push(refImages[0]); // Only first reference image
            }
          }
          if (previousSceneImageUrl) {
            referenceImages.push(previousSceneImageUrl);
          }
        } else {
          // Fallback: Use all provided images
          if (sourceImageUrl) {
            const refImages = sourceImageUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
            referenceImages.push(...refImages);
          }
          if (previousSceneImageUrl) {
            referenceImages.push(previousSceneImageUrl);
          }
        }

        if (referenceImages.length > 0) {
          replicatePayload.image_input = referenceImages;
        }
      }

      const result = await replicateService.generateImage(uid, replicatePayload);

      // Handle multiple images from Replicate
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

        // Return first image for backward compatibility, plus all images are in allImages
        imageUrl = allImages[0]?.url || '';
        imageStoragePath = allImages[0]?.storagePath;
      } else {
        // Single image (backward compatible)
        imageUrl = (result as any)?.images?.[0]?.url || (result as any)?.images?.[0]?.originalUrl || '';
        imageStoragePath = (result as any)?.images?.[0]?.storagePath;
      }

      generationId = result.historyId || (result as any).data?.historyId;
    } else if (service === 'runway') {
      // Use Runway service for Gen4 Image models
      // Convert aspect ratio from "16:9" to Runway format (e.g., "1920:1080")
      const runwayRatioMap: Record<string, string> = {
        '1:1': '1024:1024',
        '16:9': '1920:1080',
        '9:16': '1080:1920',
        '4:3': '1360:1020',
        '3:4': '1020:1360',
        '21:9': '2112:912',
        '9:21': '912:2112',
      };
      const runwayRatio = runwayRatioMap[aspectRatio] || runwayRatioMap['1:1'] || '1024:1024';

      const runwayPayload: any = {
        promptText: request.prompt,
        model: backendModel, // 'gen4_image' or 'gen4_image_turbo'
        ratio: runwayRatio as any,
        generationType: 'text-to-image',
        ...(request.options?.style ? { style: request.options.style } : {}),
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
      };

      // Handle reference images based on scene number
      // Scene 1: Only reference images (1 input)
      // Scene 2+: Reference image (first one) + previous scene image (2 inputs)
      const sourceImageUrl = (request as any).sourceImageUrl as string | undefined;
      const sceneNumber = (request as any).sceneNumber as number | undefined;
      const previousSceneImageUrl = (request as any).previousSceneImageUrl as string | undefined;

      if (sourceImageUrl || previousSceneImageUrl) {
        const referenceImages: string[] = [];

        if (sceneNumber === 1) {
          // Scene 1: All reference images
          if (sourceImageUrl) {
            const refImages = sourceImageUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
            referenceImages.push(...refImages);
          }
        } else if (sceneNumber && sceneNumber > 1) {
          // Scene 2+: First reference image + previous scene image
          if (sourceImageUrl) {
            const refImages = sourceImageUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
            if (refImages.length > 0) {
              referenceImages.push(refImages[0]); // Only first reference image
            }
          }
          if (previousSceneImageUrl) {
            referenceImages.push(previousSceneImageUrl);
          }
        } else {
          // Fallback: Use all provided images
          if (sourceImageUrl) {
            const refImages = sourceImageUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
            referenceImages.push(...refImages);
          }
          if (previousSceneImageUrl) {
            referenceImages.push(previousSceneImageUrl);
          }
        }

        if (referenceImages.length > 0) {
          runwayPayload.uploadedImages = referenceImages;
        }
      }

      // Runway textToImage returns a taskId and status "pending"
      // We need to poll for completion
      const taskResult = await runwayService.textToImage(uid, runwayPayload);

      if (!taskResult.taskId) {
        throw new ApiError('Runway image generation failed: no taskId returned', 500);
      }

      if (!taskResult.historyId) {
        throw new ApiError('Runway image generation failed: no historyId returned', 500);
      }

      // Poll for completion (max 5 minutes, check every 2 seconds)
      // Note: Runway is async, so we poll the history record which gets updated by the service
      const maxWaitTime = 5 * 60 * 1000; // 5 minutes
      const pollInterval = 2000; // 2 seconds
      const startTime = Date.now();
      let completed = false;
      let finalHistory: any = null;

      while (!completed && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));

        // Check the history record which gets updated when Runway completes
        const history = await generationHistoryRepository.get(uid, taskResult.historyId!);
        if (history && history.status === 'completed' && history.images && Array.isArray(history.images) && history.images.length > 0) {
          completed = true;
          finalHistory = history;
        } else if (history && history.status === 'failed') {
          throw new ApiError(`Runway image generation failed: ${history.error || 'Unknown error'}`, 500);
        }
      }

      if (!completed) {
        throw new ApiError('Runway image generation timed out', 504);
      }

      // Extract image from completed history
      const firstImage = finalHistory.images[0];
      if (!firstImage || !firstImage.url) {
        throw new ApiError('Runway image generation completed but no image URL was returned', 500);
      }

      imageUrl = firstImage.url;
      imageStoragePath = firstImage.storagePath;
      generationId = taskResult.historyId;
    } else {
      // Use FAL service (default for Google Nano Banana, Seedream v4, Imagen)
      // For image-to-image generation, pass sourceImageUrl as uploadedImages array
      const falPayload: any = {
        prompt: request.prompt,
        model: backendModel, // Use mapped backend model name (e.g., 'seedream-4.5')
        // aspect_ratio: aspectRatio as any, // MOVED: Conditionally set below
        num_images: clampedImageCount, // Pass imageCount to generate multiple images
        resolution: extractedResolution, // Pass resolution (e.g., '2K', '4K') to FAL service
        storageKeyPrefixOverride: canvasKeyPrefix,
        forceSyncUpload: true,
      };

      // Special handling for Flux Pro (1.1 Ultra, 2 Pro) capability on FAL
      // If we have custom width/height (from Fit-Inside logic), use 'image_size' object and OMIT aspect_ratio
      const isFluxUltra = backendModel.includes('flux-pro/v1.1-ultra') || backendModel.includes('flux-2-pro');

      // Special check for Seedream models (v4, v4.5): Only use custom image_size if it meets API constraints
      // Constraints: width/height >= 1920 OR total pixels >= 3,686,400 (approx 2560x1440)
      // Otherwise fall back to 'resolution' parameter (which maps to auto_2K/auto_4K enums in falService)
      const isSeedreamCheck = backendModel.includes('seedream');
      const customWidth = (request as any).width;
      const customHeight = (request as any).height;

      let useCustomSize = false;
      if (customWidth && customHeight) {
        if (isFluxUltra) {
          useCustomSize = true;
        } else if (isSeedreamCheck) {
          // Seedream 4.5 Smart Logic:
          // Check strict constraints
          const totalPixels = customWidth * customHeight;
          const minSide = 1920;
          const minPixels = 2560 * 1440; // 3,686,400

          if ((customWidth >= minSide && customHeight >= minSide) || totalPixels >= minPixels) {
            useCustomSize = true;
            console.log(`[generateForCanvas] ✅ Seedream 4.5: Dimensions ${customWidth}x${customHeight} meet custom size constraints`);
          } else {
            console.log(`[generateForCanvas] ⚠️ Seedream 4.5: Dimensions ${customWidth}x${customHeight} are too small for custom size, falling back to auto resolution enum`);
            useCustomSize = false;
          }
        }
      }

      if (useCustomSize && customWidth && customHeight) {
        falPayload.image_size = {
          width: customWidth,
          height: customHeight
        };
        console.log(`[generateForCanvas] ✅ Using custom image_size for ${isFluxUltra ? 'Flux Ultra/Pro' : 'Seedream'}: ${customWidth}x${customHeight}`);
        // Do NOT set falPayload.aspect_ratio here
      } else {
        // Default behavior: use aspect_ratio
        falPayload.aspect_ratio = aspectRatio as any;
      }

      // Pass resolution for Google Nano Banana Pro and Seedream if provided
      // Priority: extracted from model name > direct resolution field > options.resolution
      const resolution = extractedResolution || (request as any).resolution || (request.options && request.options.resolution);
      const isNanoBananaPro = backendModel.includes('nano-banana-pro') || backendModel.includes('google/nano-banana-pro');
      const isSeedream = backendModel.includes('seedream');

      if (resolution && (isNanoBananaPro || isSeedream)) {
        falPayload.resolution = resolution;
        console.log(`[generateForCanvas] ✅ Setting resolution for ${isNanoBananaPro ? 'Google Nano Banana Pro' : 'Seedream'}:`, resolution);
      } else if (isNanoBananaPro) {
        console.log('[generateForCanvas] ⚠️ No resolution provided for Google Nano Banana Pro, Fal service will default to 1K');
      } else if (isSeedream) {
        console.log('[generateForCanvas] ⚠️ No resolution provided for Seedream, Fal service will use default image_size');
      }

      // Handle reference images based on scene number
      // Scene 1: Only reference images (from namedImages) - 1 input
      // Scene 2+: Reference images + previous scene's generated image - 2 inputs
      const sourceImageUrl = (request as any).sourceImageUrl as string | undefined;
      const sceneNumber = (request as any).sceneNumber as number | undefined;
      const previousSceneImageUrl = (request as any).previousSceneImageUrl as string | undefined;

      console.log('[generateForCanvas] Scene and reference image check:', {
        sceneNumber,
        hasSourceImageUrl: !!sourceImageUrl,
        hasPreviousSceneImageUrl: !!previousSceneImageUrl,
        sourceImageUrl: sourceImageUrl ? sourceImageUrl.substring(0, 100) + '...' : 'none',
        previousSceneImageUrl: previousSceneImageUrl ? previousSceneImageUrl.substring(0, 100) + '...' : 'none'
      });

      if (sourceImageUrl || previousSceneImageUrl) {
        const referenceImages: string[] = [];

        // Helper function to detect and validate image URLs
        const validateImageUrl = (url: string): string => {
          if (url.startsWith('blob:')) {
            throw new ApiError(
              'Blob URLs cannot be used for image-to-image generation. Please convert the image to a data URI or upload it to get a public URL. The frontend should convert blob URLs to data URIs before sending.',
              400
            );
          }
          return url;
        };

        // Scene 1: Only reference images (1 input)
        if (sceneNumber === 1) {
          if (sourceImageUrl) {
            const refImages = sourceImageUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
            // Validate all reference images
            refImages.forEach(validateImageUrl);
            referenceImages.push(...refImages);
            console.log('[generateForCanvas] ✅ Scene 1: Using reference images only (1 input)', {
              imageCount: referenceImages.length,
              images: referenceImages.map(url => url.substring(0, 50) + '...')
            });
          }
        }
        // Scene 2+: Reference images + previous scene image (2 inputs)
        else if (sceneNumber && sceneNumber > 1) {
          // First input: Reference images (from namedImages)
          if (sourceImageUrl) {
            const refImages = sourceImageUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
            // For Scene 2+, use only the FIRST reference image (index 0)
            if (refImages.length > 0) {
              validateImageUrl(refImages[0]); // Validate before adding
              referenceImages.push(refImages[0]);
              console.log('[generateForCanvas] ✅ Scene 2+: Added reference image (index 0)');
            }
          }

          // Second input: Previous scene's generated image
          if (previousSceneImageUrl) {
            validateImageUrl(previousSceneImageUrl); // Validate before adding
            referenceImages.push(previousSceneImageUrl);
            console.log('[generateForCanvas] ✅ Scene 2+: Added previous scene image (index 1)');
          }

          console.log('[generateForCanvas] ✅ Scene 2+: Using reference + previous scene (2 inputs)', {
            imageCount: referenceImages.length,
            images: referenceImages.map(url => url.substring(0, 50) + '...')
          });
        }
        // Fallback: If no scene number, use all provided images
        else {
          if (sourceImageUrl) {
            const refImages = sourceImageUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
            // Validate all reference images
            refImages.forEach(validateImageUrl);
            referenceImages.push(...refImages);
          }
          if (previousSceneImageUrl) {
            validateImageUrl(previousSceneImageUrl);
            referenceImages.push(previousSceneImageUrl);
          }
        }

        if (referenceImages.length > 0) {
          console.log('[generateForCanvas] ✅ STEP 9: Setting uploadedImages for FAL service (image-to-image mode):', {
            sceneNumber,
            imageCount: referenceImages.length,
            images: referenceImages.map((url, idx) => ({
              index: idx,
              url: url,
              preview: url.substring(0, 80) + '...'
            })),
            falPayloadModel: falPayload.model,
          });
          falPayload.uploadedImages = referenceImages;
        } else {
          console.log('[generateForCanvas] ⚠️ STEP 9: Using text-to-image mode (no reference images)');
        }
      } else {
        console.log('[generateForCanvas] Using text-to-image mode (no reference)');
      }

      const result = await falService.generate(uid, falPayload);

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

    // Generate storyboard if sceneNumber and metadata are provided
    const sceneNumber = (request as any).sceneNumber as number | undefined;
    const storyboardMetadata = (request as any).storyboardMetadata as Record<string, string> | undefined;
    const sourceImageUrl = (request as any).sourceImageUrl as string | undefined;
    const previousSceneImageUrl = (request as any).previousSceneImageUrl as string | undefined;

    if (sceneNumber && storyboardMetadata && imageUrl) {
      try {
        console.log('[generateForCanvas] Generating storyboard for scene:', sceneNumber);

        const frames: StoryboardFrame[] = [];

        // Index 0: Reference image (always present - first image from sourceImageUrl)
        if (sourceImageUrl) {
          const referenceImageUrl = sourceImageUrl.split(',')[0].trim();
          try {
            const referenceImageBuffer = await downloadImageAsBuffer(referenceImageUrl);
            frames.push({
              buffer: referenceImageBuffer,
              metadata: {
                character: storyboardMetadata.character || '',
                background: storyboardMetadata.background || '',
                objects: storyboardMetadata.objects || '',
                lighting: storyboardMetadata.lighting || '',
                camera: storyboardMetadata.camera || '',
                mood: storyboardMetadata.mood || '',
                style: storyboardMetadata.style || '',
                environment: storyboardMetadata.environment || '',
              },
            });
            console.log('[generateForCanvas] ✅ Added reference image to storyboard');
          } catch (error) {
            console.warn('[generateForCanvas] ⚠️ Failed to download reference image for storyboard:', error);
          }
        }

        // Index 1: Previous scene image (for Scene 2+)
        if (sceneNumber > 1 && previousSceneImageUrl) {
          try {
            const previousSceneBuffer = await downloadImageAsBuffer(previousSceneImageUrl);
            frames.push({
              buffer: previousSceneBuffer,
              metadata: {
                character: storyboardMetadata.character || '',
                background: storyboardMetadata.background || '',
                objects: storyboardMetadata.objects || '',
                lighting: storyboardMetadata.lighting || '',
                camera: storyboardMetadata.camera || '',
                mood: storyboardMetadata.mood || '',
                style: storyboardMetadata.style || '',
                environment: storyboardMetadata.environment || '',
              },
            });
            console.log('[generateForCanvas] ✅ Added previous scene image to storyboard');
          } catch (error) {
            console.warn('[generateForCanvas] ⚠️ Failed to download previous scene image for storyboard:', error);
          }
        }

        // Index 1 (Scene 1) or Index 2 (Scene 2+): Generated image
        const generatedImageBuffer = await downloadImageAsBuffer(imageUrl);
        frames.push({
          buffer: generatedImageBuffer,
          metadata: {
            character: storyboardMetadata.character || '',
            background: storyboardMetadata.background || '',
            objects: storyboardMetadata.objects || '',
            lighting: storyboardMetadata.lighting || '',
            camera: storyboardMetadata.camera || '',
            mood: storyboardMetadata.mood || '',
            style: storyboardMetadata.style || '',
            environment: storyboardMetadata.environment || '',
          },
        });
        console.log('[generateForCanvas] ✅ Added generated image to storyboard');

        // Create storyboard only if we have at least 2 frames (reference + generated)
        if (frames.length >= 2) {
          const storyboardBuffer = await createStoryboard(frames);

          // Upload storyboard to Zata
          const storyboardKey = `${canvasKeyPrefix}/storyboard-scene-${sceneNumber}-${Date.now()}.png`;
          const storyboardUpload = await uploadBufferToZata(
            storyboardKey,
            storyboardBuffer,
            'image/png'
          );

          console.log('[generateForCanvas] ✅ Storyboard generated:', storyboardUpload.publicUrl);

          // Store storyboard URL in response (optional - can be used by frontend)
          (request as any).storyboardUrl = storyboardUpload.publicUrl;
        } else {
          console.warn('[generateForCanvas] ⚠️ Not enough frames for storyboard (need at least 2, got', frames.length, ')');
        }
      } catch (error) {
        console.error('[generateForCanvas] ⚠️ Failed to generate storyboard:', error);
        // Don't fail the entire request if storyboard generation fails
      }
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
  // Seedance 1.5 (audio-capable)
  if (
    modelLower.includes('seedance 1.5') ||
    modelLower.includes('seedance-1.5') ||
    modelLower.includes('seedance-1.5-pro')
  ) {
    return { service: 'replicate', method: 'seedanceT2vSubmit', backendModel: 'bytedance/seedance-1.5-pro' };
  }
  if (modelLower.includes('seedance 1.0 pro') || modelLower === 'seedance 1.0 pro' || modelLower.includes('seedance')) {
    return { service: 'replicate', method: 'seedanceT2vSubmit', backendModel: 'bytedance/seedance-1-pro' };
  }
  if (modelLower.includes('pixverse v5') || modelLower === 'pixverse v5' || modelLower.includes('pixverse')) {
    return { service: 'replicate', method: 'pixverseT2vSubmit', backendModel: 'pixverse/pixverse-v5' };
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
    generate_audio?: boolean;
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

      // FAL LTX V2 Pro (Text-to-Video) ONLY supports 16:9 aspect ratio.
      // Other ratios (9:16, 1:1) will cause a 422 Unprocessable Entity error from FAL.
      const isLtx = modelConfig.method.includes('ltx');
      const isT2v = !request.firstFrameUrl;
      if (isLtx && isT2v && aspectRatio !== '16:9') {
        console.warn(`[generateVideoForCanvas] LTX T2V only supports 16:9. Adjusting ${aspectRatio} to 16:9.`);
        falPayload.aspect_ratio = '16:9';
      }

      // FAL Sora 2 expects duration as number, Veo expects as string "8s"
      const isSora2 = modelConfig.method.includes('sora2');
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

      // Seedance 1.5 supports optional audio generation
      const isSeedance15 = Boolean(modelConfig.backendModel?.includes('seedance-1.5'));
      if (isSeedance15 && typeof request.generate_audio === 'boolean') {
        replicatePayload.generate_audio = request.generate_audio;
      }

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

      // Forward first/last frame URLs for Seedance and potentially other Replicate models
      if (request.firstFrameUrl) {
        replicatePayload.image = request.firstFrameUrl;
      }
      if (request.lastFrameUrl) {
        replicatePayload.last_frame_image = request.lastFrameUrl;
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

/**
 * Upscale image for Canvas - uses Crystal Upscaler via Replicate
 */
export async function upscaleForCanvas(
  uid: string,
  request: {
    image: string;
    model?: string;
    scale?: number;
    projectId: string;
    elementId?: string;
    faceEnhance?: boolean;
    faceEnhanceStrength?: number;
    topazModel?: string;
    faceEnhanceCreativity?: number;
    [key: string]: any;
  }
): Promise<{ url: string; storagePath: string; mediaId?: string; generationId?: string }> {
  if (!request.image) {
    throw new ApiError('Image is required', 400);
  }
  if (!request.projectId) {
    throw new ApiError('Project ID is required', 400);
  }

  console.log('[upscaleForCanvas] Request received:', {
    userId: uid,
    model: request.model,
    scale: request.scale,
    projectId: request.projectId,
    hasImage: !!request.image,
    faceEnhance: request.faceEnhance,
    topazModel: request.topazModel,
  });

  try {
    let result: any;

    if (request.model === 'Topaz Upscaler') {
      // Call FAL Topaz Upscale
      result = await falService.topazUpscaleImage(uid, {
        image_url: request.image,
        upscale_factor: Math.min(request.scale || 2, 4), // Cap at 4x for Topaz
        model: request.topazModel || 'Standard V2',
        face_enhancement: request.faceEnhance ?? true,
        face_enhancement_strength: request.faceEnhanceStrength ?? 0.8,
        face_enhancement_creativity: request.faceEnhanceCreativity ?? 0,
        isPublic: false,
      });
    } else if (request.model === 'Real-ESRGAN') {
      // Call Replicate Real-ESRGAN
      const scaleFactor = Math.min(Math.max(request.scale || 2, 1), 10);
      result = await replicateService.upscale(uid, {
        image: request.image,
        model: 'nightmareai/real-esrgan',
        scale: scaleFactor,
        face_enhance: request.faceEnhance ?? false,
        output_format: 'png',
        isPublic: false,
      });
    } else {
      // Default to Crystal Upscaler (Replicate)
      const replicateModel = 'philz1337x/crystal-upscaler';
      const scaleFactor = Math.min(Math.max(request.scale || 2, 1), 4);

      result = await replicateService.upscale(uid, {
        image: request.image,
        model: replicateModel,
        scale_factor: scaleFactor,
        output_format: 'png',
        isPublic: false,
      });
    }

    console.log('[upscaleForCanvas] Upscale service completed:', {
      model: request.model,
      hasImages: !!result.images,
      imageCount: result.images?.length || 0,
      hasHistoryId: !!result.historyId,
    });

    // Extract the first upscaled image from the result
    const firstImage = result.images && Array.isArray(result.images) && result.images.length > 0
      ? result.images[0]
      : null;

    if (!firstImage || !firstImage.url) {
      throw new ApiError('No upscaled image returned from service', 500);
    }

    // Attach canvas project linkage
    try {
      if (result?.historyId && request.projectId) {
        await generationHistoryRepository.update(uid, result.historyId, {
          canvasProjectId: request.projectId
        } as any);
      }
    } catch (e) {
      console.warn('[upscaleForCanvas] Failed to tag history with canvasProjectId', e);
    }

    return {
      url: firstImage.url,
      storagePath: firstImage.storagePath || firstImage.originalUrl || firstImage.url,
      mediaId: firstImage.id,
      generationId: result.historyId,
    };
  } catch (error: any) {
    console.error('[upscaleForCanvas] Service error:', {
      message: error.message,
      statusCode: error.statusCode,
      stack: error.stack,
      model: request.model,
    });

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      error.message || 'Image upscale failed',
      error.statusCode || error.status || 500
    );
  }
}

/**
 * Remove background from image for Canvas - uses 851-labs/background-remover via Replicate
 */
export async function removeBgForCanvas(
  uid: string,
  request: {
    image: string;
    model?: string;
    backgroundType?: string;
    scaleValue?: number;
    projectId: string;
    elementId?: string;
  }
): Promise<{ url: string; storagePath: string; mediaId?: string; generationId?: string }> {
  if (!request.image) {
    throw new ApiError('Image is required', 400);
  }
  if (!request.projectId) {
    throw new ApiError('Project ID is required', 400);
  }

  console.log('[removeBgForCanvas] Request received:', {
    userId: uid,
    model: request.model,
    backgroundType: request.backgroundType,
    scaleValue: request.scaleValue,
    projectId: request.projectId,
    hasImage: !!request.image,
  });

  try {
    // Map frontend model name to Replicate model
    const replicateModel = request.model === '851-labs/background-remover'
      ? '851-labs/background-remover'
      : '851-labs/background-remover'; // Default to 851-labs/background-remover

    // Map backgroundType from UI to Replicate format
    // UI options: 'green', 'rgba (transparent)', 'white', 'blue', 'overlay', 'map'
    // Replicate expects: 'green', 'rgba', 'white', 'blue', 'overlay', 'map'
    // Note: 851-labs/background-remover uses 'rgba' for transparent backgrounds, not 'transparent'
    let backgroundType = request.backgroundType || 'rgba';
    if (backgroundType === 'rgba (transparent)') {
      backgroundType = 'rgba';
    }

    // Map scaleValue (0.0-1.0) to threshold if needed
    // For 851-labs/background-remover, threshold is optional (0-1 range)
    const threshold = request.scaleValue !== undefined ? request.scaleValue : undefined;

    // Call Replicate remove background service
    const inlined = await inlineImageForReplicateIfNeeded(request.image);
    console.log('[removeBgForCanvas] Calling Replicate with params:', {
      model: replicateModel,
      format: 'png',
      background_type: backgroundType,
      threshold: threshold,
      hasImage: !!request.image,
      imageLength: request.image?.length || 0,
      imageInlined: inlined.wasInlined,
    });

    const result = await replicateService.removeBackground(uid, {
      image: inlined.image,
      model: replicateModel,
      format: 'png',
      background_type: backgroundType,
      threshold: threshold,
      isPublic: false,
    });

    console.log('[removeBgForCanvas] Replicate remove bg completed:', {
      hasImages: !!result.images,
      imageCount: result.images?.length || 0,
      hasHistoryId: !!result.historyId,
    });

    // Extract the first image from the result
    const firstImage = result.images && Array.isArray(result.images) && result.images.length > 0
      ? result.images[0]
      : null;

    if (!firstImage || !firstImage.url) {
      throw new ApiError('No image returned from service', 500);
    }

    // Attach canvas project linkage
    try {
      if (result?.historyId && request.projectId) {
        await generationHistoryRepository.update(uid, result.historyId, {
          canvasProjectId: request.projectId
        } as any);
      }
    } catch (e) {
      console.warn('[removeBgForCanvas] Failed to tag history with canvasProjectId', e);
    }

    return {
      url: firstImage.url,
      storagePath: firstImage.storagePath || firstImage.originalUrl || firstImage.url,
      mediaId: firstImage.id,
      generationId: result.historyId,
    };
  } catch (error: any) {
    console.error('[removeBgForCanvas] Service error:', {
      message: error.message,
      statusCode: error.statusCode,
      stack: error.stack,
      model: request.model,
      backgroundType: request.backgroundType,
    });

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      error.message || 'Background removal failed',
      error.statusCode || error.status || 500
    );
  }
}

/**
 * Vectorize image for Canvas - uses Recraft Vectorize via FAL
 */
export async function vectorizeForCanvas(
  uid: string,
  request: {
    image: string;
    mode?: string;
    projectId: string;
    elementId?: string;
  }
): Promise<{ url: string; storagePath: string; mediaId?: string; generationId?: string }> {
  if (!request.image) {
    throw new ApiError('Image is required', 400);
  }
  if (!request.projectId) {
    throw new ApiError('Project ID is required', 400);
  }

  console.log('[vectorizeForCanvas] Request received:', {
    userId: uid,
    mode: request.mode,
    projectId: request.projectId,
    hasImage: !!request.image,
    imageUrl: request.image?.substring(0, 100), // Log first 100 chars of URL
  });

  try {
    // Ensure the image is accessible by uploading it to Zata if needed
    // This handles cases where the URL might have CORS restrictions or require authentication
    let imageUrl = request.image;

    // Check if the image is already an SVG (can't vectorize an SVG)
    const isSvg = imageUrl.toLowerCase().endsWith('.svg') ||
      imageUrl.toLowerCase().includes('.svg') ||
      imageUrl.toLowerCase().includes('vectorized');

    if (isSvg) {
      throw new ApiError('Cannot vectorize an SVG file. Please use a raster image (PNG, JPG, etc.)', 400);
    }

    // Check if it's already a Zata URL (starts with the Zata domain)
    const isZataUrl = imageUrl.includes('zata.ai') || imageUrl.includes('idr01.zata.ai');

    // If it's not a Zata URL, upload it to ensure it's publicly accessible
    if (!isZataUrl) {
      try {
        console.log('[vectorizeForCanvas] Uploading image to Zata for accessibility');
        const creator = await authRepository.getUserById(uid);
        const username = creator?.username || uid;
        const canvasKeyPrefix = `users/${username}/canvas/${request.projectId}`;

        // Upload the image to Zata to ensure it's accessible
        const zataResult = await uploadFromUrlToZata({
          sourceUrl: imageUrl,
          keyPrefix: canvasKeyPrefix,
          fileName: `vectorize-source-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        });

        imageUrl = zataResult.publicUrl;
        console.log('[vectorizeForCanvas] Image uploaded to Zata:', {
          originalUrl: request.image?.substring(0, 100),
          zataUrl: imageUrl?.substring(0, 100),
        });
      } catch (uploadError: any) {
        console.warn('[vectorizeForCanvas] Failed to upload image to Zata, using original URL:', uploadError.message);
        // Continue with original URL - let FAL API try to download it
      }
    }

    // Handle "Detailed" mode: First process through Google Nano Banana, then vectorize
    if (request.mode === 'Detailed') {
      console.log('[vectorizeForCanvas] Detailed mode: Processing through Google Nano Banana first');

      // Step 1: Process image through Google Nano Banana with image-to-image
      const nanoBananaPrompt = 'create a simple flat 2d vector style image, minimal colours';
      const creator = await authRepository.getUserById(uid);
      const username = creator?.username || uid;
      const canvasKeyPrefix = `users/${username}/canvas/${request.projectId}`;

      const nanoBananaResult = await falService.generate(uid, {
        prompt: nanoBananaPrompt,
        model: 'gemini-25-flash-image', // Google Nano Banana
        uploadedImages: [imageUrl], // Image-to-image generation
        aspect_ratio: '1:1', // Default aspect ratio
        num_images: 1,
        storageKeyPrefixOverride: canvasKeyPrefix,
        forceSyncUpload: true,
        isPublic: false,
      });

      console.log('[vectorizeForCanvas] Google Nano Banana completed:', {
        hasImages: !!nanoBananaResult.images,
        imageCount: nanoBananaResult.images?.length || 0,
      });

      // Extract the processed image from Nano Banana result
      const processedImage = nanoBananaResult.images && Array.isArray(nanoBananaResult.images) && nanoBananaResult.images.length > 0
        ? nanoBananaResult.images[0]
        : null;

      if (!processedImage || !processedImage.url) {
        throw new ApiError('No image returned from Google Nano Banana processing', 500);
      }

      // Use the processed image URL for vectorization
      imageUrl = processedImage.url;
      console.log('[vectorizeForCanvas] Using processed image for vectorization:', {
        processedImageUrl: imageUrl?.substring(0, 100),
      });
    }

    // Step 2: Call FAL Recraft Vectorize service with the (possibly processed) image
    const result = await falService.recraftVectorize(uid, {
      image: imageUrl,
      isPublic: false,
    });

    console.log('[vectorizeForCanvas] Recraft vectorize completed:', {
      hasImages: !!result.images,
      imageCount: result.images?.length || 0,
      hasHistoryId: !!result.historyId,
    });

    // Extract the first image from the result
    const firstImage = result.images && Array.isArray(result.images) && result.images.length > 0
      ? result.images[0]
      : null;

    if (!firstImage || !firstImage.url) {
      throw new ApiError('No image returned from service', 500);
    }

    // Attach canvas project linkage
    try {
      if (result?.historyId && request.projectId) {
        await generationHistoryRepository.update(uid, result.historyId, {
          canvasProjectId: request.projectId
        } as any);
      }
    } catch (e) {
      console.warn('[vectorizeForCanvas] Failed to tag history with canvasProjectId', e);
    }

    return {
      url: firstImage.url,
      storagePath: (firstImage as any).storagePath || firstImage.originalUrl || firstImage.url,
      mediaId: firstImage.id,
      generationId: result.historyId,
    };
  } catch (error: any) {
    console.error('[vectorizeForCanvas] Service error:', {
      message: error.message,
      statusCode: error.statusCode,
      stack: error.stack,
      mode: request.mode,
    });

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      error.message || 'Vectorization failed',
      error.statusCode || error.status || 500
    );
  }
}

// Erase functionality removed - UI only
/*
async function eraseForCanvasCropEditComposite(
  uid: string,
  request: {
    image: string;
    selectionCoords: { x: number; y: number; width: number; height: number };
    projectId: string;
    elementId?: string;
    prompt?: string;
  }
): Promise<{ url: string; storagePath: string; mediaId?: string; generationId?: string }> {
  try {
    console.log('[eraseForCanvasCropEditComposite] ========== CROP-EDIT-COMPOSITE APPROACH ==========');
    console.log('[eraseForCanvasCropEditComposite] Selection:', request.selectionCoords);
    console.log('[eraseForCanvasCropEditComposite] User Prompt:', request.prompt || '(none)');
 
    // Step 1: Download and load original image
    let originalImageBuffer: Buffer;
    try {
      const imageResponse = await axios.get(request.image, {
        responseType: 'arraybuffer',
        validateStatus: () => true,
      });
      if (imageResponse.status < 200 || imageResponse.status >= 300) {
        throw new ApiError(`Failed to download image: HTTP ${imageResponse.status}`, imageResponse.status);
      }
      originalImageBuffer = Buffer.from(imageResponse.data);
    } catch (error: any) {
      throw new ApiError(`Failed to download original image: ${error.message}`, 400);
    }
 
    const originalImage = sharp(originalImageBuffer);
    const originalMetadata = await originalImage.metadata();
    const originalWidth = originalMetadata.width || 1024;
    const originalHeight = originalMetadata.height || 1024;
 
    console.log('[eraseForCanvasCropEditComposite] Original image:', {
      width: originalWidth,
      height: originalHeight,
      format: originalMetadata.format
    });
 
    // Validate selection coordinates
    const { x, y, width, height } = request.selectionCoords;
    if (x < 0 || y < 0 || x + width > originalWidth || y + height > originalHeight) {
      throw new ApiError(`Selection coordinates out of bounds. Image: ${originalWidth}x${originalHeight}, Selection: x=${x}, y=${y}, w=${width}, h=${height}`, 400);
    }
 
    // Step 2: Crop the selected region (create a clone to avoid mutating originalImage)
    const croppedRegionBuffer = await sharp(originalImageBuffer)
      .extract({
        left: Math.round(x),
        top: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
      })
      .png()
      .toBuffer();
 
    const croppedRegionBase64 = croppedRegionBuffer.toString('base64');
    const croppedRegionDataUrl = `data:image/png;base64,${croppedRegionBase64}`;
 
    console.log('[eraseForCanvasCropEditComposite] Cropped region:', {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      croppedSize: croppedRegionBuffer.length
    });
 
    // Step 3: Upload cropped region to storage for Runway
    const croppedRegionResult = await uploadBufferToZata(
      `users/${uid}/canvas/${request.projectId}/erase_crop_${Date.now()}.png`,
      croppedRegionBuffer,
      'image/png'
    );
    const croppedRegionUrl = croppedRegionResult.publicUrl;
 
    console.log('[eraseForCanvasCropEditComposite] Cropped region uploaded:', croppedRegionUrl);
 
    // Step 4: Calculate aspect ratio for cropped region
    // Runway requires: ratio >= 0.5 (width/height) and must be one of the allowed ratios
    const croppedRatio = width / height;
    
    // Check if ratio is too narrow (less than 0.5)
    let needsPadding = false;
    let paddedHeight = Math.round(height);
    if (croppedRatio < 0.5) {
      needsPadding = true;
      // Pad the cropped region to meet minimum ratio requirement
      const minWidth = Math.ceil(height * 0.5);
      const paddingNeeded = minWidth - width;
      const leftPadding = Math.floor(paddingNeeded / 2);
      const rightPadding = paddingNeeded - leftPadding;
      
      console.log('[eraseForCanvasCropEditComposite] Cropped region too narrow, padding required:', {
        originalWidth: width,
        originalHeight: height,
        ratio: croppedRatio,
        minWidth,
        leftPadding,
        rightPadding
      });
      
      // Re-crop with padding (extend left and right)
      const paddedX = Math.max(0, Math.round(x - leftPadding));
      const paddedWidth = Math.min(originalWidth - paddedX, Math.round(width + paddingNeeded));
      
      const croppedRegionBufferPadded = await sharp(originalImageBuffer)
        .extract({
          left: paddedX,
          top: Math.round(y),
          width: paddedWidth,
          height: Math.round(height)
        })
        .png()
        .toBuffer();
      
      // Update selection coordinates for later compositing
      const adjustedX = paddedX;
      const adjustedWidth = paddedWidth;
      
      // Use padded buffer
      const croppedRegionBuffer = croppedRegionBufferPadded;
      
      // Recalculate ratio with padded dimensions
      const paddedRatio = paddedWidth / height;
      
      // Map to closest Runway-supported ratio (exact allowed values)
      const runwayRatios: Array<{ ratio: number; value: string }> = [
        { ratio: 1, value: '1024:1024' },
        { ratio: 1, value: '1080:1080' },
        { ratio: 1168/880, value: '1168:880' },
        { ratio: 1360/768, value: '1360:768' },
        { ratio: 4/3, value: '1440:1080' },
        { ratio: 3/4, value: '1080:1440' },
        { ratio: 1808/768, value: '1808:768' },
        { ratio: 16/9, value: '1920:1080' },
        { ratio: 9/16, value: '1080:1920' },
        { ratio: 2112/912, value: '2112:912' },
        { ratio: 16/9, value: '1280:720' },
        { ratio: 9/16, value: '720:1280' },
        { ratio: 1, value: '720:720' },
        { ratio: 4/3, value: '960:720' },
        { ratio: 3/4, value: '720:960' },
        { ratio: 1680/720, value: '1680:720' },
      ];
      
      let aspectRatio = '1024:1024'; // Default
      let minDiff = Infinity;
      for (const r of runwayRatios) {
        const diff = Math.abs(paddedRatio - r.ratio);
        if (diff < minDiff) {
          minDiff = diff;
          aspectRatio = r.value;
        }
      }
      
      console.log('[eraseForCanvasCropEditComposite] Padded region:', {
        paddedX: adjustedX,
        paddedWidth: adjustedWidth,
        paddedRatio,
        selectedAspectRatio: aspectRatio
      });
      
      // Update coordinates for compositing (we'll composite the edited region at the original x, y)
      // But we need to remember the padding for later
      const paddingInfo = { leftPadding, rightPadding, adjustedX, adjustedWidth };
      
      // Continue with padded buffer and adjusted coordinates
      const croppedRegionBase64 = croppedRegionBuffer.toString('base64');
      const croppedRegionDataUrl = `data:image/png;base64,${croppedRegionBase64}`;
      
      console.log('[eraseForCanvasCropEditComposite] Cropped region (with padding):', {
        x: adjustedX,
        y: Math.round(y),
        width: adjustedWidth,
        height: Math.round(height),
        croppedSize: croppedRegionBuffer.length
      });
      
      // Upload padded cropped region
      const croppedRegionResult = await uploadBufferToZata(
        `users/${uid}/canvas/${request.projectId}/erase_crop_${Date.now()}.png`,
        croppedRegionBuffer,
        'image/png'
      );
      const croppedRegionUrl = croppedRegionResult.publicUrl;
      
      console.log('[eraseForCanvasCropEditComposite] Cropped region uploaded:', croppedRegionUrl);
      
      // Create prompt
      const basePrompt = request.prompt && request.prompt.trim()
        ? `${request.prompt.trim()}. Remove the object and fill with natural background that matches the surrounding area.`
        : 'Remove the object and fill with natural background that seamlessly matches the surrounding area, maintaining the same lighting, colors, and textures.';
      
      console.log('[eraseForCanvasCropEditComposite] Prompt for cropped region:', basePrompt);
      console.log('[eraseForCanvasCropEditComposite] Aspect ratio:', aspectRatio);
      
      // Send to Runway
      const runwayPayload: any = {
        promptText: basePrompt,
        model: 'gen4_image_turbo',
        ratio: aspectRatio as any,
        generationType: 'text-to-image',
        referenceImages: [
          { uri: croppedRegionUrl }
        ],
      };
      
      console.log('[eraseForCanvasCropEditComposite] Sending cropped region to Runway...');
      const taskResult = await runwayService.textToImage(uid, runwayPayload);
      
      if (!taskResult.taskId || !taskResult.historyId) {
        throw new ApiError('Runway image generation failed', 500);
      }
      
      // Poll for completion
      const maxWaitTime = 5 * 60 * 1000;
      const pollInterval = 2000;
      const startTime = Date.now();
      let completed = false;
      let finalHistory: any = null;
      
      console.log('[eraseForCanvasCropEditComposite] Polling for Runway completion...');
      while (!completed && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        try {
          await runwayService.getStatus(uid, taskResult.taskId);
          finalHistory = await generationHistoryRepository.get(uid, taskResult.historyId);
          if (finalHistory && finalHistory.status === 'completed' && finalHistory.images && Array.isArray(finalHistory.images) && finalHistory.images.length > 0) {
            completed = true;
            break;
          }
          if (finalHistory && finalHistory.status === 'failed') {
            throw new ApiError('Image erase failed', 500);
          }
        } catch (pollError: any) {
          console.warn('[eraseForCanvasCropEditComposite] Poll error:', pollError);
        }
      }
      
      if (!completed || !finalHistory || !finalHistory.images || finalHistory.images.length === 0) {
        throw new ApiError('Image erase timed out or failed', 500);
      }
      
      const firstImage = finalHistory.images[0];
      if (!firstImage || !firstImage.url) {
        throw new ApiError('Runway image generation completed but no image URL was returned', 500);
      }
      
      const editedRegionUrl = firstImage.url;
      console.log('[eraseForCanvasCropEditComposite] Edited region received:', {
        url: editedRegionUrl,
        hasUrl: !!editedRegionUrl,
        imageObject: firstImage
      });
      
      // Download edited region
      let editedRegionBuffer: Buffer;
      try {
        const editedResponse = await axios.get(editedRegionUrl, {
          responseType: 'arraybuffer',
          validateStatus: () => true,
        });
        if (editedResponse.status < 200 || editedResponse.status >= 300) {
          throw new ApiError(`Failed to download edited region: HTTP ${editedResponse.status}`, editedResponse.status);
        }
        editedRegionBuffer = Buffer.from(editedResponse.data);
      } catch (error: any) {
        throw new ApiError(`Failed to download edited region: ${error.message}`, 400);
      }
      
      // When padding was used, extract the center portion that matches the original selection
      // Otherwise, resize to match the selection size
      let regionToComposite: Buffer;
      
      if (needsPadding) {
        // Get the edited region dimensions
        const editedMetadata = await sharp(editedRegionBuffer).metadata();
        const editedWidth = editedMetadata.width || adjustedWidth;
        const editedHeight = editedMetadata.height || Math.round(height);
        
        // Calculate the center crop position (remove the padding we added)
        const leftCrop = Math.round((editedWidth - width) / 2);
        
        regionToComposite = await sharp(editedRegionBuffer)
          .extract({
            left: leftCrop,
            top: 0,
            width: Math.round(width),
            height: Math.round(height)
          })
          .png()
          .toBuffer();
        
        console.log('[eraseForCanvasCropEditComposite] Extracted center portion from padded result:', {
          editedDimensions: { width: editedWidth, height: editedHeight },
          leftCrop,
          extractedSize: { width: Math.round(width), height: Math.round(height) }
        });
      } else {
        // No padding - resize to match selection size
        regionToComposite = await sharp(editedRegionBuffer)
          .resize(Math.round(width), Math.round(height), {
            fit: 'fill'
          })
          .png()
          .toBuffer();
        
        console.log('[eraseForCanvasCropEditComposite] Resized to match selection size:', {
          width: Math.round(width),
          height: Math.round(height)
        });
      }
      
      // Composite edited region back into original image at original coordinates
      const finalComposite = await sharp(originalImageBuffer)
        .composite([
          {
            input: regionToComposite,
            left: Math.round(x),
            top: Math.round(y)
          }
        ])
        .png()
        .toBuffer();
      
      console.log('[eraseForCanvasCropEditComposite] Final composite created');
      
      // Upload final composite
      const finalResult = await uploadBufferToZata(
        `users/${uid}/canvas/${request.projectId}/erase_result_${Date.now()}.png`,
        finalComposite,
        'image/png'
      );
      
      const finalUrl = finalResult.publicUrl;
      const storagePath = finalResult.key;
      
      console.log('[eraseForCanvasCropEditComposite] Final composite uploaded:', finalUrl);
      console.log('[eraseForCanvasCropEditComposite] =========================================');
      
      return {
        url: finalUrl,
        storagePath,
        generationId: taskResult.historyId
      };
    }
    
    // Normal case: ratio is >= 0.5, proceed without padding
    // Map to closest Runway-supported ratio (exact allowed values)
    const runwayRatios: Array<{ ratio: number; value: string }> = [
      { ratio: 1, value: '1024:1024' },
      { ratio: 1, value: '1080:1080' },
      { ratio: 1168/880, value: '1168:880' },
      { ratio: 1360/768, value: '1360:768' },
      { ratio: 4/3, value: '1440:1080' },
      { ratio: 3/4, value: '1080:1440' },
      { ratio: 1808/768, value: '1808:768' },
      { ratio: 16/9, value: '1920:1080' },
      { ratio: 9/16, value: '1080:1920' },
      { ratio: 2112/912, value: '2112:912' },
      { ratio: 16/9, value: '1280:720' },
      { ratio: 9/16, value: '720:1280' },
      { ratio: 1, value: '720:720' },
      { ratio: 4/3, value: '960:720' },
      { ratio: 3/4, value: '720:960' },
      { ratio: 1680/720, value: '1680:720' },
    ];
    
    let aspectRatio = '1024:1024'; // Default
    let minDiff = Infinity;
    for (const r of runwayRatios) {
      const diff = Math.abs(croppedRatio - r.ratio);
      if (diff < minDiff) {
        minDiff = diff;
        aspectRatio = r.value;
      }
    }
 
    // Step 5: Create prompt for erasing the cropped region
    const basePrompt = request.prompt && request.prompt.trim()
      ? `${request.prompt.trim()}. Remove the object and fill with natural background that matches the surrounding area.`
      : 'Remove the object and fill with natural background that seamlessly matches the surrounding area, maintaining the same lighting, colors, and textures.';
 
    console.log('[eraseForCanvasCropEditComposite] Prompt for cropped region:', basePrompt);
    console.log('[eraseForCanvasCropEditComposite] Aspect ratio:', aspectRatio);
 
    // Step 6: Send cropped region to Runway image-to-image (no mask, just the cropped image)
    const runwayPayload: any = {
      promptText: basePrompt,
      model: 'gen4_image_turbo',
      ratio: aspectRatio as any,
      generationType: 'text-to-image',
      referenceImages: [
        { uri: croppedRegionUrl } // Only the cropped region, no mask
      ],
    };
 
    console.log('[eraseForCanvasCropEditComposite] Sending cropped region to Runway...');
    const taskResult = await runwayService.textToImage(uid, runwayPayload);
 
    if (!taskResult.taskId) {
      throw new ApiError('Runway image generation failed: no taskId returned', 500);
    }
 
    if (!taskResult.historyId) {
      throw new ApiError('Runway image generation failed: no historyId returned', 500);
    }
 
    // Step 7: Poll for completion
    const maxWaitTime = 5 * 60 * 1000; // 5 minutes
    const pollInterval = 2000; // 2 seconds
    const startTime = Date.now();
    let completed = false;
    let finalHistory: any = null;
 
    console.log('[eraseForCanvasCropEditComposite] Polling for Runway completion...');
    while (!completed && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      try {
        await runwayService.getStatus(uid, taskResult.taskId);
        finalHistory = await generationHistoryRepository.get(uid, taskResult.historyId);
        if (finalHistory && finalHistory.status === 'completed' && finalHistory.images && Array.isArray(finalHistory.images) && finalHistory.images.length > 0) {
          completed = true;
          break;
        }
        if (finalHistory && finalHistory.status === 'failed') {
          throw new ApiError('Image erase failed', 500);
        }
      } catch (pollError: any) {
        console.warn('[eraseForCanvasCropEditComposite] Poll error:', pollError);
      }
    }
 
    if (!completed || !finalHistory || !finalHistory.images || finalHistory.images.length === 0) {
      throw new ApiError('Image erase timed out or failed', 500);
    }
 
    const firstImageNormal = finalHistory.images[0];
    if (!firstImageNormal || !firstImageNormal.url) {
      throw new ApiError('Runway image generation completed but no image URL was returned', 500);
    }
 
    const editedRegionUrl = firstImageNormal.url;
    console.log('[eraseForCanvasCropEditComposite] Edited region received:', {
      url: editedRegionUrl,
      hasUrl: !!editedRegionUrl,
      imageObject: firstImageNormal
    });
 
    // Step 8: Download edited region
    let editedRegionBuffer: Buffer;
    try {
      const editedResponse = await axios.get(editedRegionUrl, {
        responseType: 'arraybuffer',
        validateStatus: () => true,
      });
      if (editedResponse.status < 200 || editedResponse.status >= 300) {
        throw new ApiError(`Failed to download edited region: HTTP ${editedResponse.status}`, editedResponse.status);
      }
      editedRegionBuffer = Buffer.from(editedResponse.data);
    } catch (error: any) {
      throw new ApiError(`Failed to download edited region: ${error.message}`, 400);
    }
 
    // Step 9: Resize edited region to match original selection size (in case Runway changed dimensions)
    const editedRegionResized = await sharp(editedRegionBuffer)
      .resize(Math.round(width), Math.round(height), {
        fit: 'fill' // Maintain exact dimensions
      })
      .png()
      .toBuffer();
 
    console.log('[eraseForCanvasCropEditComposite] Edited region resized to match selection:', {
      width: Math.round(width),
      height: Math.round(height)
    });
 
    // Step 10: Composite edited region back into original image
    // Create a fresh instance of the original image for compositing
    const finalComposite = await sharp(originalImageBuffer)
      .composite([
        {
          input: editedRegionResized,
          left: Math.round(x),
          top: Math.round(y)
        }
      ])
      .png()
      .toBuffer();
 
    console.log('[eraseForCanvasCropEditComposite] Final composite created');
 
    // Step 11: Upload final composite to storage
    const finalResult = await uploadBufferToZata(
      `users/${uid}/canvas/${request.projectId}/erase_result_${Date.now()}.png`,
      finalComposite,
      'image/png'
    );
 
    const finalUrl = finalResult.publicUrl;
    const storagePath = finalResult.key;
 
    console.log('[eraseForCanvasCropEditComposite] Final composite uploaded:', finalUrl);
    console.log('[eraseForCanvasCropEditComposite] =========================================');
 
    return {
      url: finalUrl,
      storagePath,
      generationId: taskResult.historyId
    };
  } catch (error: any) {
    console.error('[eraseForCanvasCropEditComposite] Error:', error);
    throw error;
  }
}
 
 
 
/**
 * Erase objects from image using Google Nano Banana edit model
 * Uses mask-based editing where white areas = erase, black areas = keep
 */
export async function eraseForCanvas(
  uid: string,
  request: {
    image: string; // Original image URL
    mask?: string; // Mask data URL (white = erase, black = keep)
    projectId: string;
    elementId?: string;
    prompt?: string; // Optional user prompt (will be combined with base prompt)
  }
): Promise<{ url: string; storagePath: string; mediaId?: string; generationId?: string }> {
  try {
    if (!request.image) {
      throw new ApiError('Image is required', 400);
    }

    // Mask is now optional - image should be composited with white mask overlay
    // The composited image already contains the mask, so mask parameter is not required
    if (request.mask) {
      console.log('[eraseForCanvas] Mask provided but will be ignored (using composited image)');
    }

    console.log('[eraseForCanvas] Starting erase with Google Nano Banana:', {
      userId: uid,
      hasImage: !!request.image,
      hasMask: !!request.mask,
      maskNote: request.mask ? 'Mask provided but will be ignored (using composited image)' : 'No mask (using composited image)',
      projectId: request.projectId,
      userPrompt: request.prompt || '(none)',
    });

    // Create generation history record
    const creator = await authRepository.getUserById(uid);
    const username = creator?.username || uid;

    // Create history record - Firestore will auto-generate the ID
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: request.prompt || 'Erase selected area',
      model: 'google-gemini-flash-edit',
      generationType: 'image-to-image',
      isPublic: false,
      createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
    });

    console.log('[eraseForCanvas] Created history record:', { historyId });

    // Link to canvas project
    try {
      await generationHistoryRepository.update(uid, historyId, {
        canvasProjectId: request.projectId,
      } as any);
    } catch (e) {
      console.warn('[eraseForCanvas] Failed to link to canvas project:', e);
    }

    // Base prompts for different modes
    const eraseBasePrompt = 'Edit ONLY the white masked region. Keep the ENTIRE unmasked image IDENTICAL - do not modify any pixels outside the white mask. Reconstruct the masked area with natural continuation that seamlessly matches the surrounding environment. Maintain the EXACT original camera angle, lighting conditions, color temperature, color saturation, vibrancy, brightness, contrast, white balance, and depth of field. Preserve the original image quality, sharpness, color richness, and overall visual appearance. CRITICAL: The unmasked areas must remain pixel-perfect identical to the original image with no color shifts, desaturation, or quality degradation. Do not add new objects or alter any existing ones outside the mask. The result must blend seamlessly while maintaining the original image\'s exact color palette, temperature, and visual characteristics.';

    const replaceBasePrompt = 'Replace ONLY the white masked region with the requested object/content. The replacement must naturally blend into the scene and match the style of the original image. Keep the ENTIRE unmasked area pixel-perfect identical — do not modify any pixels outside the mask. Maintain the original camera perspective, lighting direction, color temperature, shadows, reflections, texture sharpness, and depth of field. Ensure the replaced object fits realistically into the environment, scaled and positioned naturally. Match the original visual quality, contrast, brightness, and color palette. No new elements should appear outside the masked area. The final result must look like the new object was originally part of the photo.';

    // Determine if this is a Replace or Erase operation
    const userPrompt = request.prompt ? request.prompt.trim() : '';
    const isReplaceOperation = userPrompt.length > 0 &&
      userPrompt.toLowerCase() !== 'remove object' &&
      userPrompt.toLowerCase() !== 'erase';

    // Combine user prompt with appropriate base prompt
    let finalPrompt = '';

    if (isReplaceOperation) {
      console.log('[eraseForCanvas] Detected REPLACE operation with prompt:', userPrompt);
      finalPrompt = `${userPrompt}. ${replaceBasePrompt}`;
    } else {
      console.log('[eraseForCanvas] Detected ERASE operation (defaulting to remove object)');
      finalPrompt = `remove object. ${eraseBasePrompt}`;
    }

    console.log('[eraseForCanvas] Using prompt:', finalPrompt);
    console.log('[eraseForCanvas] Received image and mask:', {
      hasImage: !!request.image,
      hasMask: !!request.mask,
      imageType: request.image?.startsWith('data:image') ? 'data URI' : request.image?.startsWith('http') ? 'URL' : 'unknown',
      maskType: request.mask?.startsWith('data:image') ? 'data URI' : request.mask?.startsWith('http') ? 'URL' : 'unknown',
      imagePreview: request.image ? (request.image.substring(0, 100) + '...') : 'null',
      maskPreview: request.mask ? (request.mask.substring(0, 100) + '...') : 'null'
    });

    // Upload original image to Zata if it's a data URI
    let originalImageUrl = request.image;
    if (request.image && request.image.startsWith('data:image')) {
      console.log('[eraseForCanvas] Uploading original image to Zata...');
      const { uploadDataUriToZata } = await import('../../utils/storage/zataUpload');
      const imageUpload = await uploadDataUriToZata({
        dataUri: request.image,
        keyPrefix: `users/${username}/canvas/${request.projectId}`,
        fileName: `erase-original-${Date.now()}`,
      });
      originalImageUrl = imageUpload.publicUrl;
      console.log('[eraseForCanvas] ✅ Original image uploaded to Zata:', originalImageUrl);
    } else {
      console.log('[eraseForCanvas] Image is already a URL, using directly:', originalImageUrl);
    }

    // Upload mask to Zata if it's a data URI
    let maskUrl: string | null = null;
    if (request.mask) {
      if (request.mask.startsWith('data:image')) {
        console.log('[eraseForCanvas] Uploading mask to Zata...');
        const { uploadDataUriToZata } = await import('../../utils/storage/zataUpload');
        const maskUpload = await uploadDataUriToZata({
          dataUri: request.mask,
          keyPrefix: `users/${username}/canvas/${request.projectId}`,
          fileName: `erase-mask-${Date.now()}`,
        });
        maskUrl = maskUpload.publicUrl;
        console.log('[eraseForCanvas] ✅ Mask uploaded to Zata:', maskUrl);
      } else {
        maskUrl = request.mask;
        console.log('[eraseForCanvas] Mask is already a URL, using directly:', maskUrl);
      }
    }

    // Create composited image server-side using sharp for better quality control
    // This preserves the original image quality while adding the mask
    let compositedImageUrl: string;
    if (maskUrl) {
      console.log('[eraseForCanvas] Creating composited image server-side with sharp...');
      const axios = (await import('axios')).default;
      const sharp = (await import('sharp')).default;

      // Download original image
      const imageResponse = await axios.get(originalImageUrl, { responseType: 'arraybuffer' });
      const originalImageBuffer = Buffer.from(imageResponse.data);

      // If originalImageUrl is a local/proxy URL (e.g. localhost), we must upload the original image
      // to Zata so FAL can access it.
      if (originalImageUrl.includes('localhost') || originalImageUrl.includes('127.0.0.1')) {
        console.log('[eraseForCanvas] Original image is local/proxy, uploading to Zata...');
        const { uploadBufferToZata } = await import('../../utils/storage/zataUpload');
        const originalUpload = await uploadBufferToZata(
          `users/${username}/canvas/${request.projectId}/erase-original-${Date.now()}.png`,
          originalImageBuffer,
          'image/png'
        );
        originalImageUrl = originalUpload.publicUrl;
        console.log('[eraseForCanvas] ✅ Original image uploaded to Zata:', originalImageUrl);
      }

      // Download mask
      const maskResponse = await axios.get(maskUrl, { responseType: 'arraybuffer' });
      const maskBuffer = Buffer.from(maskResponse.data);

      // Get original image dimensions
      const originalMetadata = await sharp(originalImageBuffer).metadata();
      const originalWidth = originalMetadata.width || 1024;
      const originalHeight = originalMetadata.height || 1024;

      // Resize mask to match original image dimensions
      const resizedMask = await sharp(maskBuffer)
        .resize(originalWidth, originalHeight, { fit: 'fill' })
        .toBuffer();

      // Composite: draw original image, then overlay mask using 'screen' blend mode
      // 'screen' blend mode makes white areas visible without darkening the original image
      // This preserves the original image colors and quality while clearly showing the white mask
      const compositedBuffer = await sharp(originalImageBuffer)
        .composite([{
          input: resizedMask,
          blend: 'screen' // Screen blend mode - white mask shows clearly without affecting original colors
        }])
        .png()
        .toBuffer();

      // Upload composited image
      const { uploadBufferToZata } = await import('../../utils/storage/zataUpload');
      const compositedUpload = await uploadBufferToZata(
        `users/${username}/canvas/${request.projectId}/erase-composited-${Date.now()}.png`,
        compositedBuffer,
        'image/png'
      );
      compositedImageUrl = compositedUpload.publicUrl;
      console.log('[eraseForCanvas] ✅ Composited image created and uploaded:', compositedImageUrl);
    } else {
      // No mask provided, use original image
      compositedImageUrl = originalImageUrl;
      console.log('[eraseForCanvas] No mask provided, using original image only');
    }

    // Process with Google Nano Banana edit
    // improved: pass original image + mask explicitly if we have them
    // this allows the model to see the original context under the mask if needed (though usually it just needs the mask)
    // and avoids "white hole" artifacts if the model expects to do the masking itself
    // const { processGoogleGeminiFlash } = await import('../replaceService'); // Replaced with static import

    // If we have a mask URL, use the original image + mask URL for standard inpainting
    // Otherwise fallback to the composited image (if for some reason we only have that)
    const imageInput = maskUrl ? originalImageUrl : compositedImageUrl;
    const maskInput = maskUrl || null;

    console.log('[eraseForCanvas] calling processGoogleGeminiFlash with:', {
      usingOriginalImage: imageInput === originalImageUrl,
      hasMask: !!maskInput
    });

    const result = await processGoogleGeminiFlash(
      uid,
      imageInput,
      maskInput,
      finalPrompt,
      historyId
    );

    // Update history with result
    await generationHistoryRepository.update(uid, historyId, {
      status: 'completed',
      images: [{
        id: `${historyId}-1`,
        url: result.publicUrl,
        storagePath: result.key,
        originalUrl: result.publicUrl,
      }],
    } as any);

    console.log('[eraseForCanvas] Erase completed:', {
      hasUrl: !!result.publicUrl,
      storagePath: result.key,
    });

    return {
      url: result.publicUrl,
      storagePath: result.key,
      generationId: historyId,
    };
  } catch (error: any) {
    console.error('[eraseForCanvas] Error:', error);

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      error.message || 'Image erase failed',
      error.statusCode || error.status || 500
    );
  }
}

/**
 * Replace objects in image using Google Nano Banana edit model
 * Uses mask-based editing where white areas = replace, black areas = keep
 * REQUIRES prompt - user must specify what to replace the white area with
 */
export async function replaceForCanvas(
  uid: string,
  request: {
    image: string; // Original image URL
    mask?: string; // Mask data URL (white = replace, black = keep)
    projectId: string;
    elementId?: string;
    prompt: string; // REQUIRED user prompt (what to replace the white area with)
  }
): Promise<{ url: string; storagePath: string; mediaId?: string; generationId?: string }> {
  try {
    if (!request.image) {
      throw new ApiError('Image is required', 400);
    }

    // Prompt is REQUIRED for replace (unlike erase which has a default)
    if (!request.prompt || !request.prompt.trim()) {
      throw new ApiError('Prompt is required for image replace. Please describe what you want to replace the selected area with.', 400);
    }

    // Mask is now optional - image should be composited with white mask overlay
    // The composited image already contains the mask, so mask parameter is not required
    if (request.mask) {
      console.log('[replaceForCanvas] Mask provided but will be ignored (using composited image)');
    }

    console.log('[replaceForCanvas] Starting replace with Google Nano Banana:', {
      userId: uid,
      hasImage: !!request.image,
      hasMask: !!request.mask,
      maskNote: request.mask ? 'Mask provided but will be ignored (using composited image)' : 'No mask (using composited image)',
      projectId: request.projectId,
      userPrompt: request.prompt || '(MISSING - will fail)',
    });

    // Create generation history record
    const creator = await authRepository.getUserById(uid);
    const username = creator?.username || uid;

    // Create history record - Firestore will auto-generate the ID
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: request.prompt.trim(), // Store user's prompt
      model: 'google-nano-banana-edit',
      generationType: 'image-to-image',
      isPublic: false,
      createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
    });

    console.log('[replaceForCanvas] Created history record:', { historyId });

    // Link to canvas project
    try {
      await generationHistoryRepository.update(uid, historyId, {
        canvasProjectId: request.projectId,
      } as any);
    } catch (e) {
      console.warn('[replaceForCanvas] Failed to link to canvas project:', e);
    }

    // For replace, use the user's prompt directly (what to replace the white area with)
    // Combine with base instruction to ensure only masked area is modified
    const baseInstruction = 'Edit ONLY the white masked region. Keep the ENTIRE unmasked image IDENTICAL - do not modify any pixels outside the white mask. Replace the masked area with the requested content. Maintain the EXACT original camera angle, lighting conditions, color temperature, color saturation, vibrancy, brightness, contrast, white balance, and depth of field. Preserve the original image quality, sharpness, color richness, and overall visual appearance. CRITICAL: The unmasked areas must remain pixel-perfect identical to the original image with no color shifts, desaturation, or quality degradation.';

    // User's prompt describes what to replace the white area with
    const finalPrompt = `${request.prompt.trim()}. ${baseInstruction}`;

    console.log('[replaceForCanvas] Using prompt:', finalPrompt);
    console.log('[replaceForCanvas] Received image and mask:', {
      hasImage: !!request.image,
      hasMask: !!request.mask,
      imageType: request.image?.startsWith('data:image') ? 'data URI' : request.image?.startsWith('http') ? 'URL' : 'unknown',
      maskType: request.mask?.startsWith('data:image') ? 'data URI' : request.mask?.startsWith('http') ? 'URL' : 'unknown',
      imagePreview: request.image ? (request.image.substring(0, 100) + '...') : 'null',
      maskPreview: request.mask ? (request.mask.substring(0, 100) + '...') : 'null'
    });

    // Upload original image to Zata if it's a data URI
    let originalImageUrl = request.image;
    if (request.image && request.image.startsWith('data:image')) {
      console.log('[replaceForCanvas] Uploading original image to Zata...');
      const { uploadDataUriToZata } = await import('../../utils/storage/zataUpload');
      const imageUpload = await uploadDataUriToZata({
        dataUri: request.image,
        keyPrefix: `users/${username}/canvas/${request.projectId}`,
        fileName: `replace-original-${Date.now()}`,
      });
      originalImageUrl = imageUpload.publicUrl;
      console.log('[replaceForCanvas] ✅ Original image uploaded to Zata:', originalImageUrl);
    } else {
      console.log('[replaceForCanvas] Image is already a URL, using directly:', originalImageUrl);
    }

    // Upload mask to Zata if it's a data URI
    let maskUrl: string | null = null;
    if (request.mask) {
      if (request.mask.startsWith('data:image')) {
        console.log('[replaceForCanvas] Uploading mask to Zata...');
        const { uploadDataUriToZata } = await import('../../utils/storage/zataUpload');
        const maskUpload = await uploadDataUriToZata({
          dataUri: request.mask,
          keyPrefix: `users/${username}/canvas/${request.projectId}`,
          fileName: `replace-mask-${Date.now()}`,
        });
        maskUrl = maskUpload.publicUrl;
        console.log('[replaceForCanvas] ✅ Mask uploaded to Zata:', maskUrl);
      } else {
        maskUrl = request.mask;
        console.log('[replaceForCanvas] Mask is already a URL, using directly:', maskUrl);
      }
    }

    // Create composited image server-side using sharp for better quality control
    // This preserves the original image quality while adding the mask
    let compositedImageUrl: string;
    if (maskUrl) {
      console.log('[replaceForCanvas] Creating composited image server-side with sharp...');
      const axios = (await import('axios')).default;
      const sharp = (await import('sharp')).default;

      // Download original image
      const imageResponse = await axios.get(originalImageUrl, { responseType: 'arraybuffer' });
      const originalImageBuffer = Buffer.from(imageResponse.data);

      // Download mask
      const maskResponse = await axios.get(maskUrl, { responseType: 'arraybuffer' });
      const maskBuffer = Buffer.from(maskResponse.data);

      // Get original image dimensions
      const originalMetadata = await sharp(originalImageBuffer).metadata();
      const originalWidth = originalMetadata.width || 1024;
      const originalHeight = originalMetadata.height || 1024;

      // Resize mask to match original image dimensions
      const resizedMask = await sharp(maskBuffer)
        .resize(originalWidth, originalHeight, { fit: 'fill' })
        .toBuffer();

      // Composite: draw original image, then overlay mask using 'screen' blend mode
      // 'screen' blend mode makes white areas visible without darkening the original image
      // This preserves the original image colors and quality while clearly showing the white mask
      const compositedBuffer = await sharp(originalImageBuffer)
        .composite([{
          input: resizedMask,
          blend: 'screen' // Screen blend mode - white mask shows clearly without affecting original colors
        }])
        .png()
        .toBuffer();

      // Upload composited image
      const { uploadBufferToZata } = await import('../../utils/storage/zataUpload');
      const compositedUpload = await uploadBufferToZata(
        `users/${username}/canvas/${request.projectId}/replace-composited-${Date.now()}.png`,
        compositedBuffer,
        'image/png'
      );
      compositedImageUrl = compositedUpload.publicUrl;
      console.log('[replaceForCanvas] ✅ Composited image created and uploaded:', compositedImageUrl);
    } else {
      // No mask provided, use original image
      compositedImageUrl = originalImageUrl;
      console.log('[replaceForCanvas] No mask provided, using original image only');
    }

    // Process with Google Nano Banana edit - send the composited image
    // const { processGoogleGeminiFlash } = await import('../replaceService'); // Replaced with static import
    const result = await processGoogleGeminiFlash(
      uid,
      compositedImageUrl,
      null, // No separate mask - mask is already composited into the image
      finalPrompt,
      historyId
    );

    // Update history with result
    await generationHistoryRepository.update(uid, historyId, {
      status: 'completed',
      images: [{
        id: `${historyId}-1`,
        url: result.publicUrl,
        storagePath: result.key,
        originalUrl: result.publicUrl,
      }],
    } as any);

    console.log('[replaceForCanvas] Replace completed:', {
      hasUrl: !!result.publicUrl,
      storagePath: result.key,
    });

    return {
      url: result.publicUrl,
      storagePath: result.key,
      generationId: historyId,
    };
  } catch (error: any) {
    console.error('[replaceForCanvas] Error:', error);

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      error.message || 'Image replace failed',
      error.statusCode || error.status || 500
    );
  }
}

/* Removed code below
try {
  console.log('[eraseForCanvas] Starting erase:', {
    userId: uid,
    hasImage: !!request.image,
    hasMask: !!request.mask,
    hasSelectionCoords: !!request.selectionCoords,
    selectionCoords: request.selectionCoords,
    projectId: request.projectId,
  });
 
  if (!request.image) {
    throw new ApiError('Image is required', 400);
  }
 
  // Use new crop-edit-composite approach if selectionCoords provided
  if (request.selectionCoords) {
    return await eraseForCanvasCropEditComposite(uid, {
      image: request.image,
      selectionCoords: request.selectionCoords,
      projectId: request.projectId,
      elementId: request.elementId,
      prompt: request.prompt
    });
  }
 
  // Fall back to mask-based approach for backward compatibility
  if (!request.mask) {
    throw new ApiError('Either mask or selectionCoords is required', 400);
  }
 
  // Calculate aspect ratio from image dimensions
  let aspectRatio = '1024:1024'; // Default
  
  try {
    // Probe image to get dimensions
    const imageMeta = await probeImageMeta(request.image);
    if (imageMeta.width && imageMeta.height) {
      // Map to closest Runway-supported ratio
      const width = imageMeta.width;
      const height = imageMeta.height;
      const ratio = width / height;
      
      // Map to Runway-supported ratios
      const runwayRatioMap: Record<string, string> = {
        '1:1': '1024:1024',
        '16:9': '1920:1080',
        '9:16': '1080:1920',
        '4:3': '1360:1020',
        '3:4': '1020:1360',
        '21:9': '2112:912',
        '9:21': '912:2112',
      };
      
      // Find closest match
      if (Math.abs(ratio - 1) < 0.1) aspectRatio = runwayRatioMap['1:1'];
      else if (Math.abs(ratio - 16/9) < 0.1) aspectRatio = runwayRatioMap['16:9'];
      else if (Math.abs(ratio - 9/16) < 0.1) aspectRatio = runwayRatioMap['9:16'];
      else if (Math.abs(ratio - 4/3) < 0.1) aspectRatio = runwayRatioMap['4:3'];
      else if (Math.abs(ratio - 3/4) < 0.1) aspectRatio = runwayRatioMap['3:4'];
      else if (Math.abs(ratio - 21/9) < 0.1) aspectRatio = runwayRatioMap['21:9'];
      else if (Math.abs(ratio - 9/21) < 0.1) aspectRatio = runwayRatioMap['9:21'];
      else {
        // Use actual dimensions rounded to nearest valid ratio
        const roundedWidth = Math.round(width / 100) * 100;
        const roundedHeight = Math.round(height / 100) * 100;
        aspectRatio = `${roundedWidth}:${roundedHeight}`;
      }
      
      console.log('[eraseForCanvas] Calculated aspect ratio:', {
        original: `${width}x${height}`,
        ratio: aspectRatio,
      });
    }
  } catch (e) {
    console.warn('[eraseForCanvas] Could not determine aspect ratio, using default:', e);
  }
 
  // Analyze mask to provide debug info
  let maskAnalysis: any = {};
  try {
    // Try to decode base64 mask if it's a data URL
    if (request.mask && request.mask.startsWith('data:image')) {
      const base64Data = request.mask.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      maskAnalysis = {
        isDataUrl: true,
        dataUrlLength: request.mask.length,
        base64Length: base64Data.length,
        bufferSize: buffer.length,
        format: request.mask.substring(5, request.mask.indexOf(';'))
      };
    } else {
      maskAnalysis = {
        isDataUrl: false,
        maskLength: request.mask?.length || 0,
        maskPreview: request.mask ? request.mask.substring(0, 100) + '...' : 'null'
      };
    }
  } catch (e) {
    maskAnalysis = { error: 'Could not analyze mask', errorMessage: (e as Error).message };
  }
 
  console.log('[eraseForCanvas] ========== ERASE PROCESS DEBUG ==========');
  console.log('[eraseForCanvas] Received Request:', {
    hasImage: !!request.image,
    imageLength: request.image?.length || 0,
    imagePreview: request.image ? request.image.substring(0, 100) + '...' : 'null',
    hasMask: !!request.mask,
    maskAnalysis,
    userPrompt: request.prompt || '(none)',
    projectId: request.projectId,
    aspectRatio
  });
 
  // Use Runway Gen4 Image Turbo for erase/inpainting
  // The mask (white areas) tells Runway what to remove
  // CRITICAL: Prompt must be mask-pixel-specific, not object-specific
  // Combine user prompt (if provided) with predefined prompt
  // User prompt should be specific to the masked/highlighted area only
  
  // Base prompt that explicitly references white pixels in mask, not objects
  // CRITICAL: This prompt must be pixel-specific, not object-specific, to prevent Runway from removing similar objects
  const basePrompt = 'Fill ONLY the white pixels shown in the mask image with background that seamlessly matches the surrounding area. The mask image shows exactly which pixels to change - modify ONLY pixels that are white in the mask. Do not modify any black pixels in the mask. Keep all black mask pixels and everything outside the mask exactly as they appear in the original image. CRITICAL RULES: 1) Do NOT remove or modify anything outside the white mask pixels. 2) Do NOT remove similar objects elsewhere in the image. 3) Do NOT modify black pixels in the mask. 4) Only change pixels that are explicitly white in the mask image. 5) Preserve all unmasked areas pixel-perfect. Maintain the exact same lighting, colors, textures, perspective, camera angle, and viewpoint as the original image.';
  
  console.log('[eraseForCanvas] Base Prompt:', basePrompt);
  console.log('[eraseForCanvas] User Input Prompt:', request.prompt || '(none provided)');
  
  // If user provided a prompt, make it clear it applies only to the white mask pixels
  let finalPrompt: string;
  if (request.prompt && request.prompt.trim()) {
    // User's prompt is about what's in the white mask pixels only
    finalPrompt = `In the white pixels of the mask image only, ${request.prompt.trim()}. ${basePrompt}`;
    console.log('[eraseForCanvas] ✅ Combined Prompt (User + Base):', finalPrompt);
  } else {
    finalPrompt = basePrompt;
    console.log('[eraseForCanvas] ✅ Using Base Prompt Only:', finalPrompt);
  }
  
  const runwayPayload: any = {
    promptText: finalPrompt,
    model: 'gen4_image_turbo',
    ratio: aspectRatio as any,
    generationType: 'text-to-image', // Runway textToImage endpoint handles image-to-image with referenceImages
    // Use referenceImages directly with mask tag
    // First image is the original, second image with tag 'mask' is the mask (white = remove, black = keep)
    referenceImages: [
      { uri: request.image },
      { uri: request.mask, tag: 'mask' }
    ],
  };
 
  console.log('[eraseForCanvas] Runway Payload:', {
    model: runwayPayload.model,
    ratio: runwayPayload.ratio,
    promptText: runwayPayload.promptText,
    promptLength: runwayPayload.promptText.length,
    hasReferenceImages: runwayPayload.referenceImages?.length > 0,
    referenceImageCount: runwayPayload.referenceImages?.length || 0,
    firstImagePreview: runwayPayload.referenceImages?.[0]?.uri ? runwayPayload.referenceImages[0].uri.substring(0, 100) + '...' : 'null',
    maskTag: runwayPayload.referenceImages?.[1]?.tag,
    maskUriPreview: runwayPayload.referenceImages?.[1]?.uri ? runwayPayload.referenceImages[1].uri.substring(0, 100) + '...' : 'null'
  });
  console.log('[eraseForCanvas] =========================================');
 
  // Runway textToImage returns a taskId and status "pending"
  // Note: Runway SDK may not support negative prompts directly, but we include it in the prompt text
  // The negative prompt concepts are incorporated into the main prompt for maximum effect
  const taskResult = await runwayService.textToImage(uid, runwayPayload);
 
  if (!taskResult.taskId) {
    throw new ApiError('Runway image generation failed: no taskId returned', 500);
  }
 
  if (!taskResult.historyId) {
    throw new ApiError('Runway image generation failed: no historyId returned', 500);
  }
 
  // Poll for completion (max 5 minutes, check every 2 seconds)
  // Call getStatus to trigger history updates when Runway completes
  const maxWaitTime = 5 * 60 * 1000; // 5 minutes
  const pollInterval = 2000; // 2 seconds
  const startTime = Date.now();
  let completed = false;
  let finalHistory: any = null;
 
  while (!completed && (Date.now() - startTime) < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    
    try {
      // Call getStatus to check Runway task and trigger history update if completed
      try {
        await runwayService.getStatus(uid, taskResult.taskId);
      } catch (statusError: any) {
        // Ignore status check errors, continue polling history
        console.warn('[eraseForCanvas] Status check error (continuing):', statusError?.message);
      }
      
      // Check the history record which gets updated by getStatus when Runway completes
      finalHistory = await generationHistoryRepository.get(uid, taskResult.historyId);
      if (finalHistory && finalHistory.status === 'completed' && finalHistory.images && Array.isArray(finalHistory.images) && finalHistory.images.length > 0) {
        completed = true;
        break;
      }
      if (finalHistory && finalHistory.status === 'failed') {
        throw new ApiError('Image erase failed', 500);
      }
      
      // Log polling progress
      if ((Date.now() - startTime) % 10000 < pollInterval) {
        console.log('[eraseForCanvas] Polling...', {
          elapsed: Math.round((Date.now() - startTime) / 1000),
          status: finalHistory?.status || 'unknown',
          hasImages: !!finalHistory?.images?.length,
        });
      }
    } catch (pollError: any) {
      console.warn('[eraseForCanvas] Poll error:', pollError);
      // Continue polling
    }
  }
 
  if (!completed || !finalHistory) {
    throw new ApiError('Image erase timed out or failed', 500);
  }
 
  const firstImage = finalHistory.images && Array.isArray(finalHistory.images) && finalHistory.images.length > 0
    ? finalHistory.images[0]
    : null;
 
  if (!firstImage || !firstImage.url) {
    throw new ApiError('No image returned from erase operation', 500);
  }
 
  // Attach canvas project linkage
  try {
    if (taskResult.historyId && request.projectId) {
      await generationHistoryRepository.update(uid, taskResult.historyId, { 
        canvasProjectId: request.projectId 
      } as any);
    }
  } catch (e) {
    console.warn('[eraseForCanvas] Failed to tag history with canvasProjectId', e);
  }
 
  console.log('[eraseForCanvas] Erase completed:', {
    hasUrl: !!firstImage.url,
    hasStoragePath: !!firstImage.storagePath,
  });
 
  return {
    url: firstImage.url,
    storagePath: (firstImage as any).storagePath || firstImage.originalUrl || firstImage.url,
    mediaId: firstImage.id,
    generationId: taskResult.historyId,
  };
} catch (error: any) {
  console.error('[eraseForCanvas] Service error:', {
    message: error.message,
    statusCode: error.statusCode,
    stack: error.stack,
  });
  
  if (error instanceof ApiError) {
    throw error;
  }
  
  throw new ApiError(
    error.message || 'Image erase failed',
    error.statusCode || error.status || 500
  );
}
*/

export async function _generateNextSceneForCanvas(
  uid: string,
  request: {
    image: string;
    prompt: string;
    lora_scale?: number;
    lora_weights?: string;
    true_guidance_scale?: number;
    guidance_scale?: number;
    num_inference_steps?: number;
    aspectRatio?: string;
    mode?: string;
    images?: string[];
    projectId: string;
    elementId?: string;
    meta?: any;
    imageCount?: number;
  }
): Promise<{ mediaId: string; url: string; storagePath: string; generationId?: string; images?: Array<{ mediaId: string; url: string; storagePath: string }> }> {
  // Debug logging
  console.log('[generateNextSceneForCanvas] Request:', {
    projectId: request.projectId,
    elementId: request.elementId,
    prompt: request.prompt,
    hasImage: !!request.image,
    aspectRatio: request.aspectRatio,
  });

  try {
    const creator = await authRepository.getUserById(uid);
    const username = creator?.username || uid;
    const canvasKeyPrefix = `users/${username}/canvas/${request.projectId}`;

    /**
     * Stitch multiple images horizontally using sharp
     */
    async function stitchImages(imageUrls: string[]): Promise<string> {
      if (!imageUrls || imageUrls.length === 0) return '';
      if (imageUrls.length === 1) return imageUrls[0];

      try {
        // Download all images
        const buffers = await Promise.all(
          imageUrls.map(async (url) => {
            if (url.startsWith('data:')) {
              const b64 = url.split(',')[1];
              return Buffer.from(b64, 'base64');
            }
            const resp = await axios.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(resp.data);
          })
        );

        // Get metadata to determine dimensions
        const metas = await Promise.all(buffers.map(b => sharp(b).metadata()));

        // Normalize height to the first image's height (or a standard height like 1024)
        const targetHeight = metas[0]?.height || 1024;

        // Resize all to target height
        const resizedBuffers = await Promise.all(
          buffers.map(b => sharp(b).resize({ height: targetHeight }).toBuffer())
        );

        // Recalculate widths
        const resizedMetas = await Promise.all(resizedBuffers.map(b => sharp(b).metadata()));
        const totalWidth = resizedMetas.reduce((acc, m) => acc + (m.width || 0), 0);

        // Create composite
        const compositeParams = resizedMetas.reduce<{ input: Buffer; left: number; top: number }[]>((acc, m, idx) => {
          const prevWidth = acc.length > 0 ? (acc[acc.length - 1].left + (resizedMetas[idx - 1]?.width || 0)) : 0;
          acc.push({
            input: resizedBuffers[idx],
            left: prevWidth,
            top: 0
          });
          return acc;
        }, []);

        const stitchedBuffer = await sharp({
          create: {
            width: totalWidth,
            height: targetHeight,
            channels: 3,
            background: { r: 255, g: 255, b: 255 }
          }
        })
          .composite(compositeParams)
          .jpeg({ quality: 90 })
          .toBuffer();

        return `data:image/jpeg;base64,${stitchedBuffer.toString('base64')}`;
      } catch (error) {
        console.error('[generateService] Stitching failed:', error);
        throw new Error('Failed to stitch input images');
      }
    }

    // ... inside generateNextSceneForCanvas
    // Handle MultiScene Mode
    let finalInputImage = request.image;

    if (request.mode === 'nextscene' && request.images && request.images.length > 1) {
      console.log('[generateNextSceneForCanvas] MultiScene mode: Stitching images', { count: request.images.length });
      const stitchedDataUri = await stitchImages(request.images);

      // Upload stitched image to Zata so Replicate can access it
      const stitchedUpload = await uploadDataUriToZata({
        dataUri: stitchedDataUri,
        keyPrefix: canvasKeyPrefix,
        fileName: `multiscene-stitched-${Date.now()}`
      });

      finalInputImage = stitchedUpload.publicUrl;
      console.log('[generateNextSceneForCanvas] Stitched image uploaded:', finalInputImage);
    }

    const replicatePayload = {
      image: finalInputImage,
      prompt: request.prompt,
      lora_scale: request.lora_scale,
      lora_weights: request.lora_weights,
      true_guidance_scale: request.true_guidance_scale,
      guidance_scale: request.guidance_scale,
      num_inference_steps: request.num_inference_steps,
      aspect_ratio: request.aspectRatio,
      isPublic: false, // Default to private
      storageKeyPrefixOverride: canvasKeyPrefix,
      mode: request.mode, // Pass mode to service
    };

    const result = await replicateService.nextScene(uid, replicatePayload);

    // Handle single or multiple images
    // nextScene returns images array
    const allImages: Array<{ mediaId: string; url: string; storagePath: string }> = [];
    let imageUrl: string;
    let imageStoragePath: string | undefined;

    if (result.images && Array.isArray(result.images) && result.images.length > 0) {
      for (const img of result.images) {
        const imgUrl = img.url || img.originalUrl || '';
        const imgStoragePath = (img as any).storagePath;

        // Ensure we have a Zata-stored URL
        let finalUrl = imgUrl;
        let finalKey = imgStoragePath || '';
        if (!finalKey || !(finalUrl || '').includes('/users/')) {
          // Should already be handled by service, but double check
          // In nextScene service, we upload to Zata so it should differ
          // If for some reason it's not Zata (fallback), try upload
          // But nextScene logic is robust.
        }

        // Create media record for each image
        const media = await mediaRepository.createMedia({
          url: finalUrl,
          storagePath: finalKey,
          origin: 'canvas',
          projectId: request.projectId,
          referencedByCount: 0,
          metadata: {
            format: 'png',
            type: 'next-scene',
            elementId: request.elementId
          } as any,
        });

        allImages.push({
          mediaId: media.id,
          url: finalUrl,
          storagePath: finalKey,
        });
      }

      imageUrl = allImages[0].url;
      imageStoragePath = allImages[0].storagePath;
    } else {
      throw new ApiError("No images returned from Next Scene generation", 500);
    }

    return {
      mediaId: allImages[0].mediaId,
      url: imageUrl,
      storagePath: imageStoragePath || '',
      generationId: result.historyId,
      images: allImages,
    };

  } catch (error: any) {
    console.error('[generateNextSceneForCanvas] Error:', error);
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      error.message || 'Next Scene generation failed',
      error.statusCode || error.status || 500
    );
  }
}

export const generateService = {
  generateForCanvas,
  generateVideoForCanvas,
  upscaleForCanvas,
  removeBgForCanvas,
  vectorizeForCanvas,
  eraseForCanvas,
  replaceForCanvas,
  generateNextSceneForCanvas: _generateNextSceneForCanvas,
};