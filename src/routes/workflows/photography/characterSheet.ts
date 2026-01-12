import { Router } from 'express';
import { requireAuth } from '../../../middlewares/authMiddleware';
import { characterSheetController } from '../../../controllers/workflows/photography/characterSheetController';

const router = Router();

router.post('/', requireAuth, characterSheetController);

export default router;
