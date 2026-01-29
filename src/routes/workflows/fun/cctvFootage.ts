import { Router } from 'express';
import * as cctvFootageController from '../../../controllers/workflows/fun/cctvFootageController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, cctvFootageController.handleCCTVFootage);

export default router;
