import { Request, Response } from 'express';
import { generateService } from '../../services/canvas/generateService';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ApiError } from '../../utils/errorHandler';
import { CanvasGenerationRequest } from '../../types/canvas';
import { createReferenceImage, ReferenceImageItem } from '../../utils/createReferenceImage';
import { uploadBufferToZata } from '../../utils/storage/zataUpload';
import { postSuccessDebit } from '../../utils/creditDebit';

export async function generateVideoForCanvas(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      console.error('[generateVideoForCanvas] Missing userId');
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { prompt, model, aspectRatio, duration, resolution, meta, firstFrameUrl, lastFrameUrl } = req.body;

    console.log('[generateVideoForCanvas] Request received:', {
      userId,
      model,
      hasPrompt: !!prompt,
      hasMeta: !!meta,
      projectId: meta?.projectId,
    });

    if (!prompt) {
      console.error('[generateVideoForCanvas] Missing prompt');
      return res.status(400).json(
        formatApiResponse('error', 'Prompt is required', null)
      );
    }

    if (!meta || meta.source !== 'canvas' || !meta.projectId) {
      console.error('[generateVideoForCanvas] Invalid meta:', meta);
      return res.status(400).json(
        formatApiResponse('error', 'Invalid request: meta.source must be "canvas" and meta.projectId is required', null)
      );
    }

    const result = await generateService.generateVideoForCanvas(userId, {
      prompt,
      model: model || 'runway/gen3a_turbo',
      aspectRatio: aspectRatio || '16:9',
      duration: duration || 5,
      resolution: resolution || '1280x720',
      projectId: meta.projectId,
      elementId: meta.elementId,
      firstFrameUrl,
      lastFrameUrl,
    });

    console.log('[generateVideoForCanvas] Video generation completed:', {
      hasUrl: !!result.url,
    });


    // Debit credits
    const ctx = (req as any).context || {};
    const debitResult = {
      ...result,
      historyId: result.generationId
    };
    await postSuccessDebit(userId, debitResult, ctx, 'canvas', 'generate-video');

    return res.json(formatApiResponse('success', 'Video generation completed', result));
  } catch (error: any) {
    console.error('[generateVideoForCanvas] Error:', error);
    console.error('[generateVideoForCanvas] Error stack:', error.stack);
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || 'Failed to generate video';

    if (!res.headersSent) {
      return res.status(statusCode).json(
        formatApiResponse('error', message, null)
      );
    }
  }
}

export async function generateForCanvas(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      console.error('[generateForCanvas] Missing userId');
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const request: CanvasGenerationRequest = req.body;

    console.log('[generateForCanvas] Request received:', {
      userId,
      model: request.model,
      hasPrompt: !!request.prompt,
      hasMeta: !!request.meta,
      projectId: request.meta?.projectId,
    });

    if (!request.prompt) {
      console.error('[generateForCanvas] Missing prompt');
      return res.status(400).json(
        formatApiResponse('error', 'Prompt is required', null)
      );
    }

    if (!request.meta || request.meta.source !== 'canvas' || !request.meta.projectId) {
      console.error('[generateForCanvas] Invalid meta:', request.meta);
      return res.status(400).json(
        formatApiResponse('error', 'Invalid request: meta.source must be "canvas" and meta.projectId is required', null)
      );
    }

    const result = await generateService.generateForCanvas(userId, request);

    // Debit credits
    const ctx = (req as any).context || {};
    // Ensure historyId is available for debit logic
    const debitResult = {
      ...result,
      historyId: (result as any).generationId
    };
    await postSuccessDebit(userId, debitResult, ctx, 'canvas', 'generate');

    console.log('[generateForCanvas] Generation completed:', {
      hasUrl: !!result.url,
      imageCount: result.images?.length || 1,
    });

    return res.json(formatApiResponse('success', 'Image generation completed', result));
  } catch (error: any) {
    console.error('[generateForCanvas] Error:', error);
    console.error('[generateForCanvas] Error stack:', error.stack);
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || 'Failed to generate image';

    if (!res.headersSent) {
      return res.status(statusCode).json(
        formatApiResponse('error', message, null)
      );
    }
  }
}

