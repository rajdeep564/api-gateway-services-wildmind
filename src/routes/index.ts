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
import liveChatSessionsRoutes from './liveChatSessions';

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
router.use('/live-chat-sessions', liveChatSessionsRoutes);

export default router;
