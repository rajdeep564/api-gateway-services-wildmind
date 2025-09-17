import { Router } from 'express';
import bflRoutes from './bfl';

const router = Router();

router.use('/bfl', bflRoutes);

export default router;