export async function upscaleForCanvas(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      console.error('[upscaleForCanvas] Missing userId');
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { image, model, meta } = req.body;

    console.log('[upscaleForCanvas] Request received:', {
      userId,
      model,
      hasImage: !!image,
      hasMeta: !!meta,
      projectId: meta?.projectId,
    });

    if (!image) {
      console.error('[upscaleForCanvas] Missing image');
      return res.status(400).json(
        formatApiResponse('error', 'Image is required', null)
      );
    }

    if (!meta || meta.source !== 'canvas' || !meta.projectId) {
      console.error('[upscaleForCanvas] Invalid meta:', meta);
      return res.status(400).json(
        formatApiResponse('error', 'Invalid request: meta.source must be "canvas" and meta.projectId is required', null)
      );
    }

    const result = await generateService.upscaleForCanvas(userId, {
      image,
      model: model || 'recraft/upscaler',
      projectId: meta.projectId,
      elementId: meta.elementId,
    });

    console.log('[upscaleForCanvas] Upscale completed:', {
      hasUrl: !!result.url,
    });


    // Debit credits
    const ctx = (req as any).context || {};
    const debitResult = {
      ...result,
      historyId: result.generationId
    };
    await postSuccessDebit(userId, debitResult, ctx, 'canvas', 'upscale');

    return res.json(formatApiResponse('success', 'Image upscale completed', result));
  } catch (error: any) {
    console.error('[upscaleForCanvas] Error:', error);
    console.error('[upscaleForCanvas] Error stack:', error.stack);
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || 'Failed to upscale image';

    if (!res.headersSent) {
      return res.status(statusCode).json(
        formatApiResponse('error', message, null)
      );
    }
  }
}

export async function removeBgForCanvas(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      console.error('[removeBgForCanvas] Missing userId');
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { image, model, meta } = req.body;

    console.log('[removeBgForCanvas] Request received:', {
      userId,
      model,
      hasImage: !!image,
      hasMeta: !!meta,
      projectId: meta?.projectId,
    });

    if (!image) {
      console.error('[removeBgForCanvas] Missing image');
      return res.status(400).json(
        formatApiResponse('error', 'Image is required', null)
      );
    }

    if (!meta || meta.source !== 'canvas' || !meta.projectId) {
      console.error('[removeBgForCanvas] Invalid meta:', meta);
      return res.status(400).json(
        formatApiResponse('error', 'Invalid request: meta.source must be "canvas" and meta.projectId is required', null)
      );
    }

    const result = await generateService.removeBgForCanvas(userId, {
      image,
      model: model || 'bria/remove-bg',
      projectId: meta.projectId,
      elementId: meta.elementId,
    });

    console.log('[removeBgForCanvas] Background removal completed:', {
      hasUrl: !!result.url,
    });


    // Debit credits
    const ctx = (req as any).context || {};
    const debitResult = {
      ...result,
      historyId: result.generationId
    };
    await postSuccessDebit(userId, debitResult, ctx, 'canvas', 'removebg');

    return res.json(formatApiResponse('success', 'Background removal completed', result));
  } catch (error: any) {
    console.error('[removeBgForCanvas] Error:', error);
    console.error('[removeBgForCanvas] Error stack:', error.stack);
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || 'Failed to remove background';

    if (!res.headersSent) {
      return res.status(statusCode).json(
        formatApiResponse('error', message, null)
      );
    }
  }
}

export async function vectorizeForCanvas(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      console.error('[vectorizeForCanvas] Missing userId');
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { image, mode, meta } = req.body;

    console.log('[vectorizeForCanvas] Request received:', {
      userId,
      mode,
      hasImage: !!image,
      hasMeta: !!meta,
      projectId: meta?.projectId,
    });

    if (!image) {
      console.error('[vectorizeForCanvas] Missing image');
      return res.status(400).json(
        formatApiResponse('error', 'Image is required', null)
      );
    }

    if (!meta || meta.source !== 'canvas' || !meta.projectId) {
      console.error('[vectorizeForCanvas] Invalid meta:', meta);
      return res.status(400).json(
        formatApiResponse('error', 'Invalid request: meta.source must be "canvas" and meta.projectId is required', null)
      );
    }

    const result = await generateService.vectorizeForCanvas(userId, {
      image,
      mode: mode || 'simple',
      projectId: meta.projectId,
      elementId: meta.elementId,
    });

    console.log('[vectorizeForCanvas] Vectorization completed:', {
      hasUrl: !!result.url,
    });


    // Debit credits
    const ctx = (req as any).context || {};
    const debitResult = {
      ...result,
      historyId: result.generationId
    };
    await postSuccessDebit(userId, debitResult, ctx, 'canvas', 'vectorize');

    return res.json(formatApiResponse('success', 'Image vectorization completed', result));
  } catch (error: any) {
    console.error('[vectorizeForCanvas] Error:', error);
    console.error('[vectorizeForCanvas] Error stack:', error.stack);
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || 'Failed to vectorize image';

    if (!res.headersSent) {
      return res.status(statusCode).json(
        formatApiResponse('error', message, null)
      );
    }
  }
}

