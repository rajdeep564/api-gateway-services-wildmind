import { Router } from 'express';
import { authController } from '../controllers/auth/authController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateSession, validateOtpStart, validateOtpVerify, validateUsername, validateUpdateMe, validateLogin, validateGoogleSignIn, validateGoogleUsername } from '../middlewares/validateAuth';

const router = Router();

router.post('/session', validateSession, authController.createSession);
router.post('/login', validateLogin, authController.loginWithEmailPassword);
router.post('/google', validateGoogleSignIn, authController.googleSignIn);
router.post('/google/username', validateGoogleUsername, authController.setGoogleUsername);
router.post('/email/start', validateOtpStart, authController.startEmailOtp);
router.post('/email/verify', validateOtpVerify, authController.verifyEmailOtp);
router.post('/email/username', validateUsername, authController.setEmailUsername);
router.get('/resolve-email', authController.resolveEmail);
router.get('/me', requireAuth, authController.getCurrentUser);
router.patch('/me', requireAuth, validateUpdateMe, authController.updateUser);
router.post('/logout', authController.logout);

export default router;


