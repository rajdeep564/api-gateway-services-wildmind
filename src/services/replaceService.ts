import { ApiError } from '../utils/errorHandler';
import { env } from '../config/env';
import { fal } from '@fal-ai/client';
import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { authRepository } from '../repository/auth/authRepository';
import { uploadFromUrlToZata, uploadDataUriToZata } from '../utils/storage/zataUpload';
import { syncToMirror, updateMirror } from '../utils/mirrorHelper';
import { markGenerationCompleted } from './generationHistoryService';
import sharp from 'sharp';
import axios from 'axios';

interface ReplaceRequest {
  input_image: string; // data URI or URL
  masked_image: string; // data URI or URL (mask)
  prompt: string;
  model: 'google_nano_banana' | 'seedream_4';
}

interface ReplaceResponse {
  edited_image: string; // URL to edited image
  historyId: string;
  status: 'success';
}

/**
 * Ensures mask dimensions match input image dimensions
 * If not, resamples the mask to match
 */
async function ensureMaskDimensionsMatch(
  inputImageUrl: string,
  maskDataUri: string
): Promise<string> {
  try {
    // Load input image to get dimensions
    const inputResponse = await axios.get(inputImageUrl, {
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });
    if (inputResponse.status < 200 || inputResponse.status >= 300) {
      throw new Error(`Failed to load input image: ${inputResponse.status}`);
    }
    const inputBuffer = Buffer.from(inputResponse.data);
    const inputImage = sharp(inputBuffer);
    const inputMetadata = await inputImage.metadata();
    const inputWidth = inputMetadata.width || 1024;
    const inputHeight = inputMetadata.height || 1024;

    // Load mask
    const maskBase64 = maskDataUri.split(',')[1] || maskDataUri;
    const maskBuffer = Buffer.from(maskBase64, 'base64');
    const maskImage = sharp(maskBuffer);
    const maskMetadata = await maskImage.metadata();
    const maskWidth = maskMetadata.width || inputWidth;
    const maskHeight = maskMetadata.height || inputHeight;

    // If dimensions match, return original mask
    if (maskWidth === inputWidth && maskHeight === inputHeight) {
      return maskDataUri;
    }

    // Resample mask to match input dimensions
    const resampledMaskBuffer = await maskImage
      .resize(inputWidth, inputHeight, {
        fit: 'fill',
        kernel: 'nearest', // Use nearest neighbor to preserve mask crispness
      })
      .png()
      .toBuffer();

    const resampledBase64 = resampledMaskBuffer.toString('base64');
    const mimeType = maskDataUri.includes('data:') 
      ? maskDataUri.split(';')[0].split(':')[1] 
      : 'image/png';
    
    return `data:${mimeType};base64,${resampledBase64}`;
  } catch (error) {
    console.warn('[replaceService] Failed to resample mask, using original:', error);
    return maskDataUri;
  }
}

/**
 * Extracts a proper mask from the masked_image
 * The frontend sends a mask as a data URI, but we need to ensure it's in the right format
 */
async function prepareMask(maskDataUri: string): Promise<string> {
  try {
    // If it's already a data URI with base64, extract and process
    const base64Data = maskDataUri.includes(',') 
      ? maskDataUri.split(',')[1] 
      : maskDataUri;
    
    const maskBuffer = Buffer.from(base64Data, 'base64');
    const maskImage = sharp(maskBuffer);
    
    // Ensure mask is grayscale (single channel) for proper inpainting
    const processedBuffer = await maskImage
      .greyscale()
      .png()
      .toBuffer();
    
    const processedBase64 = processedBuffer.toString('base64');
    return `data:image/png;base64,${processedBase64}`;
  } catch (error) {
    console.warn('[replaceService] Failed to process mask, using original:', error);
    return maskDataUri;
  }
}

/**
 * Google Nano Banana Edit - Queue-based API
 * Uses fal-ai/nano-banana/edit with queue submit/result pattern
 * Note: This model uses image_urls array, so we include both the original image and mask
 */
