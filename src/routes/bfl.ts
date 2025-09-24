import { Router } from 'express';
import { bflController } from '../controllers/bflController';
import { validateBflGenerate, validateBflFill, validateBflExpand, validateBflCanny, validateBflDepth } from '../middlewares/validators/bfl/validateBflGenerate';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { computeBflCost, computeBflFillCost, computeBflExpandCost, computeBflCannyCost, computeBflDepthCost } from '../utils/pricing/bflPricing';

const router = Router();

router.post('/generate', requireAuth, validateBflGenerate, makeCreditCost('bfl', 'generate', computeBflCost), bflController.generate);
router.post('/fill', requireAuth, validateBflFill , makeCreditCost('bfl','fill', computeBflFillCost), bflController.fill);
router.post('/expand', requireAuth, validateBflExpand , makeCreditCost('bfl','expand', computeBflExpandCost), bflController.expand);
router.post('/canny', requireAuth, validateBflCanny , makeCreditCost('bfl','canny', computeBflCannyCost), bflController.canny);
router.post('/depth', requireAuth, validateBflDepth , makeCreditCost('bfl','depth', computeBflDepthCost), bflController.depth);

export default router;
