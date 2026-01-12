import express from 'express';
import { expressionSheetController } from '../../../controllers/workflows/photography/expressionSheetController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, expressionSheetController);

export default router;
