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
import promptEnhancerRoutes from './promptEnhancer';
import replaceRoutes from './replace';
import reimagineRoutes from './reimagine';
import libraryRoutes from './library';
import uploadsRoutes from './uploads';
import videoProxyRoutes from './canvas/videoProxy';

const router = Router();

router.use('/auth', authRoutes);
router.use('/bfl', bflRoutes);
router.use('/fal', falRoutes);
router.use('/minimax', minimaxRoutes);
router.use('/runway', runwayRoutes);
router.use('/generations', generationsRoutes);
router.use('/library', libraryRoutes);
router.use('/uploads', uploadsRoutes);
router.use('/credits', creditsRoutes);
router.use('/feed', publicGenerationsRoutes);
router.use('/redeem-codes', redeemCodeRoutes);
router.use('/proxy', proxyRoutes);
router.use('/stickers', stickerRoutes);
router.use('/replicate', replicateRoutes);
router.use('/canvas', canvasRoutes);
router.use('/canvas/video', videoProxyRoutes);
router.use('/prompt-enhancer', promptEnhancerRoutes);
router.use('/replace', replaceRoutes);
router.use('/reimagine', reimagineRoutes);

export default router;

