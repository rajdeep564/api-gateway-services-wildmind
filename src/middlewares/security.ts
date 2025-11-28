import helmet from 'helmet';
import compression from 'compression';
import hpp from 'hpp';
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
      "connect-src": [
        "'self'",
        'https://api.bfl.ai',
        'http://localhost:5001', 'http://127.0.0.1:5001',
        'https://api-gateway-services-wildmind.onrender.com',
        'https://api-gateway-services-wildmind.vercel.app',
        'https://api.wildmindai.com'
      ],
    }
  },
  // Disable COOP/COEP to avoid auth popup issues across domains
  // Set to 'unsafe-none' to explicitly allow cross-origin window access (needed for Firebase auth popups)
  crossOriginOpenerPolicy: { policy: 'unsafe-none' },
  crossOriginEmbedderPolicy: false,
  // Critical: Allow other origins (e.g., Next.js localhost:3000) to display images/videos/audio
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  frameguard: { action: 'deny' },
  hsts: { maxAge: 15552000, includeSubDomains: true, preload: true },
});

export const httpParamPollution = hpp();
export const gzipCompression = compression();

// Simple Origin/Referer check for state-changing methods (defense-in-depth)
export const originCheck = (req: Request, res: Response, next: NextFunction) => {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const path = req.path || req.url;
  // Allow auth flows (OAuth callbacks may have no/foreign origin)
  if (path.startsWith('/api/auth/')) return next();

  const isProd = process.env.NODE_ENV === 'production';
  // Always include production hosts (even if NODE_ENV isn't set)
  const defaults = [
    'https://wildmindai.com', 
    'https://www.wildmindai.com',
    'https://studio.wildmindai.com'
  ];
  const devDefaults = !isProd ? ['http://localhost:3000', 'http://localhost:3001'] : [];
  const extra = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const all = [...defaults, ...devDefaults, ...extra];
  const allowedHosts = new Set<string>();
  for (const o of all) {
    try {
      const u = new URL(o);
      allowedHosts.add(u.host);
    } catch {}
  }

  const origin = (req.headers.origin as string | undefined) || undefined;
  const referer = (req.headers.referer as string | undefined) || undefined;

  // Allow if no Origin/Referer (server-to-server, OAuth redirects)
  if (!origin && !referer) return next();

  try {
    if (origin) {
      const originUrl = new URL(origin as string);
      const oh = originUrl.host;
      if (allowedHosts.has(oh)) return next();
      // Allow wildmindai.com and all its subdomains
      if (originUrl.hostname === 'www.wildmindai.com' || 
          originUrl.hostname === 'wildmindai.com' ||
          originUrl.hostname.endsWith('.wildmindai.com')) {
        return next();
      }
    }
  } catch {}

  try {
    if (referer) {
      const refererUrl = new URL(referer as string);
      const rh = refererUrl.host;
      if (allowedHosts.has(rh)) return next();
      // Allow wildmindai.com and all its subdomains
      if (refererUrl.hostname === 'www.wildmindai.com' || 
          refererUrl.hostname === 'wildmindai.com' ||
          refererUrl.hostname.endsWith('.wildmindai.com')) {
        return next();
      }
    }
  } catch {}

  return res.status(403).json({ status: 'error', message: 'Forbidden origin' });
};


``