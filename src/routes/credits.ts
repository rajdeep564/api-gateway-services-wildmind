import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { creditsController } from '../controllers/creditsController';

const router = Router();

router.get('/me', requireAuth, creditsController.me);
router.post('/reconcile', requireAuth, creditsController.reconcile);

export default router;


