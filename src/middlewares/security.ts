import helmet from 'helmet';
import compression from 'compression';
import hpp from 'hpp';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

export const requestId = (req: Request, _res: Response, next: NextFunction) => {
  (req as any).requestId = req.headers['x-request-id'] || uuidv4();
  next();
};

const isDev = env.nodeEnv !== 'production';

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "img-src": ["'self'", 'data:', 'https:'],
      "connect-src": [
        "'self'",
        env.bflApiBase || '',
        env.devBackendUrl || '',
        env.apiGatewayUrl || '',
        // Include production API gateway URL derived from production domain
        ...(env.productionDomain ? [env.productionDomain.replace(/^https?:\/\/(www\.)?/, 'https://api.')] : [])
      ].filter(Boolean),
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

  const isProd = env.nodeEnv === 'production';
  // Always include production hosts (even if NODE_ENV isn't set)
  const defaults = [
    env.productionDomain,
    env.productionWwwDomain,
    env.productionStudioDomain
  ].filter(Boolean);
  const devDefaults = !isProd ? [env.devFrontendUrl, env.devCanvasUrl].filter(Boolean) : [];
  // Combine allowedOrigins array with frontendOrigins if provided
  const extra = env.allowedOrigins.length > 0
    ? env.allowedOrigins
    : env.frontendOrigins;
  const all = [...defaults, ...devDefaults, ...extra];
  const allowedHosts = new Set<string>();
  for (const o of all) {
    if (!o) continue;
    try {
      const u = new URL(o);
      allowedHosts.add(u.host);
    } catch { }
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
      // Allow production domain and all its subdomains
      const prodDomain = env.productionDomain ? new URL(env.productionDomain).hostname : 'wildmindai.com';
      const prodWwwDomain = env.productionWwwDomain ? new URL(env.productionWwwDomain).hostname : 'www.wildmindai.com';
      if (originUrl.hostname === prodWwwDomain ||
        originUrl.hostname === prodDomain ||
        originUrl.hostname.endsWith(`.${prodDomain}`)) {
        return next();
      }
    }
  } catch { }

  try {
    if (referer) {
      const refererUrl = new URL(referer as string);
      const rh = refererUrl.host;
      if (allowedHosts.has(rh)) return next();
      // Allow production domain and all its subdomains
      const prodDomain = env.productionDomain ? new URL(env.productionDomain).hostname : (env.productionWwwDomain ? new URL(env.productionWwwDomain).hostname.replace(/^www\./, '') : undefined);
      const prodWwwDomain = env.productionWwwDomain ? new URL(env.productionWwwDomain).hostname : (prodDomain ? `www.${prodDomain}` : undefined);
      if (prodDomain && (refererUrl.hostname === prodWwwDomain ||
        refererUrl.hostname === prodDomain ||
        refererUrl.hostname.endsWith(`.${prodDomain}`))) {
        return next();
      }
    }
  } catch { }

  return res.status(403).json({ status: 'error', message: 'Forbidden origin' });
};


``