async function processGoogleNanoBanana(
  uid: string,
  inputImageUrl: string,
  maskUrl: string,
  prompt: string,
  historyId: string
): Promise<{ publicUrl: string; key: string }> {
  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError('FAL AI API key not configured', 500);

  fal.config({ credentials: falKey });

  const model = 'fal-ai/nano-banana/edit';
  
  // Create an extremely strict prompt that emphasizes ONLY modifying the masked area
  // This prevents the model from changing other parts of the image
  // The prompt explicitly references the mask image to ensure only masked regions are changed
  const strictPrompt = `STRICT INSTRUCTION: You must ONLY modify the white/masked regions shown in the second image (the mask). The user's request is: "${prompt.trim()}". Apply this change ONLY to the white areas in the mask image. CRITICAL RULES: 1) Do NOT modify any black/unmasked areas. 2) Keep all unmasked regions identical to the original image. 3) Only change pixels that correspond to white areas in the mask. 4) Preserve everything outside the mask exactly as it appears in the original image. 5) Do not apply the requested change to any area that is not white in the mask image.`;
  
  // Add comprehensive negative prompt to prevent changes outside mask
  const negativePrompt = 'changing unmasked areas, modifying areas outside mask, altering non-masked regions, editing parts not in mask, changing anything outside the white mask area, modifying background, changing other objects, editing non-selected areas, altering black mask regions, modifying areas that are not white in mask, changing anything not explicitly masked, editing unmasked portions, modifying non-white mask areas';
  
  // Nano Banana edit uses image_urls array for reference images
  // For mask-based editing, we use the original image as the primary input
  // The mask is included as a second image to provide context
  // Note: The model will use the prompt to edit based on the primary image
  const input: any = {
    prompt: strictPrompt,
    image_urls: [inputImageUrl], // Primary image for editing
    num_images: 1,
    aspect_ratio: 'auto',
    output_format: 'png',
    negative_prompt: negativePrompt,
  };
  
  // If mask is provided and different from input, include it as additional context
  // Some models can use additional images as reference
  if (maskUrl && maskUrl !== inputImageUrl) {
    input.image_urls.push(maskUrl);
  }

  console.log('[replaceService] Submitting Google Nano Banana edit:', { 
    model, 
    input: { 
      ...input, 
      image_urls: input.image_urls.map((url: string) => url.slice(0, 100) + '...')
    } 
  });

  try {
    // Submit to queue
    const { request_id } = await fal.queue.submit(model, { input } as any);
    
    if (!request_id) {
      throw new ApiError('No request ID returned from Google Nano Banana API', 502);
    }

    // Update history with provider task ID
    await generationHistoryRepository.update(uid, historyId, { 
      provider: 'fal', 
      providerTaskId: request_id,
      status: 'processing'
    } as any);

    // Poll for result (with timeout)
    const maxAttempts = 60; // 5 minutes max (5 second intervals)
    const pollInterval = 5000; // 5 seconds
    let attempts = 0;
    let result: any = null;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      try {
        const status = await fal.queue.status(model, { requestId: request_id, logs: true } as any);
        
        // FAL queue status uses uppercase enum values: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED'
        const statusValue = (status as any)?.status || (status as any)?.status_code || '';
        
        if (statusValue === 'COMPLETED' || statusValue === 'completed') {
          result = await fal.queue.result(model, { requestId: request_id } as any);
          break;
        } else if (statusValue === 'FAILED' || statusValue === 'failed') {
          const errorMsg = (status as any)?.error || (status as any)?.message || 'Unknown error';
          throw new ApiError(`Google Nano Banana edit failed: ${errorMsg}`, 500);
        }
        // Continue polling if status is 'IN_PROGRESS', 'IN_QUEUE', or 'in_progress', 'in_queue'
      } catch (pollError: any) {
        // If status check fails, continue polling unless it's a clear failure
        if (pollError?.message?.includes('failed') || pollError?.status === 'FAILED') {
          throw pollError;
        }
        console.warn('[replaceService] Poll error, retrying:', pollError);
      }
      
      attempts++;
    }

    if (!result || !result.data) {
      throw new ApiError('Google Nano Banana edit timed out or failed', 504);
    }

    const imagesArray: any[] = Array.isArray(result.data?.images) 
      ? result.data.images 
      : [];
    
    if (!imagesArray.length) {
      throw new ApiError('No images returned from Google Nano Banana API', 502);
    }

    const editedImageUrl = imagesArray[0]?.url;
    if (!editedImageUrl) {
      throw new ApiError('No image URL in Google Nano Banana response', 502);
    }

    // Upload to Zata storage
    const creator = await authRepository.getUserById(uid);
    const username = creator?.username || uid;
    const { publicUrl, key } = await uploadFromUrlToZata({
      sourceUrl: editedImageUrl,
      keyPrefix: `users/${username}/image/${historyId}`,
      fileName: 'nano-banana-edit',
    });

    return { publicUrl, key };
  } catch (error: any) {
    const details = error?.response?.data || error?.message || error;
    console.error('[replaceService] Google Nano Banana error:', JSON.stringify(details, null, 2));
    
    // Update history with error
    try {
      await generationHistoryRepository.update(uid, historyId, {
        status: 'failed',
        error: typeof details === 'string' ? details : JSON.stringify(details),
      } as any);
    } catch {}
    
    throw new ApiError(`Google Nano Banana API error: ${JSON.stringify(details)}`, 500);
  }
}