export async function generateNextSceneForCanvas(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      console.error('[generateNextSceneForCanvas] Missing userId');
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { image, prompt, meta, lora_scale, lora_weights, true_guidance_scale, guidance_scale, num_inference_steps, aspectRatio, mode, images } = req.body;

    console.log('[generateNextSceneForCanvas] Request received:', {
      userId,
      hasImage: !!image,
      hasMeta: !!meta,
      projectId: meta?.projectId,
      hasPrompt: !!prompt,
    });

    if (!image) {
      console.error('[generateNextSceneForCanvas] Missing image');
      return res.status(400).json(
        formatApiResponse('error', 'Image is required', null)
      );
    }

    // Prompt is optional for Next Scene (defaults handled in service)
    /* 
    if (!prompt) {
      console.error('[generateNextSceneForCanvas] Missing prompt');
      return res.status(400).json(
        formatApiResponse('error', 'Prompt is required', null)
      );
    } 
    */

    if (!meta || meta.source !== 'canvas' || !meta.projectId) {
      console.error('[generateNextSceneForCanvas] Invalid meta:', meta);
      return res.status(400).json(
        formatApiResponse('error', 'Invalid request: meta.source must be "canvas" and meta.projectId is required', null)
      );
    }

    const result = await generateService.generateNextSceneForCanvas(userId, {
      image: image,
      prompt: prompt,
      lora_scale,
      lora_weights,
      true_guidance_scale,
      guidance_scale,
      num_inference_steps,
      aspectRatio,
      projectId: meta.projectId,
      elementId: meta.elementId,
      meta,
      mode,
      images,
    });
    console.log('[generateNextSceneForCanvas] Generation completed:', {
      hasUrl: !!(result as any).url,
    });

    // Debit credits
    const ctx = (req as any).context || {};
    const debitResult = {
      ...result,
      historyId: result.generationId
    };
    await postSuccessDebit(userId, debitResult, ctx, 'canvas', 'generate'); // Using 'generate' for now, or 'next-scene' if priced differently

    return res.json(formatApiResponse('success', 'Next Scene generation completed', result));
  } catch (error: any) {
    console.error('[generateNextSceneForCanvas] Error:', error);
    console.error('[generateNextSceneForCanvas] Error stack:', error.stack);
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || 'Failed to generate Next Scene';

    if (!res.headersSent) {
      return res.status(statusCode).json(
        formatApiResponse('error', message, null)
      );
    }
  }
} // End generateNextSceneForCanvas

export async function createStitchedReferenceImage(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      console.error('[createStitchedReferenceImage] Missing userId');
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { images, projectId } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json(
        formatApiResponse('error', 'Images array is required and cannot be empty', null)
      );
    }

    if (!projectId) {
      return res.status(400).json(
        formatApiResponse('error', 'projectId is required', null)
      );
    }

    console.log('[createStitchedReferenceImage] Creating stitched reference image:', {
      userId,
      projectId,
      imageCount: images.length,
    });

    // Build reference image items
    const referenceItems: ReferenceImageItem[] = images.map((img: any) => ({
      url: img.url,
      label: img.label || `${img.type || 'Image'}: ${img.name || 'Unknown'}`,
      type: img.type || 'character',
    }));

    // Create stitched reference image
    const stitchedBuffer = await createReferenceImage(referenceItems);

    // Upload to Zata storage
    const canvasKeyPrefix = `users/${userId}/canvas/${projectId}`;
    const fileName = `reference-stitched-${Date.now()}.png`;
    const key = `${canvasKeyPrefix}/${fileName}`;

    const { publicUrl } = await uploadBufferToZata(key, stitchedBuffer, 'image/png');

    console.log('[createStitchedReferenceImage] ✅ Stitched reference image created:', {
      url: publicUrl,
      key,
    });

    return res.status(200).json(
      formatApiResponse('success', 'Stitched reference image created', {
        url: publicUrl,
        key,
      })
    );
  } catch (error: any) {
    console.error('[createStitchedReferenceImage] Error:', error);
    return res.status(500).json(
      formatApiResponse('error', error.message || 'Failed to create stitched reference image', null)
    );
  }
}

