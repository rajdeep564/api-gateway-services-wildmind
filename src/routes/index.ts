import { Router } from 'express';
import bflRoutes from './bfl';
import migrateRoutes from './migrate';

const router = Router();

router.use('/bfl', bflRoutes);
router.use('/migrate', migrateRoutes);

export default router;
