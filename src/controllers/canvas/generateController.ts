import { Request, Response } from 'express';
import { generateService } from '../../services/canvas/generateService';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ApiError } from '../../utils/errorHandler';
import { CanvasGenerationRequest } from '../../types/canvas';

export async function generateForCanvas(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { prompt, model, width, height, seed, options, meta } = req.body;

    if (!meta || meta.source !== 'canvas' || !meta.projectId) {
      throw new ApiError('Invalid request: meta.source must be "canvas" and meta.projectId is required', 400);
    }

    const request: CanvasGenerationRequest = {
      prompt,
      model,
      width,
      height,
      seed,
      options,
      meta: {
        source: 'canvas',
        projectId: meta.projectId,
        elementId: meta.elementId,
      },
    };

    const result = await generateService.generateForCanvas(userId, request);

    res.json(formatApiResponse('success', 'Generation completed', result));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to generate', null)
    );
  }
}

