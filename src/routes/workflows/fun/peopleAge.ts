import { Router } from 'express';
import * as peopleAgeController from '../../../controllers/workflows/fun/peopleAgeController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, peopleAgeController.handlePeopleAge);

export default router;
