import { Router } from 'express';
import { bflController } from '../controllers/bflController';
import { validateBflGenerate, validateBflFill, validateBflExpand, validateBflCanny, validateBflDepth } from '../middlewares/validators/bfl/validateBflGenerate';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

router.post('/generate', requireAuth, validateBflGenerate, bflController.generate);
router.post('/fill', requireAuth, validateBflFill as any, bflController.fill);
router.post('/expand', requireAuth, validateBflExpand as any, bflController.expand);
router.post('/canny', requireAuth, validateBflCanny as any, bflController.canny);
router.post('/depth', requireAuth, validateBflDepth as any, bflController.depth);

export default router;
