import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { creditsController } from '../controllers/creditsController';

const router = Router();

router.get('/me', requireAuth, creditsController.me);

export default router;


