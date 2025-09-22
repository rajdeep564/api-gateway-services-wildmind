import { Router } from 'express';
import { bflController } from '../controllers/bflController';
import { validateBflGenerate } from '../middlewares/validators/bfl/validateBflGenerate';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

router.post('/generate', requireAuth, validateBflGenerate, bflController.generate);

export default router;
