import { Request, Response, NextFunction } from 'express';
import { enhancePrompt } from '../services/geminiService';
import { formatApiResponse } from '../utils/formatApiResponse';

export async function enhance(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, model } = req.body || {};
    if (!prompt || typeof prompt !== 'string') return res.status(400).json(formatApiResponse('error', 'prompt required', null));

    const result = await enhancePrompt(prompt, model || undefined);
    if (!result || typeof result.enhancedPrompt !== 'string') {
      return res.status(500).json(formatApiResponse('error', 'Failed to enhance prompt', null));
    }

    return res.json(formatApiResponse('success', 'Prompt enhanced', { enhancedPrompt: result.enhancedPrompt }));
  } catch (err) {
    next(err);
  }
}

export default { enhance };
