import helmet from 'helmet';
import compression from 'compression';
import hpp from 'hpp';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';

export const requestId = (req: Request, _res: Response, next: NextFunction) => {
  (req as any).requestId = req.headers['x-request-id'] || uuidv4();
  next();
};

const isDev = process.env.NODE_ENV !== 'production';

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "img-src": ["'self'", 'data:', 'https:'],
      "connect-src": ["'self'", 'https://api.bfl.ai', 'http://localhost:5000', 'http://127.0.0.1:5000'],
    }
  },
  // Relax COOP/COEP in development to avoid popup warnings and cross-origin issues
  crossOriginOpenerPolicy: isDev ? false : undefined,
  crossOriginEmbedderPolicy: isDev ? false : undefined,
  referrerPolicy: { policy: 'no-referrer' },
  frameguard: { action: 'deny' },
  hsts: { maxAge: 15552000, includeSubDomains: true, preload: true },
});

export const httpParamPollution = hpp();
export const gzipCompression = compression();

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  // Do not rate-limit CORS preflight requests
  skip: (req) => req.method === 'OPTIONS'
});

// Simple Origin/Referer check for state-changing methods (defense-in-depth)
export const originCheck = (req: Request, res: Response, next: NextFunction) => {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const allowedOrigins = new Set<string>(['http://localhost:3000']);
  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;

  if (origin && allowedOrigins.has(origin)) return next();
  if (referer) {
    try {
      const url = new URL(referer);
      if (allowedOrigins.has(`${url.protocol}//${url.host}`)) return next();
    } catch {
      // fall through
    }
  }

  return res.status(403).json({ status: 'error', message: 'Forbidden origin' });
};


