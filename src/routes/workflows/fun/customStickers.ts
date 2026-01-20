import { Router } from 'express';
import * as customStickersController from '../../../controllers/workflows/fun/customStickersController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, customStickersController.handleCustomStickers);

export default router;
