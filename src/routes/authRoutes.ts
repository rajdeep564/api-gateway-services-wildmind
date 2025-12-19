import { Router } from 'express';
import { authController, sessionCacheStatus } from '../controllers/auth/authController';
import { redeemCodeController } from '../controllers/redeemCodeController';
import { publicVisibilityController } from '../controllers/auth/publicVisibilityController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateSession, validateOtpStart, validateOtpVerify, validateUsername, validateUpdateMe, validateLogin, validateGoogleSignIn, validateGoogleUsername, validateCheckUsername, validateForgotPassword } from '../middlewares/validateAuth';
import { env } from '../config/env';

const router = Router();


router.post('/session', validateSession, authController.createSession);
router.post('/login', validateLogin, authController.loginWithEmailPassword);
router.post('/forgot-password', validateForgotPassword, authController.forgotPassword);
router.post('/google', validateGoogleSignIn, authController.googleSignIn);
router.post('/google/username', validateGoogleUsername, authController.setGoogleUsername);
router.post('/email/start', validateOtpStart, authController.startEmailOtp);
router.post('/email/verify', validateOtpVerify, authController.verifyEmailOtp);
router.post('/email/username', validateUsername, authController.setEmailUsername);
router.get('/resolve-email', authController.resolveEmail);
router.get('/username/check', validateCheckUsername, authController.checkUsername);
router.get('/me', requireAuth, authController.getCurrentUser);
router.patch('/me', requireAuth, validateUpdateMe, authController.updateUser);
router.post('/session/refresh', requireAuth, validateSession, authController.refreshSession);
router.post('/logout', authController.logout);
router.post('/redeem-code/apply', requireAuth, redeemCodeController.applyRedeemCode);
// Check if user can toggle public generation (free users cannot)
router.get('/can-toggle-public', requireAuth, publicVisibilityController.canTogglePublic);
// Debug: check if current session cookie is cached in Redis
router.get('/session-cache', requireAuth, sessionCacheStatus);
// Debug endpoints removed - cleaned up per request





export default router;


