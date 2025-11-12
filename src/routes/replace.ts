import { Router, Request } from 'express';
import { replaceController } from '../controllers/replaceController';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { validateReplace } from '../middlewares/validators/replace/validateReplace';

const router = Router();

// Credit cost function for replace operations
// Google Nano Banana requires 98 credits per operation
async function computeReplaceCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const model = req.body?.model || 'google_nano_banana';
  // Google Nano Banana costs 98 credits per replace/erase operation
  const baseCost = model === 'google_nano_banana' ? 98 : 12;
  return {
    cost: baseCost,
    pricingVersion: '1.0',
    meta: { model, operation: 'replace' },
  };
}

router.post(
  '/edit',
  requireAuth,
  validateReplace,
  makeCreditCost('replace', 'edit', computeReplaceCost) as any,
  replaceController.editImage
);

export default router;

