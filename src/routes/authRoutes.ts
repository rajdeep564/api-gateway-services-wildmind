import { Router } from 'express';
import { AuthController } from '../controllers/auth/authController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();
const authController = new AuthController();

router.post('/api/auth/session', authController.createSession.bind(authController));
router.post('/api/auth/email/start', authController.startEmailOtp.bind(authController));
router.post('/api/auth/email/verify', authController.verifyEmailOtp.bind(authController));
router.post('/api/auth/email/username', authController.setEmailUsername.bind(authController));
router.get('/api/auth/resolve-email', authController.resolveEmail.bind(authController));
router.get('/api/auth/resolve-uid', authController.resolveUid.bind(authController));
router.get('/api/me', requireAuth, authController.getCurrentUser.bind(authController));
router.patch('/api/me', requireAuth, authController.updateUser.bind(authController));
router.post('/api/logout', authController.logout.bind(authController));

export default router;


