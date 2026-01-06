import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { validateWildmindImageGenerate } from '../middlewares/validators/wildmindimage/validateWildmindImageGenerate';
import { computeWildmindImageCost } from '../utils/pricing/wildmindimagePricing';
import { wildmindImageController } from '../controllers/wildmindImageController';

const router = Router();

router.post(
  '/generate',
  requireAuth,
  validateWildmindImageGenerate,
  makeCreditCost('wildmindimage', 'generate', computeWildmindImageCost),
  wildmindImageController.generate as any
);

export default router;
