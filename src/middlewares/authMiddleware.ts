import { Request, Response, NextFunction } from 'express';
import { admin } from '../config/firebaseAdmin';
import { ApiError } from '../utils/errorHandler';
import { cacheSession, getCachedSession } from '../utils/sessionStore';
import { env } from '../config/env';

const COOKIE_NAME = 'app_session';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    let token = req.cookies?.[COOKIE_NAME];
    // Fallback to Authorization: Bearer <token>
    if (!token) {
      const authHeader = req.headers.authorization || (req.headers.Authorization as string | undefined);
      if (authHeader && /^Bearer\s+/i.test(authHeader)) {
        token = authHeader.replace(/^Bearer\s+/i, '').trim();
      }
    }
    if (!token) throw new ApiError('Unauthorized - No session token', 401);

    // Try Redis cache first to avoid repeated verifies
    const cached = await getCachedSession(token);
    if (cached?.uid) {
      if (env.redisDebug) {
        console.log('[AUTH][Redis] HIT', { uid: cached.uid });
      }
      (req as any).uid = cached.uid;
      return next();
    }
    if (env.redisDebug) {
      console.log('[AUTH][Redis] MISS');
    }

    let decoded: any;
    try {
      decoded = await admin.auth().verifySessionCookie(token, env.authStrictRevocation);
      if (env.logLevel === 'debug') {
        console.log('[AUTH] session decoded', { uid: decoded.uid, isSession: true });
      }
    } catch (_e) {
      decoded = await admin.auth().verifyIdToken(token, env.authStrictRevocation);
      if (env.logLevel === 'debug') {
        console.log('[AUTH] idToken decoded', { uid: decoded.uid, isSession: false });
      }
    }
    (req as any).uid = decoded.uid;

    // Cache session (non-blocking)
    try {
      const exp = typeof decoded?.exp === 'number' ? decoded.exp : undefined;
      await cacheSession(token, { uid: decoded.uid, exp, issuedAt: decoded?.iat, userAgent: req.get('user-agent') || undefined, ip: req.ip });
      if (env.redisDebug) {
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
