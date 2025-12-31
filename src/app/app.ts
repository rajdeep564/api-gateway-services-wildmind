import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from '../routes';
import { errorHandler } from '../utils/errorHandler';
import { formatApiResponse } from '../utils/formatApiResponse';
import { gzipCompression, httpParamPollution, requestId, securityHeaders, originCheck } from '../middlewares/security';
import { globalLimiter, authLimiter, generationLimiter, apiLimiter, pollingLimiter } from '../middlewares/rateLimiter';
import { ipFirewall } from '../middlewares/ipFirewall';
import { sanitizeInput, detectInjectionAttacks } from '../middlewares/validation';
import { httpLogger } from '../middlewares/logger';
import { adminDb, admin } from '../config/firebaseAdmin';
import { env } from '../config/env';
import { creditsService } from '../services/creditsService';
import { getRedisClient, isRedisEnabled } from '../config/redisClient';
// Note: dotenv is loaded in index.ts, no need to load here

const app = express();


// Trust proxy settings (safe for rate limiting)
const isProd = env.nodeEnv === 'production';
app.set('trust proxy', isProd ? 1 : false);

// Security and common middlewares (SOC2 oriented)
app.use(requestId);
app.use(securityHeaders);
// CORS for frontend with credentials (dev + prod)
const isProdEnv = env.nodeEnv === 'production';
// Always include production origins (even if NODE_ENV isn't set, Render.com is production)
const allowedOrigins = [
  // Production hosts (always include these for live site)
  env.productionWwwDomain,
  env.productionDomain,
  env.productionStudioDomain, // Canvas subdomain
  // Development origins (only in dev)
  ...(!isProdEnv ? [
    env.devFrontendUrl, // Main project dev (usually :3000)
    env.devCanvasUrl, // Canvas dev (usually :3001)
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ] : []),
  ...env.frontendOrigins,
  ...env.allowedOrigins
].filter(Boolean);

console.log('[CORS] Allowed origins:', allowedOrigins);


