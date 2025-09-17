import { Router } from 'express';
<<<<<<< HEAD
import { bflController } from '../controllers/bflController';
import { validateBflGenerate } from '../middlewares/validateBflGenerate';

const router = Router();

router.post('/generate', validateBflGenerate, bflController.generate);

export default router;
=======
const router = Router();
router.get('/', (_req, res) => res.json({ ok: true }));
export default router;


>>>>>>> 0865155ce1f1203295733682fae733abf57333b9
