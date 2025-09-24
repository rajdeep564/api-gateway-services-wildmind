import { Router } from 'express';
import bflRoutes from './bfl';
import falRoutes from './fal';
import minimaxRoutes from './minimax';
import runwayRoutes from './runway';
import authRoutes from './authRoutes';
import creditsRoutes from './credits';
import generationsRoutes from './generations';

const router = Router();

router.use('/auth', authRoutes);
router.use('/bfl', bflRoutes);
router.use('/fal', falRoutes);
router.use('/minimax', minimaxRoutes);
router.use('/runway', runwayRoutes);
router.use('/generations', generationsRoutes);
router.use('/credits', creditsRoutes);

export default router;
