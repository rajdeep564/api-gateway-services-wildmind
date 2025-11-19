import { Router } from 'express';
import { authController, sessionCacheStatus } from '../controllers/auth/authController';
import { redeemCodeController } from '../controllers/redeemCodeController';
import { publicVisibilityController } from '../controllers/auth/publicVisibilityController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateSession, validateOtpStart, validateOtpVerify, validateUsername, validateUpdateMe, validateLogin, validateGoogleSignIn, validateGoogleUsername, validateCheckUsername } from '../middlewares/validateAuth';

const router = Router();

// Log all requests to auth routes
router.use((req, res, next) => {
  console.log('[AUTH][ROUTE] Request received', {
    method: req.method,
    path: req.path,
    url: req.url,
    origin: req.headers.origin,
    hasBody: !!req.body,
    bodyKeys: req.body ? Object.keys(req.body) : []
  });
  next();
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
// Check if user can toggle public generation (free users cannot)
router.get('/can-toggle-public', requireAuth, publicVisibilityController.canTogglePublic);
// Debug: check if current session cookie is cached in Redis
router.get('/session-cache', requireAuth, sessionCacheStatus);

// Debug endpoint to check cookie domain configuration (no auth required for debugging)
router.get('/debug/cookie-config', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.COOKIE_DOMAIN;
  
  console.log('[AUTH][DEBUG] Cookie config check', {
    isProd,
    cookieDomain: cookieDomain || '(NOT SET - THIS IS THE PROBLEM!)',
    nodeEnv: process.env.NODE_ENV,
    allEnvKeys: Object.keys(process.env).filter(k => k.includes('COOKIE') || k.includes('DOMAIN'))
  });
  
  res.json({
    isProduction: isProd,
    cookieDomain: cookieDomain || '(NOT SET)',
    message: cookieDomain 
      ? `Cookie domain is set to: ${cookieDomain}. Cookies should work across subdomains.`
      : 'ERROR: COOKIE_DOMAIN is NOT SET in environment variables! Set it to ".wildmindai.com" in Render.com dashboard.',
    instructions: [
      '1. Go to Render.com dashboard',
      '2. Select your API Gateway service',
      '3. Go to Environment tab',
      '4. Add: COOKIE_DOMAIN=.wildmindai.com',
      '5. Restart the service'
    ]
  });
});

export default router;


