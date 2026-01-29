import { Router } from 'express';
import * as vintageTeleportController from '../../../controllers/workflows/fun/vintageTeleportController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, vintageTeleportController.handleVintageTeleport);

export default router;