export async function eraseForCanvas(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      console.error('[eraseForCanvas] Missing userId');
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { image, mask, meta, prompt } = req.body;

    console.log('[eraseForCanvas] Request received:', {
      userId,
      hasImage: !!image,
      hasMask: !!mask,
      hasMeta: !!meta,
      projectId: meta?.projectId,
      hasPrompt: !!prompt,
    });

    if (!image) {
      console.error('[eraseForCanvas] Missing image');
      return res.status(400).json(
        formatApiResponse('error', 'Image is required', null)
      );
    }

    // Mask is now optional - image should be composited with white mask overlay
    // If mask is provided, it will be ignored (we use the composited image instead)
    if (mask) {
      console.log('[eraseForCanvas] Mask provided but will be ignored (using composited image)');
    }

    if (!meta || meta.source !== 'canvas' || !meta.projectId) {
      console.error('[eraseForCanvas] Invalid meta:', meta);
      return res.status(400).json(
        formatApiResponse('error', 'Invalid request: meta.source must be "canvas" and meta.projectId is required', null)
      );
    }

    const result = await generateService.eraseForCanvas(userId, {
      image,
      mask,
      projectId: meta.projectId,
      elementId: meta.elementId,
      prompt,
    });

    console.log('[eraseForCanvas] Erase completed:', {
      hasUrl: !!result.url,
    });


    // Debit credits
    const ctx = (req as any).context || {};
    const debitResult = {
      ...result,
      historyId: result.generationId
    };
    const debitStatus = await postSuccessDebit(userId, debitResult, ctx, 'canvas', 'erase');

    return res.json(formatApiResponse('success', 'Image erase completed', {
      ...result,
      debitedCredits: ctx.creditCost,
      debitStatus,
    }));
  } catch (error: any) {
    console.error('[eraseForCanvas] Error:', error);
    console.error('[eraseForCanvas] Error stack:', error.stack);
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || 'Failed to erase image';

    if (!res.headersSent) {
      return res.status(statusCode).json(
        formatApiResponse('error', message, null)
      );
    }
  }
}

export async function replaceForCanvas(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      console.error('[replaceForCanvas] Missing userId');
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { image, mask, meta, prompt } = req.body;

    console.log('[replaceForCanvas] Request received:', {
      userId,
      hasImage: !!image,
      hasMask: !!mask,
      hasMeta: !!meta,
      projectId: meta?.projectId,
      hasPrompt: !!prompt,
    });

    if (!image) {
      console.error('[replaceForCanvas] Missing image');
      return res.status(400).json(
        formatApiResponse('error', 'Image is required', null)
      );
    }

    // Prompt is REQUIRED for replace (unlike erase which has a default)
    if (!prompt || !prompt.trim()) {
      console.error('[replaceForCanvas] Missing prompt');
      return res.status(400).json(
        formatApiResponse('error', 'Prompt is required for image replace. Please describe what you want to replace the selected area with.', null)
      );
    }

    // Mask is now optional - image should be composited with white mask overlay
    // If mask is provided, it will be ignored (we use the composited image instead)
    if (mask) {
      console.log('[replaceForCanvas] Mask provided but will be ignored (using composited image)');
    }

    if (!meta || meta.source !== 'canvas' || !meta.projectId) {
      console.error('[replaceForCanvas] Invalid meta:', meta);
      return res.status(400).json(
        formatApiResponse('error', 'Invalid request: meta.source must be "canvas" and meta.projectId is required', null)
      );
    }

    const result = await generateService.replaceForCanvas(userId, {
      image,
      mask,
      projectId: meta.projectId,
      elementId: meta.elementId,
      prompt: prompt.trim(), // REQUIRED - what to replace the white area with
    });

    console.log('[replaceForCanvas] Replace completed:', {
      hasUrl: !!result.url,
    });


    // Debit credits
    const ctx = (req as any).context || {};
    const debitResult = {
      ...result,
      historyId: result.generationId
    };
    const debitStatus = await postSuccessDebit(userId, debitResult, ctx, 'canvas', 'replace');

    return res.json(formatApiResponse('success', 'Image replace completed', {
      ...result,
      debitedCredits: ctx.creditCost,
      debitStatus,
    }));
  } catch (error: any) {
    console.error('[replaceForCanvas] Error:', error);
    console.error('[replaceForCanvas] Error stack:', error.stack);
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || 'Failed to replace image';

    if (!res.headersSent) {
      return res.status(statusCode).json(
        formatApiResponse('error', message, null)
      );
    }
  }
}
