import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/errorHandler';
import { bflutils } from '../utils/bflutils';
import { PRICING_VERSION } from '../data/creditDistribution';
import { v4 as uuidv4 } from 'uuid';
import { creditsService } from '../services/creditsService';
import { logger } from '../utils/logger';

async function ensureUserInit(uid: string): Promise<{ creditBalance: number; planCode: string }> {
  const doc = await creditsService.ensureUserInit(uid);
  return { creditBalance: doc.creditBalance, planCode: doc.planCode };
}

export async function creditCost(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    if (!uid) throw new ApiError('Unauthorized', 401);

    const { model, n = 1, frameSize, width, height, output_format } = req.body || {};
    if (!model) throw new ApiError('model is required', 400);

    // Pricing rules (simple first-cut using creditsPerGeneration from matrix)
    const basePerImage = bflutils.getCreditsPerImage(model);
    if (basePerImage == null) throw new ApiError('Unsupported model', 400);

    const count = Math.max(1, Math.min(10, Number(n)));
    // Charge solely by model and count
    const cost = Math.ceil(basePerImage * count);

    const { creditBalance } = await ensureUserInit(uid);
    logger.info({ uid, model, n: count, cost, creditBalance }, '[CREDITS] Pre-check: computed cost and current balance');

    if (creditBalance < cost) {
      return res.status(402).json({
        responseStatus: 'error',
        message: 'Payment Required',
        data: {
          requiredCredits: cost,
          currentBalance: creditBalance,
          suggestion: 'Buy plan or reduce n/size',
        },
      });
    }

    const idempotencyKey = uuidv4();
    (req as any).context = {
      creditCost: cost,
      reason: 'bfl.generate',
      idempotencyKey,
      pricingVersion: PRICING_VERSION,
      meta: { model, n: count, frameSize, width, height, output_format },
    };
    logger.info({ uid, idempotencyKey, cost }, '[CREDITS] Pre-authorized (post-charge on success)');

    return next();
  } catch (err) {
    logger.error({ err }, '[CREDITS] creditCost middleware error');
    return next(err);
  }
}


