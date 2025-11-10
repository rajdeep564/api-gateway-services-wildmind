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
    });

    // Handle credit debit if configured
    let debitOutcome: 'SKIPPED' | 'WRITTEN' | undefined;
    try {
      const requestId = result.historyId || ctx.idempotencyKey;
      logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS][REPLACE] Attempt debit after success');
      if (requestId && typeof ctx.creditCost === 'number') {
        debitOutcome = await creditsRepository.writeDebitIfAbsent(
          uid,
          requestId,
          ctx.creditCost,
          ctx.reason || 'replace.edit',
          {
            ...(ctx.meta || {}),
            historyId: result.historyId,
            provider: model === 'google_nano_banana' ? 'google' : 'seedream',
            pricingVersion: ctx.pricingVersion,
          }
        );
      }
    } catch (_e) {
      // Ignore debit errors
    }

    res.json(
      formatApiResponse('success', 'Image replaced successfully', {
        ...result,
        debitedCredits: ctx.creditCost,
        debitStatus: debitOutcome,
      })
    );
  } catch (err) {
    next(err);
  }
}

export const replaceController = {
  editImage,
};

