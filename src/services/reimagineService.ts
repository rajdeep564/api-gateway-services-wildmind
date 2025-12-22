import { ApiError } from '../utils/errorHandler';
import { buildFalApiError } from '../utils/falErrorMapper';
import { env } from '../config/env';
import { fal } from '@fal-ai/client';
import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { authRepository } from '../repository/auth/authRepository';
import { uploadBufferToZata, uploadFromUrlToZata } from '../utils/storage/zataUpload';
import { syncToMirror, updateMirror } from '../utils/mirrorHelper';
import { markGenerationCompleted } from './generationHistoryService';
import sharp from 'sharp';
import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Replicate = require('replicate');

interface ReimagineRequest {
  image_url: string;
  selection_bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  prompt: string;
  model?: 'nano-banana' | 'seedream-4k';  // Optional model selection
  isPublic?: boolean;
  referenceImage?: string; // Optional reference image (URL or Base64)
}

interface ReimagineResponse {
  reimagined_image: string;
  historyId: string;
  status: 'success';
  model_used: string;  // Track which model was actually used
}

/**
 * Helper: Process with FAL AI Nano Banana model
 */
async function processWithNanoBanana(
  cropUrl: string,
  prompt: string,
  uid: string,
  historyId: string,
  referenceImage?: string
): Promise<string> {
  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError('FAL AI API key not configured', 500);

  fal.config({ credentials: falKey });

  const model = 'fal-ai/nano-banana/edit';
  
  // Construct prompt based on whether reference image is present
  let enhancedPrompt = prompt.trim();
  
  if (referenceImage) {
    // Append instruction to use the reference image (Index 1)
    enhancedPrompt += `. Use the second image (index 1) as the primary source for the object's appearance. Transfer the visual data (shape, texture, colors, details) from the reference image (index 1) into the first image (index 0). Ensure the inserted object matches the lighting, shadows, and perspective of the first image's scene.`;
  }
  
  // Standard enhancement for context preservation
  enhancedPrompt += `. IMPORTANT: Match the existing lighting, shadows, and perspective exactly. Preserve surrounding context. Blend seamlessly without changing colors or atmosphere of the original scene.`;
  
  console.log('[reimagineService] Calling Nano Banana:', enhancedPrompt);
  
  // Prepare image URLs array
  // Prepare image URLs array
  const imageUrls = [cropUrl];
  if (referenceImage) {
    let finalRefUrl = referenceImage;
    
    // If reference image is Base64, upload to Zata first to avoid payload size issues
    if (referenceImage.startsWith('data:')) {
      try {
        console.log('[reimagineService] Uploading reference image to Zata...');
        const matches = referenceImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const contentType = matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          const filename = `users/${uid}/temp/ref-${Date.now()}.jpg`;
          const { publicUrl } = await uploadBufferToZata(filename, buffer, contentType);
          finalRefUrl = publicUrl;
          console.log('[reimagineService] Reference image uploaded:', finalRefUrl);
        }
      } catch (err) {
        console.error('[reimagineService] Failed to upload reference image, falling back to raw data:', err);
      }
    }

    imageUrls.push(finalRefUrl);
    console.log('[reimagineService] Including Reference Image at Index 1');
  }
  
  const input: any = {
    prompt: enhancedPrompt,
    image_urls: imageUrls,
    num_images: 1,
    aspect_ratio: 'auto',
    output_format: 'jpeg',
  };

  try {
    const result = await fal.subscribe(model, {
      input,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          update.logs?.map((log) => log.message).forEach((msg) => 
            console.log('[reimagineService] Nano Banana Log:', msg)
          );
        }
      },
    });

    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: (result as any).requestId || 'subscribe-based',
      status: 'processing',
    } as any);

    const imagesArray: any[] = Array.isArray(result.data?.images) ? result.data.images : [];
    if (!imagesArray.length) {
      throw new ApiError('No images returned from Nano Banana API', 502);
    }

    const patchUrl = imagesArray[0]?.url;
    if (!patchUrl) {
      throw new ApiError('No image URL in Nano Banana response', 502);
    }

    return patchUrl;
  } catch (falError: any) {
    const falErrorDetails = falError?.body?.detail || falError?.message || 'Unknown FAL AI error';
    console.error('[reimagineService] Nano Banana Error:', JSON.stringify(falErrorDetails, null, 2));
    
    const errorMessage = typeof falErrorDetails === 'string' 
      ? falErrorDetails 
      : JSON.stringify(falErrorDetails);
    
    throw new ApiError(`Nano Banana generation failed: ${errorMessage}`, 500);
  }
}

