import { Router } from 'express';
import * as becomeCelebrityController from '../../../controllers/workflows/fun/becomeCelebrityController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, becomeCelebrityController.handleBecomeCelebrity);

export default router;