/**
 * Seedream 4 inpainting
 * Uses Bria GenFill as the underlying model for reliable inpainting with masks
 */
async function processSeedream4(
  uid: string,
  inputImageUrl: string,
  maskUrl: string,
  prompt: string,
  historyId: string
): Promise<string> {
  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError('FAL AI API key not configured', 500);

  fal.config({ credentials: falKey });

  // Use Bria GenFill for inpainting as Seedream 4 text-to-image endpoint doesn't support masks
  const model = 'fal-ai/bria/genfill';
  
  // Create an extremely strict prompt that emphasizes ONLY modifying the masked area
  const strictPrompt = `STRICT INSTRUCTION: You must ONLY modify the masked regions (white areas in the mask). The user's request is: "${prompt.trim()}". Apply this change ONLY to the masked/white areas. CRITICAL RULES: 1) Do NOT modify any unmasked/black areas. 2) Keep all unmasked regions identical to the original image. 3) Only change pixels that are white in the mask. 4) Preserve everything outside the mask exactly as it appears in the original image. 5) Do not apply the requested change to any area that is not masked.`;
  
  const input: any = {
    prompt: strictPrompt,
    image_url: inputImageUrl,
    mask_url: maskUrl,
    num_images: 1,
    negative_prompt: 'changing unmasked areas, modifying areas outside mask, altering non-masked regions, editing parts not in mask, changing anything outside the mask area, modifying background, changing other objects, editing non-selected areas, altering black mask regions, modifying areas that are not white in mask, changing anything not explicitly masked, editing unmasked portions, modifying non-white mask areas',
  };

  console.log('[replaceService] Calling Seedream 4 (via Bria GenFill):', { 
    model, 
    input: { 
      ...input, 
      image_url: inputImageUrl.slice(0, 100) + '...', 
      mask_url: maskUrl.slice(0, 100) + '...' 
    } 
  });

  try {
    const result = await fal.subscribe(model as any, ({ input, logs: true } as unknown) as any);
    
    const imagesArray: any[] = Array.isArray((result as any)?.data?.images) 
      ? (result as any).data.images 
      : [];
    
    if (!imagesArray.length) {
      throw new ApiError('No images returned from Seedream 4 API', 502);
    }

    const editedImageUrl = imagesArray[0]?.url;
    if (!editedImageUrl) {
      throw new ApiError('No image URL in Seedream 4 response', 502);
    }

    // Upload to Zata storage
    const creator = await authRepository.getUserById(uid);
    const username = creator?.username || uid;
    const { publicUrl } = await uploadFromUrlToZata({
      sourceUrl: editedImageUrl,
      keyPrefix: `users/${username}/image/${historyId}`,
      fileName: 'seedream-edit',
    });

    return publicUrl;
  } catch (error: any) {
    const details = error?.response?.data || error?.message || error;
    console.error('[replaceService] Seedream 4 error:', JSON.stringify(details, null, 2));
    throw new ApiError(`Seedream 4 API error: ${JSON.stringify(details)}`, 500);
  }
}

