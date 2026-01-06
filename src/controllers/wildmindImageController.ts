import { Request, Response, NextFunction } from 'express';
import '../types/http';
import { formatApiResponse } from '../utils/formatApiResponse';
import { postSuccessDebit } from '../utils/creditDebit';
import { generateWildmindImage } from '../services/wildmindImageService';
import { logger } from '../utils/logger';

export async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const ctx = (req as any).context || {};

    const result = await generateWildmindImage(uid, req.body);

    let debitStatus: any;
    try {
      debitStatus = await postSuccessDebit(uid, result, ctx, 'wildmindimage', 'generate');
    } catch {
      // ignore debit errors
    }

    logger.info({ uid, historyId: (result as any)?.historyId, debitStatus }, '[WILDMINDIMAGE] generate completed');

    res.json(
      formatApiResponse('success', 'WILDMINDIMAGE generated', {
        ...result,
        debitedCredits: ctx.creditCost,
        debitStatus,
      })
    );
  } catch (err) {
    next(err);
  }
}

export const wildmindImageController = {
  generate,
};
