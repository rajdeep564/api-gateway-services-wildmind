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
    });

    // Handle credit debit if configured
    let debitOutcome: 'SKIPPED' | 'WRITTEN' | undefined;
    try {
      const requestId = result.historyId || ctx.idempotencyKey;
      logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS][REIMAGINE] Attempt debit after success');
      if (requestId && typeof ctx.creditCost === 'number') {
        debitOutcome = await creditsRepository.writeDebitIfAbsent(
          uid,
          requestId,
          ctx.creditCost,
          ctx.reason || 'reimagine.generate',
          {
            ...(ctx.meta || {}),
            historyId: result.historyId,
            provider: 'google',
            pricingVersion: ctx.pricingVersion,
          }
        );
      }
    } catch (_e) {
      // Ignore debit errors
    }

    res.json(
      formatApiResponse('success', 'Reimagine completed successfully', {
        ...result,
        debitedCredits: ctx.creditCost,
        debitStatus: debitOutcome,
      })
    );
  } catch (err) {
    next(err);
  }
}

export const reimagineController = {
  generate,
};
