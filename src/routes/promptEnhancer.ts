import { Router } from 'express';
import { enhance, enhanceBatch } from '../controllers/promptEnhancerController';

const router = Router();

// POST /api/prompt-enhancer/enhance
router.post('/enhance', enhance);

// POST /api/prompt-enhancer/enhance/batch
router.post('/enhance/batch', enhanceBatch);

export default router;