/**
 * Helper: Process with Replicate Seedream 4K model
 */
async function processWithSeedream4K(
  cropBuffer: Buffer,  // Changed from cropUrl to cropBuffer
  prompt: string,
  cropWidth: number,
  cropHeight: number,
  uid: string,
  historyId: string
): Promise<string> {
  // env.replicateApiKey already handles REPLICATE_API_TOKEN as fallback in env.ts
  const replicateKey = env.replicateApiKey as string;
  if (!replicateKey) {
    throw new ApiError('Replicate API key not configured', 500);
  }

  const replicate = new Replicate({ auth: replicateKey });
  const model = 'bytedance/seedream-4';
  
  // Calculate appropriate size based on crop dimensions
  const maxDim = Math.max(cropWidth, cropHeight);
  let size: '1K' | '2K' | '4K';
  if (maxDim <= 1024) {
    size = '1K';
  } else if (maxDim <= 2048) {
    size = '2K';
  } else {
    size = '4K';
  }
  
  // Enhanced prompt for Seedream to preserve context
  const enhancedPrompt = `${prompt.trim()}. CRITICAL: Maintain exact lighting, shadows, colors, and perspective of the original image. Do not alter the surrounding environment, atmosphere, or mood. Seamless integration required.`;
  
  // Convert crop buffer to data URI since Replicate can't access Zata URLs
  const cropDataUri = `data:image/png;base64,${cropBuffer.toString('base64')}`;
  
  console.log('[reimagineService] Calling Seedream 4K:', { size, prompt: enhancedPrompt, imageFormat: 'data URI' });
  
  const input: any = {
    prompt: enhancedPrompt,
    image_input: [cropDataUri],  // Use data URI instead of URL
    size,
    aspect_ratio: 'match_input_image',
    max_images: 1,
    enhance_prompt: true,
    sequential_image_generation: 'disabled',
  };

  try {
    const output: any = await replicate.run(model as any, { input });
    
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'replicate',
      providerTaskId: 'seedream-' + Date.now(),
      status: 'processing',
    } as any);

    // Seedream returns array of URLs
    let patchUrl: string;
    if (Array.isArray(output)) {
      if (typeof output[0] === 'string') {
        patchUrl = output[0];
      } else if (output[0]?.url) {
        patchUrl = typeof output[0].url === 'function' ? await output[0].url() : output[0].url;
      } else {
        throw new ApiError('Unexpected Seedream output format', 502);
      }
    } else if (typeof output === 'string') {
      patchUrl = output;
    } else {
      throw new ApiError('No output returned from Seedream API', 502);
    }

    if (!patchUrl) {
      throw new ApiError('No image URL in Seedream response', 502);
    }

    return patchUrl;
  } catch (repError: any) {
    console.error('[reimagineService] Seedream 4K Error:', repError?.message || repError);
    throw new ApiError(`Seedream 4K generation failed: ${repError?.message || 'Unknown error'}`, 500);
  }
}

