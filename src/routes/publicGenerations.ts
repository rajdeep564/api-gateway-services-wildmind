import { Router } from 'express';
import { publicGenerationsController } from '../controllers/publicGenerationsController';
import { validatePublicListGenerations, validateGenerationId, handleValidationErrors } from '../middlewares/validatePublicGenerations';

const router = Router();

// Public generations endpoints (no authentication required)
// Preflight support
router.options('/', (_req, res) => res.sendStatus(204));
router.options('/:generationId', (_req, res) => res.sendStatus(204));

// Optional HEAD handlers (some proxies send HEAD and expect 200)
router.head('/', 
  validatePublicListGenerations as any,
  handleValidationErrors,
  publicGenerationsController.listPublic as any
);
router.head('/:generationId', 
  validateGenerationId as any,
  handleValidationErrors,
  publicGenerationsController.getPublicById as any
);

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