const corsOptions: any = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow server-to-server (no Origin header) and health checks

    if (!origin) return callback(null, true);
    try {
      if (allowedOrigins.includes(origin)) return callback(null, true);

      // Allow subdomains of production domain
      const originUrl = new URL(origin);
      const prodDomain = env.productionDomain ? new URL(env.productionDomain).hostname : (env.productionWwwDomain ? new URL(env.productionWwwDomain).hostname.replace(/^www\./, '') : undefined);
      const prodWwwDomain = env.productionWwwDomain ? new URL(env.productionWwwDomain).hostname : (prodDomain ? `www.${prodDomain}` : undefined);
      if (prodDomain && (originUrl.hostname === prodWwwDomain ||
        originUrl.hostname === prodDomain ||
        originUrl.hostname.endsWith(`.${prodDomain}`))) {
        return callback(null, true);
      }
      // Allow subdomains of the configured frontend origins
      for (const frontendOrigin of env.frontendOrigins) {
        try {
          const allowHost = new URL(frontendOrigin).hostname;
          const reqHost = originUrl.hostname;
          if (reqHost === allowHost || reqHost.endsWith(`.${allowHost}`)) {
            return callback(null, true);
          }
        } catch {
          // Skip invalid URLs
        }
      }
    } catch (e) {
      console.warn('[CORS] Error checking origin:', origin, e);
    }
    // Log blocked origin for debugging
    console.warn('[CORS] Blocked origin:', origin, 'Allowed:', allowedOrigins);
    return callback(new Error('CORS blocked: origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-Id',
    'X-Device-Id',
    'X-Device-Name',
    'X-Device-Info',
    'ngrok-skip-browser-warning',
    'Range',
    // Allow client no-cache request headers used for fresh reads
    'Cache-Control',
    'Pragma',
    'Expires'
  ],
  optionsSuccessStatus: 204,
  exposedHeaders: ['Content-Length', 'Content-Range'],
  preflightContinue: false, // End preflight requests immediately
  maxAge: 86400 // Cache preflight for 24 hours
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Strong preflight guard + always-set CORS headers (defensive against proxies/edges)
// const allowOrigin = (origin?: string) => {
//   if (!origin) return false;
//   try {
//     if (allowedOrigins.includes(origin)) return true;
//     // Allow production domain and all its subdomains
//     const originUrl = new URL(origin);
//     const prodDomain = env.productionDomain ? new URL(env.productionDomain).hostname : (env.productionWwwDomain ? new URL(env.productionWwwDomain).hostname.replace(/^www\./, '') : undefined);
//     const prodWwwDomain = env.productionWwwDomain ? new URL(env.productionWwwDomain).hostname : (prodDomain ? `www.${prodDomain}` : undefined);
//     if (prodDomain && (originUrl.hostname === prodWwwDomain || 
//         originUrl.hostname === prodDomain ||
//         originUrl.hostname.endsWith(`.${prodDomain}`))) {
//       return true;
//     }
//     if (env.frontendOrigin) {
//       const allowHost = new URL(env.frontendOrigin).hostname;
//       const reqHost = originUrl.hostname;
//       if (reqHost === allowHost || reqHost.endsWith(`.${allowHost}`)) return true;
//     }
//   } catch {}
//   return false;
// };

// app.use((req, res, next) => {
//   const origin = req.headers.origin as string | undefined;
//   if (allowOrigin(origin)) {
//     res.header('Access-Control-Allow-Origin', origin as string);
//     res.header('Vary', 'Origin');
//     res.header('Access-Control-Allow-Credentials', 'true');
//     res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
//     res.header(
//       'Access-Control-Allow-Headers',
//       'Content-Type, Authorization, X-Requested-With, X-Request-Id, X-Device-Id, X-Device-Name, X-Device-Info, ngrok-skip-browser-warning, Range, Cache-Control, Pragma, Expires'
//     );
//   }
//   if (req.method === 'OPTIONS') {
//     return res.status(204).end();
//   }
//   return next();
// });

// ============================================================================
// SECURITY LAYER - Applied in this order for defense-in-depth
// ============================================================================

// 1. IP Firewall - Block malicious IPs immediately
app.use(ipFirewall);

// 2. Global Rate Limiter - Prevent DDoS/brute force
app.use(globalLimiter);

// 3. Injection Attack Detection - Detect SQL/XSS attempts
app.use(detectInjectionAttacks);

// 4. Input Sanitization - Clean all inputs
app.use(sanitizeInput);

// Body parsers (after security checks)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Additional security middlewares
app.use(httpParamPollution);
app.use(gzipCompression);
app.use(httpLogger);
if (isProd) {
  app.use(originCheck);
}

// ============================================================================
// ROUTE-SPECIFIC RATE LIMITING
// ============================================================================

// Polling/Status endpoints - Very high limit (500 req/min) 
// Applied FIRST so they don't hit the general API limit
app.use('/api/runway/status', pollingLimiter);
app.use('/api/replicate/queue/status', pollingLimiter);
app.use('/api/replicate/status', pollingLimiter);
app.use('/api/fal/queue/status', pollingLimiter);
app.use('/api/fal/status', pollingLimiter);
app.use('/api/minimax/video/status', pollingLimiter);
app.use('/api/generation/status', pollingLimiter);

// Auth endpoints - Strict rate limiting (5 attempts per 15 min)
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);
app.use('/api/auth/google', authLimiter);

// Generation endpoints - Moderate rate limiting (30 per min)
app.use('/api/replicate/generate', generationLimiter);
app.use('/api/fal/submit', generationLimiter);
app.use('/api/local/upscale-generation', generationLimiter);
app.use('/api/gemini/enhance', generationLimiter);

// Standard API endpoints - Standard rate limiting (100 per min)
app.use('/api', apiLimiter);

console.log('[Security] ✅ All security middlewares applied');



// Health endpoint
app.get('/health', (_req, res) => {
  res.json(formatApiResponse('success', 'OK', { uptime: process.uptime() }));
});

// Auth config health (does not leak secrets)
app.get('/health/auth', (_req, res) => {
  try {
    const info = {
      firebaseApiKeyPresent: Boolean(env.firebaseApiKey),
      firebaseProjectId: env.firebaseProjectId || null,
      nodeEnv: env.nodeEnv,
    };
    return res.json(formatApiResponse('success', 'OK', info));
  } catch (_e) {
    return res.json(formatApiResponse('success', 'Error', { firebaseApiKeyPresent: false }));
  }
});

// Redis health (optional): reports if Redis cache is enabled and ping works
app.get('/health/redis', async (_req, res) => {
  try {
    if (!isRedisEnabled()) {
      return res.json(formatApiResponse('success', 'Redis disabled', { enabled: false }));
    }
    const client = getRedisClient();
    if (!client) {
      return res.json(formatApiResponse('success', 'Redis not initialized', { enabled: true, initialized: false }));
    }
    try {
      const pong = await client.ping();
      return res.json(formatApiResponse('success', 'Redis OK', { enabled: true, initialized: true, pong: pong === 'PONG' }));
    } catch (_e) {
      return res.json(formatApiResponse('success', 'Redis ping failed', { enabled: true, initialized: true, pong: false }));
    }
  } catch (_e) {
    return res.json(formatApiResponse('success', 'Redis check error', { enabled: false }));
  }
});

