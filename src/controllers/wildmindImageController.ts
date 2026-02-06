import { Request, Response, NextFunction } from 'express';
import '../types/http';
import { formatApiResponse } from '../utils/formatApiResponse';
import { postSuccessDebit } from '../utils/creditDebit';
import { generateWildmindImage } from '../services/wildmindImageService';
import { logger } from '../utils/logger';

// Images

export async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const ctx = (req as any).context || {};

    // Strict Credit Deduction: Debit is handled inside service
    const result = await generateWildmindImage(uid, req.body, ctx);

    logger.info({ uid, historyId: (result as any)?.historyId }, '[WILDMINDIMAGE] generate completed');

    res.json(
      formatApiResponse('success', 'WILDMINDIMAGE generated', {
        ...result,
        debitedCredits: ctx.creditCost,
        debitStatus: 'WRITTEN_IN_SERVICE',
      })
    );
  } catch (err) {
    next(err);
  }
}

export const wildmindImageController = {
  generate,
};
