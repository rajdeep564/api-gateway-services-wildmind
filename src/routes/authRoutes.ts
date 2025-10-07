import { Router } from 'express';
import { authController } from '../controllers/auth/authController';
import { redeemCodeController } from '../controllers/redeemCodeController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateSession, validateOtpStart, validateOtpVerify, validateUsername, validateUpdateMe, validateLogin, validateGoogleSignIn, validateGoogleUsername, validateCheckUsername } from '../middlewares/validateAuth';

const router = Router();

// Fast CORS preflight for Google auth (Vercel sometimes misses global CORS)
router.options('/google', (req, res) => {
  const origin = (req.headers.origin as string) || '';
  const allowed = [
    'https://www.wildmindai.com',
    'https://wildmindai.com',
    process.env.FRONTEND_ORIGIN || ''
  ].filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  const reqHeaders = req.header('access-control-request-headers');
  if (reqHeaders) res.setHeader('Access-Control-Allow-Headers', reqHeaders);
  return res.sendStatus(204);
});

router.post('/session', validateSession, authController.createSession);
router.post('/login', validateLogin, authController.loginWithEmailPassword);
router.post('/google', validateGoogleSignIn, authController.googleSignIn);
router.post('/google/username', validateGoogleUsername, authController.setGoogleUsername);
router.post('/email/start', validateOtpStart, authController.startEmailOtp);
router.post('/email/verify', validateOtpVerify, authController.verifyEmailOtp);
router.post('/email/username', validateUsername, authController.setEmailUsername);
router.get('/resolve-email', authController.resolveEmail);
router.get('/username/check', validateCheckUsername, authController.checkUsername);
router.get('/me', requireAuth, authController.getCurrentUser);
router.patch('/me', requireAuth, validateUpdateMe, authController.updateUser);
router.post('/logout', authController.logout);
router.post('/redeem-code/apply', requireAuth, redeemCodeController.applyRedeemCode);

export default router;


