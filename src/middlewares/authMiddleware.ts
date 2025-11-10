import { Request, Response, NextFunction } from 'express';
import { admin } from '../config/firebaseAdmin';
import { ApiError } from '../utils/errorHandler';
import { cacheSession, getCachedSession } from '../utils/sessionStore';
import { env } from '../config/env';

const COOKIE_NAME = 'app_session';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    console.log("cookies",req.cookies);
    let token = req.cookies?.[COOKIE_NAME];
    // Fallback to Authorization: Bearer <token>
    if (!token) {
      const authHeader = req.headers.authorization || req.headers.Authorization as string | undefined;
      if (authHeader && /^Bearer\s+/i.test(authHeader)) {
        token = authHeader.replace(/^Bearer\s+/i, '').trim();
      }
    }
    if (!token) throw new ApiError('Unauthorized - No session token', 401);
    
    // 🔑 LOG TOKEN FOR TESTING
    console.log('\n🔑 AUTH TOKEN (for testing):\n');
    console.log(token);
    console.log('\n');
    // Try Redis cache first to avoid repeated verifies
    const cached = await getCachedSession(token);
    if (cached?.uid) {
      if (env.redisDebug) {
        // eslint-disable-next-line no-console
        console.log('[AUTH][Redis] HIT', { uid: cached.uid });
      }
      (req as any).uid = cached.uid;
      return next();
    }
    if (env.redisDebug) {
      // eslint-disable-next-line no-console
      console.log('[AUTH][Redis] MISS');
    }
    // Prefer verifying as a session cookie; fallback to ID token if needed
    let decoded: any;
    let isSessionCookie = true;
    try {
      // checkRevoked is controlled via env for performance
      decoded = await admin.auth().verifySessionCookie(token, env.authStrictRevocation);
      console.log("decoded(session)", decoded);
    } catch (_e) {
      isSessionCookie = false;
      decoded = await admin.auth().verifyIdToken(token, env.authStrictRevocation);
      console.log("decoded(idToken)", decoded);
    }
    (req as any).uid = decoded.uid;
    // Cache in Redis with TTL derived from token exp
    try {
      const exp = typeof decoded?.exp === 'number' ? decoded.exp : undefined;
      await cacheSession(token, { uid: decoded.uid, exp, issuedAt: decoded?.iat, userAgent: req.get('user-agent') || undefined, ip: req.ip });
      if (env.redisDebug) {
        // eslint-disable-next-line no-console
        console.log('[AUTH][Redis] SET', { uid: decoded.uid, exp });
      }
    } catch {}
    return next();
  } catch (error) {
    if (error instanceof ApiError) {
      return next(error);
    }
    return next(new ApiError('Unauthorized - Invalid token', 401));
  }
}
