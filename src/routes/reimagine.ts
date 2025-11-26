import { Router, Request } from 'express';
import { reimagineController } from '../controllers/reimagineController';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { validateReimagine } from '../middlewares/validators/reimagine/validateReimagine';

const router = Router();

// Credit cost function for reimagine operations
// Google Nano Banana requires 98 credits per operation (same as replace)
async function computeReimagineCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  return {
    cost: 98,
    pricingVersion: '1.0',
    meta: { model: 'google_nano_banana', operation: 'reimagine' },
  };
}

router.post(
  '/generate',
  requireAuth,
  validateReimagine,
  makeCreditCost('reimagine', 'generate', computeReimagineCost) as any,
  reimagineController.generate
);

export default router;
