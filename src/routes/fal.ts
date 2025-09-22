import { Router } from 'express';
import  {falController} from '../controllers/falController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateFalGenerate } from '../middlewares/validators/fal/validateFalGenerate';

const router = Router();

router.post('/generate', requireAuth, validateFalGenerate, falController.generate);

export default router;


