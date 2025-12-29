import { Router } from 'express';
import bflRoutes from './bfl';
import falRoutes from './fal';
import minimaxRoutes from './minimax';
import runwayRoutes from './runway';
import authRoutes from './authRoutes';
import creditsRoutes from './credits';
import generationsRoutes from './generations';
import publicGenerationsRoutes from './publicGenerations';
import engagementRoutes from './engagement';
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
import wildmindRoutes from './wildmind';
import chatCompanionRoutes from './chatCompanion';
import workflowsRoutes from './workflows';
import { contentModerationMiddleware } from '../middlewares/contentModeration';

const router = Router();

router.use('/auth', authRoutes);
// Apply prompt-level moderation to generation-capable services
router.use(
  [
    '/bfl',
    '/fal',
    '/minimax',
    '/runway',
    '/replicate',
    '/prompt-enhancer',
    '/replace',
    '/reimagine',
    '/wildmind',
  ],
  contentModerationMiddleware
);
router.use('/bfl', bflRoutes);
router.use('/fal', falRoutes);
router.use('/minimax', minimaxRoutes);
router.use('/runway', runwayRoutes);
router.use('/generations', generationsRoutes);
router.use('/library', libraryRoutes);
router.use('/uploads', uploadsRoutes);
router.use('/credits', creditsRoutes);
router.use('/feed', publicGenerationsRoutes);
router.use('/engagement', engagementRoutes);
router.use('/redeem-codes', redeemCodeRoutes);
router.use('/proxy', proxyRoutes);
router.use('/stickers', stickerRoutes);
router.use('/replicate', replicateRoutes);
router.use('/canvas', canvasRoutes);
router.use('/prompt-enhancer', promptEnhancerRoutes);
router.use('/replace', replaceRoutes);
router.use('/reimagine', reimagineRoutes);
router.use('/wildmind', wildmindRoutes);
router.use('/chat', chatCompanionRoutes);
router.use('/workflows', workflowsRoutes);

export default router;
