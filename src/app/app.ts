import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from '../routes';
import { errorHandler } from '../utils/errorHandler';
import dotenv from 'dotenv';
import { formatApiResponse } from '../utils/formatApiResponse';
import { gzipCompression, httpParamPollution, rateLimiter, requestId, securityHeaders, originCheck } from '../middlewares/security';
import { httpLogger } from '../middlewares/logger';
import { adminDb, admin } from '../config/firebaseAdmin';
import { creditsService } from '../services/creditsService';
dotenv.config();

const app = express();

// Trust proxy settings (safe for rate limiting)
const isProd = process.env.NODE_ENV === 'production';
app.set('trust proxy', isProd ? 1 : false);

// Security and common middlewares (SOC2 oriented)
app.use(requestId);
app.use(securityHeaders);
app.use(rateLimiter);
// CORS for frontend with credentials. Strict in prod, permissive in dev
const defaultAllowed = new Set<string>(
  isProd
    ? ['https://wildmindai.com', 'https://www.wildmindai.com']
    : ['http://localhost:3000', 'http://127.0.0.1:3000']
);
// Support CSV env (e.g., https://your-app.vercel.app,https://xyz.ngrok-free.app)
if (process.env.ALLOWED_ORIGINS) {
  for (const o of String(process.env.ALLOWED_ORIGINS).split(',').map(s => s.trim()).filter(Boolean)) {
    defaultAllowed.add(o);
  }
}
const isAllowedOrigin = (origin?: string): boolean => {
  if (!origin) return true; // non-browser clients
  if (defaultAllowed.has(origin)) return true;
  try {
    const url = new URL(origin);
    if (!isProd) {
      // Allow any *.vercel.app, and ngrok tunnels in non-prod
      if (url.hostname.endsWith('.vercel.app')) return true;
      if (url.hostname.endsWith('.ngrok-free.app') || url.hostname.endsWith('.ngrok.io')) return true;
    }
  } catch {}
  return false;
};
const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin || undefined)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
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
    'Range'
  ],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
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
