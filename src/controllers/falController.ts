import { Request, Response, NextFunction } from 'express';
import '../types/http';

import { formatApiResponse } from '../utils/formatApiResponse';
import {falService} from '../services/falService';

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, userPrompt, model, n, frameSize, style, uploadedImages, output_format } = req.body || {};
    const uid = req.uid;
    const result = await falService.generate(uid, { prompt, userPrompt, model, n, frameSize, style, uploadedImages, output_format });
    res.json(formatApiResponse('success', 'Images generated', result));
  } catch (err) {
    next(err);
  }
}

export const falController = {
  generate
}

