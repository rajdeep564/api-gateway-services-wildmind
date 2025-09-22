import { Router } from 'express';
import bflRoutes from './bfl';
import falRoutes from './fal';
import minimaxRoutes from './minimax';
import runwayRoutes from './runway';
import authRoutes from './authRoutes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/bfl', bflRoutes);
router.use('/fal', falRoutes);
router.use('/minimax', minimaxRoutes);
router.use('/runway', runwayRoutes);

export default router;
