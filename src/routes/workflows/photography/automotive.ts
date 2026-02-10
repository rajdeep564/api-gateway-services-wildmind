import { Router } from 'express';
import { automotiveController } from '../../../controllers/workflows/photography/automotiveController';

const router = Router();

router.post('/', automotiveController);

export default router;
