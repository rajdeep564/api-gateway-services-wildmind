import { Request, Response, NextFunction } from 'express';
import { enhancePrompt, enhancePromptsBatch } from '../services/promptEnhancerService';
import { formatApiResponse } from '../utils/formatApiResponse';

export async function enhance(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, media_type, max_length, target_model } = req.body || {};

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json(formatApiResponse('error', 'prompt is required', null));
    }

    // Validate media_type if provided
    if (media_type && !['image', 'video', 'music'].includes(media_type)) {
      return res.status(400).json(formatApiResponse('error', 'media_type must be one of: image, video, music', null));
    }

    const result = await enhancePrompt(prompt, {
      mediaType: media_type || 'image',
      maxLength: max_length,
      targetModel: target_model,
    });

    if (!result || typeof result.enhancedPrompt !== 'string') {
      return res.status(500).json(formatApiResponse('error', 'Failed to enhance prompt', null));
    }

    return res.json(formatApiResponse('success', 'Prompt enhanced', {
      enhancedPrompt: result.enhancedPrompt,
      originalPrompt: result.originalPrompt,
      mediaType: result.mediaType,
      model: result.model,
    }));
  } catch (err: any) {
    console.error('[Prompt Enhancer Controller] Error:', err);
    next(err);
  }
}

export async function enhanceBatch(req: Request, res: Response, next: NextFunction) {
  try {
    const requests = req.body;

    if (!Array.isArray(requests) || requests.length === 0) {
      return res.status(400).json(formatApiResponse('error', 'Requests must be a non-empty array', null));
    }

    if (requests.length > 10) {
      return res.status(400).json(formatApiResponse('error', 'Maximum 10 prompts per batch request', null));
    }

    // Validate each request
    for (const req of requests) {
      if (!req.prompt || typeof req.prompt !== 'string') {
        return res.status(400).json(formatApiResponse('error', 'Each request must have a prompt string', null));
      }
      if (req.media_type && !['image', 'video', 'music'].includes(req.media_type)) {
        return res.status(400).json(formatApiResponse('error', 'media_type must be one of: image, video, music', null));
      }
    }

    const results = await enhancePromptsBatch(requests.map(r => ({
      prompt: r.prompt,
      mediaType: r.media_type || 'image',
    })));

    return res.json(formatApiResponse('success', 'Prompts enhanced', {
      results,
      total: results.length,
    }));
  } catch (err: any) {
    console.error('[Prompt Enhancer Controller] Batch error:', err);
    next(err);
  }
}

export default { enhance, enhanceBatch };

