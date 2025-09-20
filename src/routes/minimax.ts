import { Router } from 'express';
import { minimaxController } from '../controllers/minimaxController';
import { validateMinimaxGenerate } from '../middlewares/validators/minmax/validateMinimaxGenerate';
import { validateMinimaxMusic } from '../middlewares/validators/minmax/validateMinimaxMusic';
import { validateMinimaxVideoGenerate, validateMinimaxStatusQuery, validateMinimaxFileQuery } from '../middlewares/validators/minmax/validateMinimaxVideo';

const router = Router();

router.post('/generate', validateMinimaxGenerate, minimaxController.generate);
router.post('/video', validateMinimaxVideoGenerate, minimaxController.videoStart);
router.get('/video/status', validateMinimaxStatusQuery, minimaxController.videoStatus);
router.get('/video/file', validateMinimaxFileQuery, minimaxController.videoFile);
router.post('/music', validateMinimaxMusic, minimaxController.musicGenerate);

export default router;


