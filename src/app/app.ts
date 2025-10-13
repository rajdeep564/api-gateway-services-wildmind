import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from '../routes';
import { errorHandler } from '../utils/errorHandler';
import dotenv from 'dotenv';
import { formatApiResponse } from '../utils/formatApiResponse';
import { gzipCompression, httpParamPollution, requestId, securityHeaders, originCheck } from '../middlewares/security';
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
// CORS for frontend with credentials (dev + prod)
const isProdEnv = process.env.NODE_ENV === 'production';
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  // Common prod hosts for frontend
  ...(isProdEnv ? ['https://www.wildmindai.com', 'https://wildmindai.com'] : []),
  process.env.FRONTEND_ORIGIN || '',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : [])
].filter(Boolean);

const corsOptions: any = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow server-to-server (no Origin header) and health checks
    if (!origin) return callback(null, true);
    try {
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Allow subdomains of the configured prod origin (e.g., preview/app)
      if (process.env.FRONTEND_ORIGIN) {
        const allowHost = new URL(process.env.FRONTEND_ORIGIN).hostname;
        const reqHost = new URL(origin).hostname;
        if (reqHost === allowHost || reqHost.endsWith(`.${allowHost}`)) {
          return callback(null, true);
        }
      }
    } catch {}
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
    'Range'
  ],
  optionsSuccessStatus: 204,
  exposedHeaders: ['Content-Length', 'Content-Range']
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
