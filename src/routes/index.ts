import { Router } from 'express';
import generateRoutes from './generate';
import fluxRoutes from './flux';
import bflRoutes from './bfl';

const router = Router();

router.use('/generate', generateRoutes);
router.use('/flux', fluxRoutes);
router.use('/bfl', bflRoutes);

export default router;
