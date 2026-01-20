import { Router } from 'express';
import * as changeSeasonsController from '../../../controllers/workflows/fun/changeSeasonsController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, changeSeasonsController.handleChangeSeasons);

export default router;
