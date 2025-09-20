import { Router } from 'express';
import  {falController} from '../controllers/falController';
import { validateFalGenerate } from '../middlewares/validators/fal/validateFalGenerate';

const router = Router();

router.post('/generate', validateFalGenerate, falController.generate);

export default router;


