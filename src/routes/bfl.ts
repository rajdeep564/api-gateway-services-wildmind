import { Router } from 'express';
import { bflController } from '../controllers/bflController';
import { validateBflGenerate } from '../middlewares/validators/bfl/validateBflGenerate';

const router = Router();

router.post('/generate', validateBflGenerate, bflController.generate);

export default router;
