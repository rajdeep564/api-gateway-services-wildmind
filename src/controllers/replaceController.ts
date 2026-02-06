import { Request, Response, NextFunction } from 'express';
import '../types/http';
import { formatApiResponse } from '../utils/formatApiResponse';
import { replaceImage } from '../services/replaceService';
import { creditsRepository } from '../repository/creditsRepository';
import { logger } from '../utils/logger';

export async function editImage(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const ctx = (req as any).context || {};
    const { input_image, masked_image, prompt, model } = req.body;

    logger.info({ uid, ctx, model }, '[CREDITS][REPLACE] Enter editImage with context');

    const result = await replaceImage(uid, {
      input_image,
      masked_image,
      prompt,
      model,
    }, ctx);

    // Debit is handled inside service
    // const debitOutcome = ... (removed)

    res.json(
      formatApiResponse('success', 'Image replaced successfully', {
        ...result,
        debitedCredits: ctx.creditCost,
        debitStatus: 'WRITTEN_IN_SERVICE',
      })
    );
  } catch (err) {
    next(err);
  }
}

export const replaceController = {
  editImage,
};

