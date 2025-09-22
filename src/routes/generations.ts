import { Router } from 'express';
import { generationHistoryController } from '../controllers/generationHistoryController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateCreateGeneration, validateUpdateGenerationStatus, validateListGenerations, handleValidationErrors } from '../middlewares/validateGenerations';

const router = Router();

// Internal/admin-only endpoints removed to automate flow within provider services
router.get('/', requireAuth, validateListGenerations as any, handleValidationErrors, generationHistoryController.listMine);
router.get('/:historyId', requireAuth, generationHistoryController.get);

export default router;


