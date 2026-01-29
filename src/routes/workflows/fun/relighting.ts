import { Router } from 'express';
import * as relightingController from '../../../controllers/workflows/fun/relightingController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, relightingController.handleRelighting);

export default router;
