import { Router } from 'express';
import { bflController } from '../controllers/bflController';
import { validateBflGenerate, validateBflFill, validateBflExpand, validateBflCanny, validateBflDepth, validateBflExpandWithFill } from '../middlewares/validators/bfl/validateBflGenerate';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { computeBflCost, computeBflFillCost, computeBflExpandCost, computeBflCannyCost, computeBflDepthCost, computeBflExpandWithFillCost } from '../utils/pricing/bflPricing';
import { validateStorage } from '../middlewares/validators/validateStorageMiddleware';

const router = Router();

router.post('/generate', requireAuth, validateBflGenerate, makeCreditCost('bfl', 'generate', computeBflCost), validateStorage('image'), bflController.generate);
router.post('/fill', requireAuth, validateBflFill , makeCreditCost('bfl','fill', computeBflFillCost), validateStorage('image'), bflController.fill);
router.post('/expand', requireAuth, validateBflExpand , makeCreditCost('bfl','expand', computeBflExpandCost), validateStorage('image'), bflController.expand);
router.post('/expand-with-fill', requireAuth, validateBflExpandWithFill , makeCreditCost('bfl','expandWithFill', computeBflExpandWithFillCost), validateStorage('image'), bflController.expandWithFill);
router.post('/canny', requireAuth, validateBflCanny , makeCreditCost('bfl','canny', computeBflCannyCost), validateStorage('image'), bflController.canny);
router.post('/depth', requireAuth, validateBflDepth , makeCreditCost('bfl','depth', computeBflDepthCost), validateStorage('image'), bflController.depth);

export default router;
