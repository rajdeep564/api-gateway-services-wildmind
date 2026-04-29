import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { ApiError } from '../utils/errorHandler';
import { getModelCost } from '../repository/creditsRepository';
import { PRICING_VERSION } from '../data/creditDistribution';
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

    // Pricing rules (dynamic lookup from credit-service)
    const basePerImage = await getModelCost(model);
    if (basePerImage == null) throw new ApiError('Unsupported model', 400);

    const count = Math.max(1, Math.min(10, Number(n)));
    // Charge solely by model and count
    const cost = Math.ceil(basePerImage * count);

    const { creditBalance } = await ensureUserInit(uid);
    logger.info({ uid, model, n: count, cost, creditBalance }, '[CREDITS] Pre-check: computed cost and current balance');

    if (creditBalance < cost) {
      return res.status(402).json({
        responseStatus: 'error',
        message: 'Credits are not available, please recharge.',
        data: {
          requiredCredits: cost,
          currentBalance: creditBalance,
          suggestion: 'Please recharge your credits to continue.',
        },
      });
    }

    const idempotencyKey = randomUUID();
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


