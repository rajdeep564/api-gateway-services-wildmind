import { Router } from 'express';
import { storyboardController } from '../../../controllers/workflows/filmIndustry/storyboardController';

const router = Router();

router.post('/storyboard', storyboardController);

export default router;
