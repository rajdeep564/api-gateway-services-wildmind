import { Router } from 'express';
import * as fusionStylesController from '../../../controllers/workflows/fun/fusionStylesController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, fusionStylesController.handleFusionStyles);

export default router;
