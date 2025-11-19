import { Router } from 'express';
import bflRoutes from './bfl';
import falRoutes from './fal';
import minimaxRoutes from './minimax';
import runwayRoutes from './runway';
import authRoutes from './authRoutes';
import creditsRoutes from './credits';
import generationsRoutes from './generations';
import publicGenerationsRoutes from './publicGenerations';
import redeemCodeRoutes from './redeemCodes';
import proxyRoutes from './proxy';
import stickerRoutes from './stickers';
import replicateRoutes from './replicate';
import canvasRoutes from './canvas';
import geminiRoutes from './gemini';
import replaceRoutes from './replace';

const router = Router();

router.use('/auth', authRoutes);
router.use('/bfl', bflRoutes);
router.use('/fal', falRoutes);
router.use('/minimax', minimaxRoutes);
router.use('/runway', runwayRoutes);
router.use('/generations', generationsRoutes);
router.use('/credits', creditsRoutes);
router.use('/feed', publicGenerationsRoutes);
router.use('/redeem-codes', redeemCodeRoutes);
router.use('/proxy', proxyRoutes);
router.use('/stickers', stickerRoutes);
router.use('/replicate', replicateRoutes);
router.use('/canvas', canvasRoutes);
router.use('/gemini', geminiRoutes);
router.use('/replace', replaceRoutes);

export default router;
