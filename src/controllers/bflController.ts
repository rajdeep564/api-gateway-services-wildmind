import { Request, Response, NextFunction } from 'express';
import { bflService } from '../services/bflService';
import { formatApiResponse } from '../utils/formatApiResponse';

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, userPrompt, model, n, frameSize, style, uploadedImages, width, height } = req.body || {};
    const result = await bflService.generate({ prompt, userPrompt, model, n, frameSize, style, uploadedImages, width, height });
    res.json(formatApiResponse('success', 'Images generated', result));
  } catch (err) {
    next(err);
  }
}

export const bflController = {
  generate
}