export async function reimagineImage(
  uid: string,
  request: ReimagineRequest
): Promise<ReimagineResponse> {
  const { image_url, selection_bounds, prompt, isPublic } = request;

  // Validate inputs
  if (!image_url || !selection_bounds || !prompt) {
    throw new ApiError('image_url, selection_bounds, and prompt are required', 400);
  }

  // Get creator info
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };

  // Create history record
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: `Seamlessly integrate: ${prompt.trim()}`,
    model: 'google-nano-banana',
    generationType: 'reimagine',
    visibility: isPublic ? 'public' : 'private',
    isPublic: !!isPublic,
    createdBy,
  });

  try {
    // 1. Download original image
    console.log('[reimagineService] Downloading original image:', image_url);
    const imageResponse = await axios.get(image_url, {
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });
    if (imageResponse.status < 200 || imageResponse.status >= 300) {
      throw new ApiError(`Failed to download image: ${imageResponse.status}`, 502);
    }
    const imageBuffer = Buffer.from(imageResponse.data);

    // 2. Crop the image using selection_bounds
    const { x, y, width, height } = selection_bounds;
    
    // Get original image dimensions for validation
    const originalMetadata = await sharp(imageBuffer).metadata();
    console.log('[reimagineService] Original image dimensions:', { 
      width: originalMetadata.width, 
      height: originalMetadata.height 
    });
    console.log('[reimagineService] Selection bounds received:', { x, y, width, height });
    
    // Ensure crop is within image bounds
    const cropLeft = Math.max(0, Math.floor(x));
    const cropTop = Math.max(0, Math.floor(y));
    const cropWidth = Math.max(1, Math.min(Math.floor(width), (originalMetadata.width || 0) - cropLeft));
    const cropHeight = Math.max(1, Math.min(Math.floor(height), (originalMetadata.height || 0) - cropTop));
    
    console.log('[reimagineService] Actual crop params:', { 
      left: cropLeft, 
      top: cropTop, 
      width: cropWidth, 
      height: cropHeight 
    });
    
    const cropBuffer = await sharp(imageBuffer)
      .extract({ 
        left: cropLeft, 
        top: cropTop, 
        width: cropWidth, 
        height: cropHeight 
      })
      .toBuffer();

    // 3. Upload crop to Zata to get a proper URL
    const username = creator?.username || uid;
    const { publicUrl: cropUrl } = await uploadBufferToZata(
      `users/${username}/temp/${historyId}/crop.png`,
      cropBuffer,
      'image/png'
    );

    console.log('[reimagineService] Uploaded crop to Zata:', cropUrl);

    // 4. Auto-select model based on crop size (unless explicitly specified)
    const cropArea = cropWidth * cropHeight;
    const MAX_NANO_BANANA_AREA = 1024 * 1024; // 1024 x 1024
    
    let selectedModel: 'nano-banana' | 'seedream-4k';
    if (request.model) {
      // User explicitly chose a model
      selectedModel = request.model;
      console.log('═══════════════════════════════════════════════════════');
      console.log('🎯 [REIMAGINE] USER MANUALLY SELECTED MODEL:', selectedModel);
      console.log('═══════════════════════════════════════════════════════');
    } else {
      // Auto-select based on crop size
      selectedModel = cropArea > MAX_NANO_BANANA_AREA ? 'seedream-4k' : 'nano-banana';
      console.log('═══════════════════════════════════════════════════════');
      console.log('🤖 [REIMAGINE] AUTO-SELECTED MODEL:', selectedModel);
      console.log('   Crop Area:', cropArea, 'pixels');
      console.log('   Threshold:', MAX_NANO_BANANA_AREA, 'pixels');
      console.log('═══════════════════════════════════════════════════════');
    }

    // Update history with selected model
    await generationHistoryRepository.update(uid, historyId, {
      model: selectedModel === 'nano-banana' ? 'google-nano-banana' : 'bytedance/seedream-4',
    } as any);

    let patchUrl: string;

    if (selectedModel === 'nano-banana') {
      console.log('⚡ [REIMAGINE] Using NANO-BANANA (FAL AI)');
      patchUrl = await processWithNanoBanana(cropUrl, prompt, uid, historyId, request.referenceImage);
    } else {
      console.log('✨ [REIMAGINE] Using SEEDREAM 4K (Replicate)');
      // Pass crop buffer directly to Seedream (converts to data URI internally)
      patchUrl = await processWithSeedream4K(cropBuffer, prompt, cropWidth, cropHeight, uid, historyId);
    }

    console.log('[reimagineService] Downloaded generated patch:', patchUrl);

    // 5. Download the generated patch
    const patchResponse = await axios.get(patchUrl, {
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });
    if (patchResponse.status < 200 || patchResponse.status >= 300) {
      throw new ApiError(`Failed to download patch: ${patchResponse.status}`, 502);
    }
    const patchBuffer = Buffer.from(patchResponse.data);

    // 6. Stitch the patch back with smooth gradient-based edge feathering
    console.log('[reimagineService] Stitching patch with gradient feathering');
    const originalImage = sharp(imageBuffer);
    
    const patchWidth = Math.max(1, Math.floor(width));
    const patchHeight = Math.max(1, Math.floor(height));
    
    // Resize patch with highest quality interpolation
    const resizedPatch = await sharp(patchBuffer)
      .resize(patchWidth, patchHeight, { 
        fit: 'fill',
        kernel: 'lanczos3',
        fastShrinkOnLoad: false
      })
      .toBuffer();

    // Create gradient-based feathering for smooth edge transitions
    // Increased feather size for more aggressive blending to hide seams
    const featherPercent = 0.12; // 12% feather for seamless integration
    const featherWidth = Math.max(15, Math.floor(patchWidth * featherPercent));
    const featherHeight = Math.max(15, Math.floor(patchHeight *  featherPercent));
    
    console.log('[reimagineService] Feather size:', { width: featherWidth, height: featherHeight });
    
    // Create a gradient mask using SVG for smooth alpha transitions
    const gradientMask = `
      <svg width="${patchWidth}" height="${patchHeight}">
        <defs>
          <radialGradient id="cornerGradient">
            <stop offset="70%" stop-color="white" stop-opacity="1"/>
            <stop offset="100%" stop-color="white" stop-opacity="0"/>
          </radialGradient>
          
          <linearGradient id="topGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="white" stop-opacity="0"/>
            <stop offset="${(featherHeight / patchHeight * 100)}%" stop-color="white" stop-opacity="1"/>
          </linearGradient>
          
          <linearGradient id="bottomGradient" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="white" stop-opacity="0"/>
            <stop offset="${(featherHeight / patchHeight * 100)}%" stop-color="white" stop-opacity="1"/>
          </linearGradient>
          
          <linearGradient id="leftGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="white" stop-opacity="0"/>
            <stop offset="${(featherWidth / patchWidth * 100)}%" stop-color="white" stop-opacity="1"/>
          </linearGradient>
          
          <linearGradient id="rightGradient" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="white" stop-opacity="0"/>
            <stop offset="${(featherWidth / patchWidth * 100)}%" stop-color="white" stop-opacity="1"/>
          </linearGradient>
        </defs>
        
        <rect width="${patchWidth}" height="${patchHeight}" fill="white"/>
        
        <rect width="${patchWidth}" height="${featherHeight}" fill="url(#topGradient)"/>
        <rect y="${patchHeight - featherHeight}" width="${patchWidth}" height="${featherHeight}" fill="url(#bottomGradient)"/>
        <rect width="${featherWidth}" height="${patchHeight}" fill="url(#leftGradient)"/>
        <rect x="${patchWidth - featherWidth}" width="${featherWidth}" height="${patchHeight}" fill="url(#rightGradient)"/>
        
        <circle cx="${featherWidth}" cy="${featherHeight}" r="${featherWidth}" fill="url(#cornerGradient)"/>
        <circle cx="${patchWidth - featherWidth}" cy="${featherHeight}" r="${featherWidth}" fill="url(#cornerGradient)"/>
        <circle cx="${featherWidth}" cy="${patchHeight - featherHeight}" r="${featherWidth}" fill="url(#cornerGradient)"/>
        <circle cx="${patchWidth - featherWidth}" cy="${patchHeight - featherHeight}" r="${featherWidth}" fill="url(#cornerGradient)"/>
      </svg>
    `;

    // Apply gradient mask to patch for smooth feathered edges
    const featheredPatch = await sharp(resizedPatch)
      .composite([{
        input: Buffer.from(gradientMask),
        blend: 'dest-in'
      }])
      .png()
      .toBuffer();

    // Composite feathered patch onto original with precise positioning
    const finalBuffer = await originalImage
      .composite([
        {
          input: featheredPatch,
          top: Math.floor(y),
          left: Math.floor(x),
          blend: 'over'
        },
      ])
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
      .toBuffer();

    // 7. Upload final result to Zata
    console.log('[reimagineService] Uploading final result to Zata');
    const { publicUrl, key } = await uploadBufferToZata(
      `users/${username}/image/${historyId}/reimagined-image.jpg`,
      finalBuffer,
      'image/jpeg'
    );

    // 8. Update history with result
    const images = [{
      id: 'img-1',
      url: publicUrl,
      storagePath: key,
      originalUrl: publicUrl,
    }];
    await generationHistoryRepository.update(uid, historyId, {
      status: 'completed' as any,
      images: images as any,
      updatedAt: new Date().toISOString(),
    });

    // Trigger background optimization
    markGenerationCompleted(uid, historyId, {
      status: 'completed',
      images: images as any,
    }).catch(err => console.error('[reimagineService] Optimization failed:', err));

    // Sync to mirror
    await syncToMirror(uid, historyId);

    console.log('[reimagineService] Reimagine completed successfully:', publicUrl);

    return {
      reimagined_image: publicUrl,
      historyId,
      status: 'success',
      model_used: selectedModel,
    };
  } catch (error: any) {
    const message = error?.message || 'Failed to reimagine image';
    console.error('[reimagineService] Error:', message, error);
    try {
      await generationHistoryRepository.update(uid, historyId, {
        status: 'failed',
        error: message,
      } as any);
      await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
    } catch (mirrorErr) {
      console.error('[reimagineService] Failed to mirror error state:', mirrorErr);
    }
    throw new ApiError(message, 500);
  }
}
