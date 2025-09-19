import { Router } from 'express';
import { FalController } from '../controllers/falController';

const router = Router();

// FAL API endpoints that match your frontend expectations
router.post('/submit', FalController.submit);
router.get('/status', FalController.status);
router.get('/result', FalController.result);

export default router;
