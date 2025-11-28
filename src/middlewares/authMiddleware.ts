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
    // CRITICAL FIX: Check cache expiration before using it
    try {
      const cached = await getCachedSession(token);
      if (cached?.uid) {
        // Check if cached session is still valid (not expired)
        const nowSec = Math.floor(Date.now() / 1000);
        const isExpired = cached.exp && cached.exp < nowSec;
        
        if (!isExpired) {
          if (env.redisDebug) {
            console.log('[AUTH][Redis] HIT', { uid: cached.uid });
          }
          (req as any).uid = cached.uid;
          (req as any).authMethod = 'cached';
          return next();
        } else {
          // Cache says expired, but verify with Firebase to be sure
          // Sometimes cache TTL might be shorter than actual cookie expiration
          if (env.redisDebug) {
            console.log('[AUTH][Redis] Cached session expired, verifying with Firebase', { 
              uid: cached.uid,
              cachedExp: cached.exp,
              nowSec 
            });
          }
        }
      }
      if (env.redisDebug && !cached) {
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
      // CRITICAL FIX: Check if it's a revocation check failure (non-fatal for session cookies)
      // If strict revocation is enabled and token was revoked, we should still allow it if it's not expired
      const isRevocationError = sessionError?.code === 'auth/session-cookie-revoked' || 
                                 sessionError?.errorInfo?.code === 'auth/session-cookie-revoked' ||
                                 sessionError?.message?.includes('revoked');
      
      // If it's just a revocation check failure (not expired), try without strict revocation
      if (isRevocationError && env.authStrictRevocation) {
        try {
          decoded = await admin.auth().verifySessionCookie(token, false);
          isSessionCookie = true;
          if (env.logLevel === 'debug') {
            console.warn('[AUTH] Session cookie verified without strict revocation (revocation check failed)', { 
              uid: decoded.uid,
              error: sessionError?.message 
            });
          }
        } catch (retryError: any) {
          // Still failed, fall through to ID token verification
        }
      }
      
      // If we still don't have decoded, try ID token verification
      if (!decoded) {
        try {
          decoded = await admin.auth().verifyIdToken(token, env.authStrictRevocation);
          isSessionCookie = false;
          if (env.logLevel === 'debug') {
            console.log('[AUTH] ID token verified', { uid: decoded.uid });
          }
        } catch (idTokenError: any) {
          // Both verification methods failed
          const errorMessage = sessionError?.message || idTokenError?.message || 'Token verification failed';
          
          // CRITICAL FIX: Log detailed error info for debugging random logouts
          console.error('[AUTH] Token verification failed - potential logout cause', {
            sessionError: sessionError?.message,
            sessionErrorCode: sessionError?.code,
            idTokenError: idTokenError?.message,
            idTokenErrorCode: idTokenError?.code,
            tokenLength: token?.length,
            tokenPrefix: token?.substring(0, 20),
            hasCookie: !!req.cookies?.[COOKIE_NAME],
            hasAuthHeader: !!req.headers.authorization,
            path: req.path,
            method: req.method,
            timestamp: new Date().toISOString()
          });
          
          throw new ApiError(`Unauthorized - ${errorMessage}`, 401);
        }
      }
    }
    
    // Set user ID and auth method on request object
    (req as any).uid = decoded.uid;
    (req as any).authMethod = isSessionCookie ? 'session' : 'idToken';

    // OPTIMIZATION: Mid-life session refresh (refresh when JWT is > 7 days old)
    // Only check for session cookies, not ID tokens
    // This reduces unnecessary refresh calls while ensuring sessions stay fresh
    if (isSessionCookie && decoded.exp && decoded.iat) {
      const nowSec = Math.floor(Date.now() / 1000); // UTC time
      const expiresInSec = decoded.exp - nowSec; // decoded.exp is already UTC
      const issuedAtSec = decoded.iat; // JWT issued at timestamp
      const ageInSec = nowSec - issuedAtSec; // How old the session is
      const sevenDaysInSec = 7 * 24 * 60 * 60; // 7 days
      
      // Refresh if session is older than 7 days (mid-life refresh)
      // This ensures sessions are refreshed once during their 14-day lifetime
      if (expiresInSec > 0 && ageInSec > sevenDaysInSec) {
        res.setHeader('X-Session-Refresh-Needed', 'true');
        res.setHeader('X-Session-Expires-In', expiresInSec.toString());
        if (env.logLevel === 'debug') {
          console.log('[AUTH] Mid-life session refresh needed', { 
            uid: decoded.uid, 
            ageInDays: Math.floor(ageInSec / (24 * 60 * 60)),
            expiresInDays: Math.floor(expiresInSec / (24 * 60 * 60)),
            nowUTC: new Date().toISOString(),
            expUTC: new Date(decoded.exp * 1000).toISOString()
          });
        }
      }
    }

    // CRITICAL FIX: Always cache session after successful verification
    // This ensures Redis cache is up-to-date even if it was expired or missing
    // This prevents false cache misses that could cause authentication failures
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
        console.log('[AUTH][Redis] SET (after verification)', { 
          uid: decoded.uid, 
          exp,
          expDate: exp ? new Date(exp * 1000).toISOString() : 'N/A',
          issuedAt,
          issuedAtDate: issuedAt ? new Date(issuedAt * 1000).toISOString() : 'N/A'
        });
      }
    } catch (cacheError) {
      // Cache error is non-fatal - log but don't fail the request
      // However, log it as a warning since it could lead to performance issues
      console.warn('[AUTH] Failed to cache session after verification (non-fatal but may impact performance):', {
        error: cacheError,
        uid: decoded?.uid,
        timestamp: new Date().toISOString()
      });
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
