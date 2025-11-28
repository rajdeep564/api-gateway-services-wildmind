import { Router } from 'express';
import { authController, sessionCacheStatus, debugSession } from '../controllers/auth/authController';
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
router.post('/session/refresh', requireAuth, validateSession, authController.refreshSession);
router.post('/logout', authController.logout);
router.post('/redeem-code/apply', requireAuth, redeemCodeController.applyRedeemCode);
// Check if user can toggle public generation (free users cannot)
router.get('/can-toggle-public', requireAuth, publicVisibilityController.canTogglePublic);
// Debug: check if current session cookie is cached in Redis
router.get('/session-cache', requireAuth, sessionCacheStatus);
// Debug: comprehensive session status check (no auth required for debugging)
router.get('/debug-session', debugSession);

// Debug endpoint to check cookie domain configuration (no auth required for debugging)
router.get('/debug/cookie-config', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.COOKIE_DOMAIN;
  
  console.log('[AUTH][DEBUG] Cookie config check', {
    isProd,
    cookieDomain: cookieDomain || '(NOT SET - THIS IS THE PROBLEM!)',
    nodeEnv: process.env.NODE_ENV,
    allEnvKeys: Object.keys(process.env).filter(k => k.includes('COOKIE') || k.includes('DOMAIN')),
    requestOrigin: req.headers.origin,
    requestHost: req.headers.host
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
    ],
    troubleshooting: [
      'If cookieDomain is set but cookies still not working:',
      '1. Make sure you are LOGGED IN on www.wildmindai.com first',
      '2. Check browser DevTools → Application → Cookies for www.wildmindai.com',
      '3. Look for app_session cookie with Domain: .wildmindai.com',
      '4. Then open studio.wildmindai.com - cookie should be there',
      '5. Check backend logs for [AUTH][setSessionCookie] when you log in'
    ]
  });
});

// Test endpoint to manually set a cookie with the correct domain
router.get('/debug/test-cookie', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.COOKIE_DOMAIN || '.wildmindai.com';
  
  const testCookieValue = `test-${Date.now()}`;
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax" | "strict",
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    path: "/",
    domain: cookieDomain
  };
  
  console.log('[AUTH][DEBUG] Setting test cookie', {
    cookieValue: testCookieValue,
    cookieOptions
  });
  
  res.cookie("test_cookie", testCookieValue, cookieOptions);
  
  res.json({
    message: 'Test cookie set!',
    cookieName: 'test_cookie',
    cookieValue: testCookieValue,
    cookieOptions,
    instructions: [
      '1. Check browser DevTools → Application → Cookies',
      '2. Look for test_cookie with Domain: ' + cookieDomain,
      '3. If you see it, the cookie domain is working correctly',
      '4. The app_session cookie should work the same way when you log in'
    ]
  });
});

export default router;


