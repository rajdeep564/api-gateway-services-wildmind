import { Router } from 'express';
import * as polaroidStyleController from '../../../controllers/workflows/fun/polaroidStyleController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, polaroidStyleController.handlePolaroidStyle);

export default router;
