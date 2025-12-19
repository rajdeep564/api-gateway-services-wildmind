import { Router } from 'express';
import { authController, sessionCacheStatus, debugSession, debugSessionRefresh } from '../controllers/auth/authController';
import { redeemCodeController } from '../controllers/redeemCodeController';
import { publicVisibilityController } from '../controllers/auth/publicVisibilityController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateSession, validateOtpStart, validateOtpVerify, validateUsername, validateUpdateMe, validateLogin, validateGoogleSignIn, validateGoogleUsername, validateCheckUsername, validateForgotPassword } from '../middlewares/validateAuth';
import { env } from '../config/env';

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
// Debug: comprehensive session status check (no auth required for debugging)
router.get('/debug-session', debugSession);
// Debug: simulate mid-life session refresh decision (query: ?simulateAgeDays=8)
router.get('/debug/session-refresh', debugSessionRefresh);

// Debug endpoint to check cookie domain configuration (no auth required for debugging)
router.get('/debug/cookie-config', (req, res) => {
  const isProd = env.nodeEnv === 'production';
  const cookieDomain = env.cookieDomain;
  
  // CRITICAL: Analyze cookie header to see if cookie is being sent
  const cookieHeader = req.headers.cookie || '';
  const allCookies = cookieHeader.split(';').map(c => c.trim());
  const hasAppSession = cookieHeader.includes('app_session=');
  const appSessionCookie = allCookies.find(c => c.startsWith('app_session='));
  
  console.log('[AUTH][DEBUG] Cookie config check', {
    isProd,
    cookieDomain: cookieDomain || '(NOT SET - THIS IS THE PROBLEM!)',
    nodeEnv: env.nodeEnv,
    allEnvKeys: Object.keys(process.env).filter(k => k.includes('COOKIE') || k.includes('DOMAIN')),
    requestOrigin: req.headers.origin,
    requestHost: req.headers.host,
    cookieHeaderAnalysis: {
      hasCookieHeader: !!req.headers.cookie,
      cookieHeaderLength: cookieHeader.length,
      allCookies: allCookies,
      hasAppSession,
      appSessionCookie: appSessionCookie ? (appSessionCookie.length > 50 ? appSessionCookie.substring(0, 50) + '...' : appSessionCookie) : null
    }
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
    ],
    // CRITICAL: Add cookie header analysis
    cookieHeaderAnalysis: {
      hasCookieHeader: !!req.headers.cookie,
      cookieHeaderLength: cookieHeader.length,
      allCookies: allCookies,
      hasAppSession,
      appSessionCookieFound: !!appSessionCookie,
      cookieCount: allCookies.length,
      hostname: req.hostname,
      origin: req.headers.origin,
      diagnosis: !hasAppSession ? {
        issue: 'Cookie NOT in request header',
        explanation: 'The app_session cookie is not being sent with this request. This means the cookie either:',
        possibleCauses: [
          '1. COOKIE_DOMAIN env var is NOT set in backend (most likely)',
          '2. Cookie was set without Domain attribute (old cookie before env var was set)',
          '3. Cookie domain mismatch (cookie for www.wildmindai.com but accessing studio.wildmindai.com)',
          '4. User is not logged in on www.wildmindai.com'
        ],
        howToFix: [
          '1. Set COOKIE_DOMAIN=.wildmindai.com in Render.com environment',
          '2. Restart backend service',
          '3. Log in again on www.wildmindai.com (old cookies won\'t have domain)',
          '4. Check DevTools → Application → Cookies → verify Domain: .wildmindai.com',
          '5. Then try studio.wildmindai.com again'
        ]
      } : {
        issue: 'Cookie found in request header',
        status: 'Cookie is being sent - check token verification in debug-session endpoint'
      }
    }
  });
});

// Test endpoint to manually set a cookie with the correct domain
router.get('/debug/test-cookie', (req, res) => {
  const isProd = env.nodeEnv === 'production';
  // Use cookieDomain from env, or derive from productionDomain if available
  const cookieDomain = env.cookieDomain || (env.productionDomain ? new URL(env.productionDomain).hostname.replace('www.', '.') : undefined);
  
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