// API routes
app.use('/api', routes);
// Global error handler (should be after all routes)
app.use(errorHandler);

export default app;

// Minimal FREE plan seed on bootstrap (non-blocking)
(async () => {
  try {
    await creditsService.ensurePlansSeeded();
  } catch (_e) { }
})();

// Initialize Redis connection in background (non-blocking) when configured
(async () => {
  try {
    if (isRedisEnabled()) getRedisClient();
  } catch (_e) { }
})();

// Auto-populate signup image cache on startup (non-blocking, runs ONCE globally)
let cachePopulateStarted = false;
(async () => {
  try {
    const { signupImageCache } = await import('../repository/signupImageCache');
    const stats = await signupImageCache.getCacheStats();

    if (stats.count === 0 && !cachePopulateStarted) {
      cachePopulateStarted = true;
      console.log('[App] Signup image cache is empty, populating in background (ONE TIME ONLY)...');
      // Populate cache in background (non-blocking) - runs ONCE on server startup
      signupImageCache.refreshSignupImageCache().then((count) => {
        console.log(`[App] ✅ Signup image cache populated with ${count} images`);
      }).catch((error) => {
        console.error('[App] Failed to populate signup image cache:', error);
      });
    } else if (stats.count > 0) {
      console.log(`[App] Signup image cache ready (${stats.count} images cached)`);
    }
  } catch (_e) {
    // Non-fatal: cache will be populated on first request
  }
})();

// Email configuration check on startup
(async () => {
  try {
    const { isEmailConfigured } = await import('../utils/mailer');
    const { env } = await import('../config/env');

    if (!isEmailConfigured()) {
      console.warn('[EMAIL CONFIG] ⚠️  Email service is not properly configured!');
      console.warn('[EMAIL CONFIG] For production, you need:');
      console.warn('[EMAIL CONFIG]   - RESEND_API_KEY (preferred)');
      console.warn('[EMAIL CONFIG]   - SMTP_FROM (e.g., no-reply@wildmindai.com)');
      console.warn('[EMAIL CONFIG] Or as fallback:');
      console.warn('[EMAIL CONFIG]   - EMAIL_USER (Gmail address)');
      console.warn('[EMAIL CONFIG]   - EMAIL_APP_PASSWORD (Gmail app password)');
      console.warn('[EMAIL CONFIG] Current status:', {
        hasResendKey: !!env.resendApiKey,
        hasSmtpFrom: !!env.smtpFrom,
        hasEmailUser: !!env.emailUser,
        hasEmailAppPassword: !!env.emailAppPassword,
        environment: env.nodeEnv
      });
    } else {
      console.log('[EMAIL CONFIG] ✅ Email service is configured');
    }
  } catch (_e) {
    // Non-fatal: email check failed
  }
})();

// Start automatic 24-hour cache refresh (runs ONCE globally, not per user)
let refreshSchedulerStarted = false;
(async () => {
  if (refreshSchedulerStarted) return;
  refreshSchedulerStarted = true;

  try {
    const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

    console.log('[App] Starting automatic signup image cache refresh scheduler (every 24 hours)');

    // Refresh immediately if cache is empty
    const { signupImageCache } = await import('../repository/signupImageCache');
    const stats = await signupImageCache.getCacheStats();

    if (stats.count === 0) {
      console.log('[App] Cache empty, refreshing now...');
      signupImageCache.refreshSignupImageCache().catch((error) => {
        console.error('[App] Initial cache refresh failed:', error);
      });
    }

    // Schedule automatic refresh every 24 hours (runs ONCE globally)
    setInterval(() => {
      console.log('[App] Auto-refreshing signup image cache (24-hour schedule)...');
      signupImageCache.refreshSignupImageCache().then((count) => {
        console.log(`[App] ✅ Signup image cache auto-refreshed with ${count} images`);
      }).catch((error) => {
        console.error('[App] Auto-refresh failed:', error);
      });
    }, REFRESH_INTERVAL_MS);

    console.log('[App] ✅ Signup image cache auto-refresh scheduler started (runs every 24 hours)');
  } catch (_e) {
    console.error('[App] Failed to start cache refresh scheduler:', _e);
  }
})();