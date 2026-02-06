import { Router } from 'express';
import { minimaxController } from '../controllers/minimaxController';
import { validateMinimaxGenerate } from '../middlewares/validators/minmax/validateMinimaxGenerate';
import { validateMinimaxMusic } from '../middlewares/validators/minmax/validateMinimaxMusic';
import { validateMinimaxVideoGenerate, validateMinimaxStatusQuery, validateMinimaxFileQuery } from '../middlewares/validators/minmax/validateMinimaxVideo';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { computeMinimaxImageCost, computeMinimaxMusicCost, computeMinimaxVideoCost } from '../utils/pricing/minimaxPricing';
import { validateStorage } from '../middlewares/validators/validateStorageMiddleware';

const router = Router();

router.post('/generate', requireAuth, validateMinimaxGenerate, makeCreditCost('minimax','generate', computeMinimaxImageCost), validateStorage('image'), minimaxController.generate);
router.post('/video', requireAuth, validateMinimaxVideoGenerate, makeCreditCost('minimax','video', computeMinimaxVideoCost), validateStorage('video'), minimaxController.videoStart);
router.get('/video/status', requireAuth,  validateMinimaxStatusQuery, minimaxController.videoStatus);
router.get('/video/file',requireAuth, validateMinimaxFileQuery, minimaxController.videoFile);
router.post('/music', requireAuth, validateMinimaxMusic, makeCreditCost('minimax','music', computeMinimaxMusicCost), validateStorage('audio'), minimaxController.musicGenerate);

export default router;


