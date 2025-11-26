import { Request, Response, NextFunction } from 'express';
import { admin } from '../config/firebaseAdmin';
import { ApiError } from '../utils/errorHandler';
import { cacheSession, getCachedSession } from '../utils/sessionStore';
import { env } from '../config/env';

const COOKIE_NAME = 'app_session';

/**
 * Middleware to require authentication for protected routes
 * Supports both session cookies and Bearer tokens
 * Uses Redis caching for performance optimization
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // Extract token from cookie (primary method)
    let token = req.cookies?.[COOKIE_NAME];
    
    // Fallback to Authorization header (Bearer token)
    if (!token) {
      const authHeader = req.headers.authorization || (req.headers.Authorization as string | undefined);
      if (authHeader && /^Bearer\s+/i.test(authHeader)) {
        token = authHeader.replace(/^Bearer\s+/i, '').trim();
      }
    }
    
    // No token found - return 401
    if (!token) {
      throw new ApiError('Unauthorized - No session token', 401);
    }

    // Try Redis cache first for performance (avoids Firebase Admin API calls)
    try {
      const cached = await getCachedSession(token);
      if (cached?.uid) {
        if (env.redisDebug) {
          console.log('[AUTH][Redis] HIT', { uid: cached.uid });
        }
        (req as any).uid = cached.uid;
        (req as any).authMethod = 'cached';
        return next();
      }
      if (env.redisDebug) {
        console.log('[AUTH][Redis] MISS');
      }
    } catch (cacheError) {
      // Cache error is non-fatal - continue with token verification
      if (env.logLevel === 'debug') {
        console.warn('[AUTH] Cache lookup failed, falling back to token verification:', cacheError);
      }
    }

    // Verify token with Firebase Admin
    let decoded: any;
    let isSessionCookie = false;
    
    try {
      // Try session cookie first (preferred method)
      decoded = await admin.auth().verifySessionCookie(token, env.authStrictRevocation);
      isSessionCookie = true;
      if (env.logLevel === 'debug') {
        console.log('[AUTH] Session cookie verified', { uid: decoded.uid });
      }
    } catch (sessionError: any) {
      // Fallback to ID token verification
      try {
        decoded = await admin.auth().verifyIdToken(token, env.authStrictRevocation);
        isSessionCookie = false;
        if (env.logLevel === 'debug') {
          console.log('[AUTH] ID token verified', { uid: decoded.uid });
        }
      } catch (idTokenError: any) {
        // Both verification methods failed
        const errorMessage = sessionError?.message || idTokenError?.message || 'Token verification failed';
        if (env.logLevel === 'debug') {
          console.error('[AUTH] Token verification failed', {
            sessionError: sessionError?.message,
            idTokenError: idTokenError?.message,
          });
        }
        throw new ApiError(`Unauthorized - ${errorMessage}`, 401);
      }
    }
    
    // Set user ID and auth method on request object
    (req as any).uid = decoded.uid;
    (req as any).authMethod = isSessionCookie ? 'session' : 'idToken';

    // Check if session needs refresh (expires within 3 days)
    // Only check for session cookies, not ID tokens
    // BUG FIX #16: Use UTC time for expiration calculations to avoid timezone issues
    if (isSessionCookie && decoded.exp) {
      const nowSec = Math.floor(Date.now() / 1000); // UTC time
      const expiresInSec = decoded.exp - nowSec; // decoded.exp is already UTC
      const threeDaysInSec = 3 * 24 * 60 * 60; // 3 days
      
      // Set header to indicate session refresh is needed
      if (expiresInSec > 0 && expiresInSec < threeDaysInSec) {
        res.setHeader('X-Session-Refresh-Needed', 'true');
        res.setHeader('X-Session-Expires-In', expiresInSec.toString());
        if (env.logLevel === 'debug') {
          console.log('[AUTH] Session refresh needed', { 
            uid: decoded.uid, 
            expiresInDays: Math.floor(expiresInSec / (24 * 60 * 60)),
            nowUTC: new Date().toISOString(),
            expUTC: new Date(decoded.exp * 1000).toISOString()
          });
        }
      }
    }

    // Cache session in Redis (non-blocking - don't fail request if caching fails)
    try {
      const exp = typeof decoded?.exp === 'number' ? decoded.exp : undefined;
      const issuedAt = typeof decoded?.iat === 'number' ? decoded.iat : undefined;
      await cacheSession(token, {
        uid: decoded.uid,
        exp,
        issuedAt,
        userAgent: req.get('user-agent') || undefined,
        ip: req.ip,
      });
      if (env.redisDebug) {
        console.log('[AUTH][Redis] SET', { uid: decoded.uid, exp });
      }
    } catch (cacheError) {
      // Cache error is non-fatal - log but don't fail the request
      if (env.logLevel === 'debug') {
        console.warn('[AUTH] Failed to cache session (non-fatal):', cacheError);
      }
    }

    return next();
  } catch (error) {
    // Handle ApiError instances
    if (error instanceof ApiError) {
      return next(error);
    }
    
    // Handle unexpected errors
    console.error('[AUTH][requireAuth] Unexpected error:', error);
    return next(new ApiError('Unauthorized - Authentication failed', 401));
  }
}
