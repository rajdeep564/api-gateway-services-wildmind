import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from '../routes';
import { errorHandler } from '../utils/errorHandler';
import { formatApiResponse } from '../utils/formatApiResponse';
import { gzipCompression, httpParamPollution, requestId, securityHeaders, originCheck } from '../middlewares/security';
import { httpLogger } from '../middlewares/logger';
import { adminDb, admin } from '../config/firebaseAdmin';
import { env } from '../config/env';
import { creditsService } from '../services/creditsService';
import { getRedisClient, isRedisEnabled } from '../config/redisClient';
// Note: dotenv is loaded in index.ts, no need to load here

const app = express();

// Trust proxy settings (safe for rate limiting)
const isProd = process.env.NODE_ENV === 'production';
app.set('trust proxy', isProd ? 1 : false);

// Security and common middlewares (SOC2 oriented)
app.use(requestId);
app.use(securityHeaders);
// CORS for frontend with credentials (dev + prod)
const isProdEnv = process.env.NODE_ENV === 'production';
// Always include production origins (even if NODE_ENV isn't set, Render.com is production)
const allowedOrigins = [
  // Production hosts (always include these for live site)
  'https://www.wildmindai.com', 
  'https://wildmindai.com',
  'https://studio.wildmindai.com', // Canvas subdomain
  // Development origins (only in dev)
  ...(!isProdEnv ? [
    'http://localhost:3000', // Main project dev
    'http://localhost:3001', // Canvas dev
  ] : []),
  process.env.FRONTEND_ORIGIN || '',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : [])
].filter(Boolean);

const corsOptions: any = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow server-to-server (no Origin header) and health checks
    if (!origin) return callback(null, true);
    try {
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Allow subdomains of wildmindai.com
      const originUrl = new URL(origin);
      if (originUrl.hostname === 'www.wildmindai.com' || 
          originUrl.hostname === 'wildmindai.com' ||
          originUrl.hostname.endsWith('.wildmindai.com')) {
        return callback(null, true);
      }
      // Allow subdomains of the configured prod origin (e.g., preview/app)
      if (process.env.FRONTEND_ORIGIN) {
        const allowHost = new URL(process.env.FRONTEND_ORIGIN).hostname;
        const reqHost = originUrl.hostname;
        if (reqHost === allowHost || reqHost.endsWith(`.${allowHost}`)) {
          return callback(null, true);
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
const allowOrigin = (origin?: string) => {
  if (!origin) return false;
  try {
    if (allowedOrigins.includes(origin)) return true;
    // Allow wildmindai.com and all its subdomains
    const originUrl = new URL(origin);
    if (originUrl.hostname === 'www.wildmindai.com' || 
        originUrl.hostname === 'wildmindai.com' ||
        originUrl.hostname.endsWith('.wildmindai.com')) {
      return true;
    }
    if (process.env.FRONTEND_ORIGIN) {
      const allowHost = new URL(process.env.FRONTEND_ORIGIN).hostname;
      const reqHost = originUrl.hostname;
      if (reqHost === allowHost || reqHost.endsWith(`.${allowHost}`)) return true;
    }
  } catch {}
  return false;
};

app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (allowOrigin(origin)) {
    res.header('Access-Control-Allow-Origin', origin as string);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, X-Request-Id, X-Device-Id, X-Device-Name, X-Device-Info, ngrok-skip-browser-warning, Range, Cache-Control, Pragma, Expires'
    );
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(httpParamPollution);
app.use(gzipCompression);
app.use(httpLogger);
if (isProd) {
  app.use(originCheck);
}

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
  } catch (_e) {}
})();

// Initialize Redis connection in background (non-blocking) when configured
(async () => {
  try {
    if (isRedisEnabled()) getRedisClient();
  } catch (_e) {}
})();
