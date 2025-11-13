import { Request, Response } from 'express';
import { generateService } from '../../services/canvas/generateService';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ApiError } from '../../utils/errorHandler';
import { CanvasGenerationRequest } from '../../types/canvas';

export async function generateVideoForCanvas(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      console.error('[generateVideoForCanvas] Missing userId');
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { prompt, model, aspectRatio, duration, resolution, meta } = req.body;

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

    if (!model) {
      console.error('[generateVideoForCanvas] Missing model');
      return res.status(400).json(
        formatApiResponse('error', 'Model is required', null)
      );
    }

    const { generateVideoForCanvas: generateVideo } = await import('../../services/canvas/generateService');
    const result = await generateVideo(userId, {
      prompt,
      model,
      aspectRatio,
      duration,
      resolution,
      projectId: meta.projectId,
      elementId: meta.elementId,
    });

    console.log('[generateVideoForCanvas] Generation completed:', {
      hasMediaId: !!result.mediaId,
      hasUrl: !!result.url,
      hasTaskId: !!result.taskId,
    });

    return res.json(formatApiResponse('success', 'Video generation started', result));
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

    const { prompt, model, width, height, aspectRatio, seed, options, meta } = req.body;

    console.log('[generateForCanvas] Request received:', {
      userId,
      model,
      hasPrompt: !!prompt,
      hasMeta: !!meta,
      projectId: meta?.projectId,
    });

    if (!prompt) {
      console.error('[generateForCanvas] Missing prompt');
      return res.status(400).json(
        formatApiResponse('error', 'Prompt is required', null)
      );
    }

    if (!meta || meta.source !== 'canvas' || !meta.projectId) {
      console.error('[generateForCanvas] Invalid meta:', meta);
      return res.status(400).json(
        formatApiResponse('error', 'Invalid request: meta.source must be "canvas" and meta.projectId is required', null)
      );
    }

    if (!model) {
      console.error('[generateForCanvas] Missing model');
      return res.status(400).json(
        formatApiResponse('error', 'Model is required', null)
      );
    }

    const request: CanvasGenerationRequest = {
      prompt,
      model,
      width,
      height,
      aspectRatio, // Pass aspectRatio for proper model mapping
      seed,
      options,
      meta: {
        source: 'canvas',
        projectId: meta.projectId,
        elementId: meta.elementId,
      },
    };

    console.log('[generateForCanvas] Calling generateService.generateForCanvas');
    const result = await generateService.generateForCanvas(userId, request);
    console.log('[generateForCanvas] Generation completed:', {
      hasMediaId: !!result.mediaId,
      hasUrl: !!result.url,
    });

    return res.json(formatApiResponse('success', 'Generation completed', result));
  } catch (error: any) {
    console.error('[generateForCanvas] Error:', error);
    console.error('[generateForCanvas] Error stack:', error.stack);
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || 'Failed to generate';
    
    // Ensure response is sent
    if (!res.headersSent) {
      return res.status(statusCode).json(
        formatApiResponse('error', message, null)
      );
    }
  }
}