/**
 * Main replace service function
 */
export async function replaceImage(
  uid: string,
  request: ReplaceRequest
): Promise<ReplaceResponse> {
  const { input_image, masked_image, prompt, model } = request;

  // Validate inputs
  if (!input_image || !masked_image || !prompt) {
    throw new ApiError('input_image, masked_image, and prompt are required', 400);
  }

  // Get creator info
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };

  // Create history record
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: prompt.trim(), // Store only the user's prompt, without model prefix
    model: model === 'google_nano_banana' ? 'google-nano-banana' : 'google-nano-banana', // Default to Google Nano Banana
    generationType: 'image-edit',
    visibility: 'private',
    isPublic: false,
    createdBy,
  });

  try {
    // Resolve input image URL and save to inputImages
    let inputImageUrl: string;
    let inputImageStored: any = null;
    if (input_image.startsWith('data:')) {
      const username = creator?.username || uid;
      const stored = await uploadDataUriToZata({
        dataUri: input_image,
        keyPrefix: `users/${username}/input/${historyId}`,
        fileName: 'replace-input',
      });
      inputImageUrl = stored.publicUrl;
      inputImageStored = { id: 'in-1', url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: input_image };
    } else {
      inputImageUrl = input_image;
      // For URL inputs, try to upload to Zata for consistency
      try {
        const username = creator?.username || uid;
        const stored = await uploadFromUrlToZata({
          sourceUrl: input_image,
          keyPrefix: `users/${username}/input/${historyId}`,
          fileName: 'replace-input',
        });
        inputImageStored = { id: 'in-1', url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: input_image };
        inputImageUrl = stored.publicUrl;
      } catch {
        // If upload fails, use original URL
        inputImageStored = { id: 'in-1', url: input_image, originalUrl: input_image };
      }
    }

    // Resolve and prepare mask
    let maskUrl: string;
    if (masked_image.startsWith('data:')) {
      // Ensure mask dimensions match input image
      const resampledMask = await ensureMaskDimensionsMatch(inputImageUrl, masked_image);
      const processedMask = await prepareMask(resampledMask);
      
      const username = creator?.username || uid;
      const stored = await uploadDataUriToZata({
        dataUri: processedMask,
        keyPrefix: `users/${username}/input/${historyId}`,
        fileName: 'replace-mask',
      });
      maskUrl = stored.publicUrl;
    } else {
      maskUrl = masked_image;
    }

    // Process based on model - default to Google Nano Banana
    let editedImageResult: { publicUrl: string; key: string };
    // Always use Google Nano Banana for replace feature
    editedImageResult = await processGoogleNanoBanana(uid, inputImageUrl, maskUrl, prompt, historyId);

    // Update history with result and inputImages
    // Set updatedAt to current time to ensure proper sorting by completion time
    const images = [{ 
      url: editedImageResult.publicUrl, 
      storagePath: editedImageResult.key, 
      originalUrl: editedImageResult.publicUrl 
    }];
    const updateData: any = {
      status: 'completed',
      images: images,
      updatedAt: new Date().toISOString(), // Set completion time for proper sorting
    };
    // Save input image to inputImages so it appears in preview modal
    if (inputImageStored) {
      updateData.inputImages = [inputImageStored];
    }
    await generationHistoryRepository.update(uid, historyId, updateData);

    // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
    markGenerationCompleted(uid, historyId, {
      status: "completed",
      images: images as any,
    }).catch(err => console.error('[replaceService] Image optimization failed:', err));

    // Sync to mirror
    await syncToMirror(uid, historyId);

    return {
      edited_image: editedImageResult.publicUrl,
      historyId,
      status: 'success',
    };
  } catch (error: any) {
    const message = error?.message || 'Failed to replace image';
    try {
      await generationHistoryRepository.update(uid, historyId, {
        status: 'failed',
        error: message,
      } as any);
      await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
    } catch (mirrorErr) {
      console.error('[replaceService] Failed to mirror error state:', mirrorErr);
    }
    throw new ApiError(message, 500);
  }
}

