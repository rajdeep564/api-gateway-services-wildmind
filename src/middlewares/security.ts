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

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "img-src": ["'self'", 'data:', 'https:'],
      "connect-src": ["'self'", 'https://api.bfl.ai'],
    }
  },
  referrerPolicy: { policy: 'no-referrer' },
  frameguard: { action: 'deny' },
  hsts: { maxAge: 15552000, includeSubDomains: true, preload: true },
  xssFilter: true
});

export const httpParamPollution = hpp();
export const gzipCompression = compression();

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
  // Use default key generator to avoid IPv6 issues
});


