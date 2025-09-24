import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/errorHandler';
import { creditsService } from '../services/creditsService';
import { v4 as uuidv4 } from 'uuid';

type CostComputer = (req: Request) => Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }>;

export function makeCreditCost(provider: string, operation: string, computeCost: CostComputer) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uid = req.uid;
      if (!uid) throw new ApiError('Unauthorized', 401);

      const { cost, pricingVersion, meta } = await computeCost(req);
      const { creditBalance } = await creditsService.ensureUserInit(uid);
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
        reason: `${provider}.${operation}`,
        idempotencyKey,
        pricingVersion,
        meta,
      };
      next();
    } catch (e) {
      next(e);
    }
  };
}


