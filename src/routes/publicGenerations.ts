import { Router } from 'express';
import { publicGenerationsController } from '../controllers/publicGenerationsController';
import { validatePublicListGenerations, validateGenerationId, handleValidationErrors } from '../middlewares/validatePublicGenerations';

const router = Router();

// Public generations endpoints (no authentication required)
router.get('/', 
  validatePublicListGenerations as any, 
  handleValidationErrors, 
  publicGenerationsController.listPublic
);

router.get('/:generationId', 
  validateGenerationId as any, 
  handleValidationErrors, 
  publicGenerationsController.getPublicById
);

export default router;
