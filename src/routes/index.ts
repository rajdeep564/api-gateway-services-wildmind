import { Router } from 'express';
<<<<<<< HEAD
=======
import generateRoutes from './generate';
import fluxRoutes from './flux';
>>>>>>> 0865155ce1f1203295733682fae733abf57333b9
import bflRoutes from './bfl';

const router = Router();

<<<<<<< HEAD
=======
router.use('/generate', generateRoutes);
router.use('/flux', fluxRoutes);
>>>>>>> 0865155ce1f1203295733682fae733abf57333b9
router.use('/bfl', bflRoutes);

export default router;
