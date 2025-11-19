import { Router } from 'express';
import { enhance } from '../controllers/geminiController';

const router = Router();

// POST /api/gemini/enhance
router.post('/enhance', enhance);

export default router;
