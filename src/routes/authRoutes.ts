import { Router } from 'express';
import { authController } from '../controllers/auth/authController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateSession, validateOtpStart, validateOtpVerify, validateUsername, validateUpdateMe, validateLogin, validateGoogleSignIn, validateGoogleUsername } from '../middlewares/validateAuth';

const router = Router();

router.post('/api/auth/session', validateSession, authController.createSession);
router.post('/api/auth/login', validateLogin, authController.loginWithEmailPassword);
router.post('/api/auth/google', validateGoogleSignIn, authController.googleSignIn);
router.post('/api/auth/google/username', validateGoogleUsername, authController.setGoogleUsername);
router.post('/api/auth/email/start', validateOtpStart, authController.startEmailOtp);
router.post('/api/auth/email/verify', validateOtpVerify, authController.verifyEmailOtp);
router.post('/api/auth/email/username', validateUsername, authController.setEmailUsername);
router.get('/api/auth/resolve-email', authController.resolveEmail);
router.get('/api/me', requireAuth, authController.getCurrentUser);
router.patch('/api/me', requireAuth, validateUpdateMe, authController.updateUser);
router.post('/api/logout', authController.logout);

export default router;


