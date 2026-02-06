import { Request, Response, NextFunction } from 'express';
import '../types/http';
import { formatApiResponse } from '../utils/formatApiResponse';
import { reimagineImage } from '../services/reimagineService';
import { creditsRepository } from '../repository/creditsRepository';
import { logger } from '../utils/logger';

export async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const ctx = (req as any).context || {};
    const { image_url, selection_bounds, prompt, isPublic, model, referenceImage } = req.body;

    logger.info({ uid, ctx }, '[CREDITS][REIMAGINE] Enter generate with context');

    const result = await reimagineImage(uid, {
      image_url,
      selection_bounds,
      prompt,
      isPublic,
      model,
      referenceImage,
    }, ctx);

    // Debit is handled inside service
    // const debitOutcome = ... (removed)

    res.json(
      formatApiResponse('success', 'Reimagine completed successfully', {
        ...result,
        debitedCredits: ctx.creditCost,
        debitStatus: 'WRITTEN_IN_SERVICE',
      })
    );
  } catch (err) {
    next(err);
  }
}

export const reimagineController = {
  generate,
};
