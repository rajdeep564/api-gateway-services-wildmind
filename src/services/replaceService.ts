import { ApiError } from '../utils/errorHandler';
import { buildFalApiError } from '../utils/falErrorMapper';
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
export async function ensureMaskDimensionsMatch(
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

export async function processGoogleGeminiFlash(
  uid: string,
  inputImageUrl: string, // Original input image (without compositing)
  maskUrl: string | null | undefined, // Optional mask image URL (black background, white mask)
  prompt: string,
  historyId: string
): Promise<{ publicUrl: string; key: string }> {
  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError('FAL AI API key not configured', 500);

  // Use Google Gemini 2.5 Flash for inpainting/editing
  // This matches the mapping in falService.ts and modelMapping.ts
  const model = 'fal-ai/gemini-25-flash-image/edit';

  // Use the prompt as-is (it already contains the base prompt from eraseForCanvas)
  const strictPrompt = prompt;

  // Add comprehensive negative prompt to prevent changes outside mask and preserve quality
  const negativePrompt = 'changing unmasked areas, modifying areas outside mask, altering non-masked regions, editing parts not in mask, changing anything outside the white mask area, modifying background, changing other objects, editing non-selected areas, altering black mask regions, modifying areas that are not white in mask, changing anything not explicitly masked, editing unmasked portions, modifying non-white mask areas, desaturated colors, dull colors, washed out colors, low contrast, faded appearance, color loss, reduced vibrancy, muted tones, color temperature shift, white balance change, saturation loss, brightness change, contrast reduction, overall image quality degradation, color cast, tint shift, hue shift, color desaturation, color dullness, color washout, color fade, color temperature alteration, white balance alteration, saturation reduction, brightness alteration, contrast alteration';

  const input: any = {
    prompt: strictPrompt,
    image_urls: [inputImageUrl], // FAL Edit endpoint requires image_urls as array
    num_images: 1,
    aspect_ratio: 'auto',
    output_format: 'png', // PNG preserves quality better than JPEG (lossless)
    negative_prompt: negativePrompt,
  };

  // If we have a processed mask, send it as mask_url
  if (maskUrl) {
    input.mask_url = maskUrl;
  }

  console.log('[replaceService] ✅ Using composited image (mask already included in image)');

  console.log('[replaceService] ========== GOOGLE GEMINI FLASH REQUEST ==========');
  console.log('[replaceService] Model:', model);
  console.log('[replaceService] Input Image URL:', inputImageUrl);
  console.log('[replaceService] Mask URL (if any):', maskUrl);
  console.log('[replaceService] Prompt:', prompt);
  console.log('[replaceService] Input payload:', {
    prompt: input.prompt,
    negative_prompt: input.negative_prompt,
    num_images: input.num_images,
    aspect_ratio: input.aspect_ratio,
    output_format: input.output_format,
    image_urls: input.image_urls ? (Array.isArray(input.image_urls) ? `[${input.image_urls.length} image(s)]` : 'N/A') : 'N/A',
    image_urls_preview: input.image_urls && Array.isArray(input.image_urls) && input.image_urls[0] ? (input.image_urls[0].slice(0, 100) + '...') : 'N/A',
    has_mask_url: !!input.mask_url
  });
  console.log('[replaceService] ===============================================');

  try {
    console.log('[replaceService] Submitting to FAL via subscribe:', { model });

    // Use fal.subscribe which handles queueing and polling automatically
    const result: any = await fal.subscribe(model as any, {
      input,
      logs: true, // Enable logs to see progress
      onQueueUpdate: (update: any) => {
        if (update.status === 'IN_PROGRESS' || update.status === 'IN_QUEUE') {
          console.log(`[replaceService] FAL Status: ${update.status} (elapsed: ${update.request_id})`);
        }
      },
    } as any);

    console.log('[replaceService] ✅ FAL subscribe completed:', {
      requestId: result.requestId,
      hasData: !!result.data,
      hasImages: !!result.data?.images,
      hasImage: !!result.data?.image
    });

    if (!result || !result.data) {
      throw new ApiError('Google Gemini Flash edit returned no data', 504);
    }

    // Handle standard FAL response format (data.images or data.image)
    let imagesArray: any[] = [];

    if (result.data.images && Array.isArray(result.data.images)) {
      imagesArray = result.data.images;
    } else if (result.data.image && result.data.image.url) {
      imagesArray = [{ url: result.data.image.url }];
    } else if (result.images && Array.isArray(result.images)) {
      // Root level images fallback
      imagesArray = result.images;
    }

    if (!imagesArray.length) {
      throw new ApiError('No images returned from Google Gemini Flash API', 502);
    }

    const editedImageUrl = imagesArray[0]?.url;
    if (!editedImageUrl) {
      throw new ApiError('No image URL in Google Gemini Flash response', 502);
    }

    // Upload to Zata storage
    const creator = await authRepository.getUserById(uid);
    const username = creator?.username || uid;
    const { publicUrl, key } = await uploadFromUrlToZata({
      sourceUrl: editedImageUrl,
      keyPrefix: `users/${username}/image/${historyId}`,
      fileName: 'gemini-flash-edit',
    });

    return { publicUrl, key };
  } catch (error: any) {
    console.error('[replaceService] ❌ Google Gemini Flash error caught:', {
      errorMessage: error?.message,
      errorStatus: error?.status || error?.statusCode,
      errorData: error?.data ? JSON.stringify(error.data).slice(0, 500) : 'N/A',
      errorStack: error?.stack ? error.stack.slice(0, 500) : 'N/A',
      fullError: JSON.stringify(error).slice(0, 1000)
    });

    const falError = buildFalApiError(error, {
      fallbackMessage: 'Google Gemini Flash API error',
      context: 'replaceService.googleGeminiFlash',
      toastTitle: 'Image replace failed',
    });
    console.error('[replaceService] Google Gemini Flash formatted error:', JSON.stringify(falError.data, null, 2));

    try {
      await generationHistoryRepository.update(uid, historyId, {
        status: 'failed',
        error: falError.message,
        falError: falError.data,
      } as any);
    } catch (updateError) {
      console.error('[replaceService] Failed to update history with error:', updateError);
    }

    throw falError;
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
    const falError = buildFalApiError(error, {
      fallbackMessage: 'Seedream 4 API error',
      context: 'replaceService.seedream4',
      toastTitle: 'Image replace failed',
    });
    console.error('[replaceService] Seedream 4 error:', JSON.stringify(falError.data, null, 2));
    throw falError;
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
      // Ensure mask dimensions match input image and are in the proper black/white format
      const resampledMask = await ensureMaskDimensionsMatch(inputImageUrl, masked_image);
      const processedMask = await prepareMask(resampledMask);

      const username = creator?.username || uid;

      // Store processed mask for history / debugging and for Nano Banana mask_url
      const storedMask = await uploadDataUriToZata({
        dataUri: processedMask,
        keyPrefix: `users/${username}/input/${historyId}`,
        fileName: 'replace-mask',
      });
      maskUrl = storedMask.publicUrl;
    } else {
      maskUrl = masked_image;
    }

    // Process based on model - default to Google Nano Banana
    let editedImageResult: { publicUrl: string; key: string };
    // Always use Google Gemini Flash for replace feature
    editedImageResult = await processGoogleGeminiFlash(uid, inputImageUrl, maskUrl, prompt, historyId);

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

