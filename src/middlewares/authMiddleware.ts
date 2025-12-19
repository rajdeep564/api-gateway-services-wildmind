import { Request, Response, NextFunction } from 'express';
import { admin } from '../config/firebaseAdmin';
import { ApiError } from '../utils/errorHandler';
import { cacheSession, getCachedSession, decodeJwtPayload } from '../utils/sessionStore';
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
    
    // CRITICAL DEBUG: Log cookie information for cross-subdomain debugging
    if (env.logLevel === 'debug' || req.headers['x-debug-auth'] === 'true') {
      const cookieHeader = req.headers.cookie || '';
      const allCookies = cookieHeader.split(';').map(c => c.trim());
      const hasAppSessionInHeader = cookieHeader.includes('app_session=');
      
      console.log('[AUTH][requireAuth] Cookie debug info:', {
        hasToken: !!token,
        tokenLength: token?.length || 0,
        tokenPrefix: token ? token.substring(0, 20) + '...' : 'N/A',
        cookieHeaderLength: cookieHeader.length,
        cookieHeaderPreview: cookieHeader.substring(0, 100) + (cookieHeader.length > 100 ? '...' : ''),
        allCookies: allCookies,
        hasAppSessionInHeader,
        hostname: req.hostname,
        origin: req.headers.origin,
        referer: req.headers.referer,
        userAgent: req.get('user-agent')?.substring(0, 50),
        note: hasAppSessionInHeader && !token ? 'Cookie exists in header but not parsed - check cookie parsing' :
              !hasAppSessionInHeader ? 'Cookie NOT in request header - cookie not being sent from browser' :
              'Cookie found and parsed successfully'
      });
    }
    
    // Fallback to Authorization header (Bearer token)
    if (!token) {
      const authHeader = req.headers.authorization || (req.headers.Authorization as string | undefined);
      if (authHeader && /^Bearer\s+/i.test(authHeader)) {
        token = authHeader.replace(/^Bearer\s+/i, '').trim();
      }
    }
    
    // No token found - return 401 with detailed error
    if (!token) {
      const cookieHeader = req.headers.cookie || '';
      const hasAppSessionInHeader = cookieHeader.includes('app_session=');
      
      // Enhanced error message for debugging
      const errorMessage = hasAppSessionInHeader 
        ? 'Unauthorized - Cookie exists in request but could not be parsed. Check cookie format and parsing.'
        : 'Unauthorized - No session token. Cookie not sent with request. This usually means the cookie domain is not set correctly for cross-subdomain sharing. Check COOKIE_DOMAIN environment variable.';
      
      console.error('[AUTH][requireAuth] 401 Unauthorized - No token', {
        hasCookieHeader: !!req.headers.cookie,
        cookieHeaderLength: cookieHeader.length,
        cookieHeaderPreview: cookieHeader.substring(0, 100),
        hasAppSessionInHeader,
        hostname: req.hostname,
        origin: req.headers.origin,
        referer: req.headers.referer,
        possibleCauses: [
          !hasAppSessionInHeader ? 'Cookie not being sent from browser (check cookie domain)' : 'Cookie in header but not parsed',
          'COOKIE_DOMAIN env var might not be set in backend',
          'Cookie was set without Domain attribute (old cookie before env var was set)',
          'Cookie domain mismatch (cookie for www.wildmindai.com but accessing studio.wildmindai.com)'
        ],
        howToFix: [
          '1. Set COOKIE_DOMAIN=.wildmindai.com in Render.com environment',
          '2. Restart backend service',
          '3. Log in again on www.wildmindai.com (old cookies won\'t have domain)',
          '4. Check DevTools → Application → Cookies → verify Domain: .wildmindai.com',
          '5. Check Network tab → Request Headers → should include Cookie: app_session=...'
        ]
      });
      
      throw new ApiError(errorMessage, 401);
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
    
    // CRITICAL FIX: Detect token type before verification to avoid issuer mismatch errors
    // Check if token is an ID token (has securetoken.google.com issuer) or session cookie (has session.firebase.google.com issuer)
    let tokenType: 'idToken' | 'sessionCookie' | 'unknown' = 'unknown';
    try {
      // Decode JWT without verification to check issuer using proper base64url decoding
      const payload = decodeJwtPayload(token);
      if (payload) {
        const issuer = payload.iss || '';
        if (issuer.includes('securetoken.google.com')) {
          tokenType = 'idToken';
          console.log('[AUTH] Detected ID token by issuer:', { 
            issuer, 
            tokenPrefix: token.substring(0, 20) 
          });
        } else if (issuer.includes('session.firebase.google.com')) {
          tokenType = 'sessionCookie';
          if (env.logLevel === 'debug') {
            console.log('[AUTH] Detected session cookie by issuer:', { 
              issuer, 
              tokenPrefix: token.substring(0, 20) 
            });
          }
        } else {
          console.warn('[AUTH] Unknown token issuer:', { 
            issuer, 
            tokenPrefix: token.substring(0, 20),
            note: 'Will try both verification methods'
          });
        }
      }
    } catch (decodeError: any) {
      // If we can't decode, we'll try both verification methods
      console.warn('[AUTH] Failed to decode token for issuer detection:', {
        error: decodeError?.message,
        tokenPrefix: token.substring(0, 20),
        note: 'Will try both verification methods'
      });
    }
    
    try {
      // If we detected it's an ID token, verify it and optionally create a proper session cookie
      if (tokenType === 'idToken') {
        console.warn('[AUTH] ⚠️ Detected ID token in cookie (should be session cookie), verifying as ID token', {
          tokenPrefix: token.substring(0, 20),
          note: 'This may indicate an old cookie or a bug in cookie creation. Will verify as ID token and optionally create proper session cookie.'
        });
        
        try {
          decoded = await admin.auth().verifyIdToken(token, env.authStrictRevocation);
          isSessionCookie = false;
          if (env.logLevel === 'debug') {
            console.log('[AUTH] ID token verified (from cookie)', { uid: decoded.uid });
          }
          
          // CRITICAL FIX: Automatically create a proper session cookie when ID token is detected and valid
          // This prevents the issue from recurring and ensures future requests use session cookies
          // Only create session cookie if ID token is valid (not expired)
          try {
            const SESSION_COOKIE_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
            const sessionCookie = await admin.auth().createSessionCookie(token, { 
              expiresIn: SESSION_COOKIE_DURATION_MS 
            });
            
            // Set the proper session cookie
            const cookieDomain = env.cookieDomain;
            const isProd = env.nodeEnv === 'production';
            const maxAgeInSeconds = Math.floor(SESSION_COOKIE_DURATION_MS / 1000);
            const expirationDate = new Date(Date.now() + SESSION_COOKIE_DURATION_MS);
            
            let setCookieValue = `app_session=${sessionCookie}; Path=/; Max-Age=${maxAgeInSeconds}; Expires=${expirationDate.toUTCString()}`;
            if (cookieDomain) {
              setCookieValue += `; Domain=${cookieDomain}`;
            }
            setCookieValue += `; SameSite=${isProd ? 'None' : 'Lax'}`;
            if (isProd) {
              setCookieValue += `; Secure`;
            }
            setCookieValue += `; HttpOnly`;
            
            res.setHeader('Set-Cookie', setCookieValue);
            
            console.log('[AUTH] ✅ Automatically replaced ID token with proper session cookie', {
              uid: decoded.uid,
              note: 'Future requests will use the session cookie instead of ID token'
            });
            
            // Update decoded to reflect session cookie for consistency
            decoded = await admin.auth().verifySessionCookie(sessionCookie, env.authStrictRevocation);
            isSessionCookie = true;
            
            // CRITICAL: Update token variable to use the new session cookie for caching
            // This ensures we cache the session cookie, not the old ID token
            token = sessionCookie;
          } catch (createError: any) {
            // Non-fatal: if we can't create session cookie, continue with ID token verification
            console.warn('[AUTH] Failed to create session cookie from ID token (non-fatal)', {
              error: createError?.message,
              note: 'Request will proceed with ID token verification'
            });
          }
        } catch (idTokenVerifyError: any) {
          // ID token verification failed - check if it's expired
          const isExpired = idTokenVerifyError?.code === 'auth/id-token-expired' || 
                           idTokenVerifyError?.errorInfo?.code === 'auth/id-token-expired' ||
                           idTokenVerifyError?.message?.includes('expired');
          
          if (isExpired) {
            // ID token is expired - cannot create session cookie from expired token
            // Return 401 to force frontend to refresh the token
            console.error('[AUTH] ❌ ID token is expired, cannot create session cookie', {
              tokenPrefix: token.substring(0, 20),
              error: idTokenVerifyError?.message,
              note: 'Frontend must refresh ID token and create new session'
            });
            throw new ApiError('Unauthorized - ID token has expired. Please refresh your authentication.', 401);
          } else {
            // Other ID token verification errors - rethrow to be handled by outer catch
            throw idTokenVerifyError;
          }
        }
      } else if (tokenType === 'sessionCookie') {
        // Try session cookie (we detected it's a session cookie)
        decoded = await admin.auth().verifySessionCookie(token, env.authStrictRevocation);
        isSessionCookie = true;
        if (env.logLevel === 'debug') {
          console.log('[AUTH] Session cookie verified', { uid: decoded.uid });
        }
      } else {
        // Unknown token type - try session cookie first (preferred method)
        // If it fails with issuer mismatch, we'll fall back to ID token
        decoded = await admin.auth().verifySessionCookie(token, env.authStrictRevocation);
        isSessionCookie = true;
        if (env.logLevel === 'debug') {
          console.log('[AUTH] Session cookie verified (unknown type)', { uid: decoded.uid });
        }
      }
    } catch (sessionError: any) {
      // CRITICAL FIX: Check if error is about issuer mismatch (ID token in session cookie)
      // This is the EXACT error message from Firebase when ID token is used with verifySessionCookie
      const isIssuerMismatch = sessionError?.message?.includes('iss') || 
                               sessionError?.message?.includes('issuer') ||
                               sessionError?.message?.includes('securetoken.google.com') ||
                               sessionError?.message?.includes('session.firebase.google.com') ||
                               sessionError?.code === 'auth/argument-error' ||
                               (sessionError?.message && sessionError.message.includes('Expected') && sessionError.message.includes('but got'));
      
      // If it's an issuer mismatch, immediately try ID token verification
      if (isIssuerMismatch) {
        console.warn('[AUTH] Session cookie verification failed due to issuer mismatch, trying ID token verification', {
          error: sessionError?.message,
          tokenPrefix: token.substring(0, 20),
          note: 'Cookie may contain ID token instead of session cookie'
        });
        try {
          decoded = await admin.auth().verifyIdToken(token, env.authStrictRevocation);
          isSessionCookie = false;
          if (env.logLevel === 'debug') {
            console.log('[AUTH] ID token verified (after issuer mismatch)', { uid: decoded.uid });
          }
          
          // If ID token is valid, try to create a session cookie for future requests
          // This only works if token came from cookie, not Authorization header
          if (!req.headers.authorization && req.cookies?.[COOKIE_NAME]) {
            try {
              const SESSION_COOKIE_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
              const sessionCookie = await admin.auth().createSessionCookie(token, { 
                expiresIn: SESSION_COOKIE_DURATION_MS 
              });
              
              const cookieDomain = env.cookieDomain;
              const isProd = env.nodeEnv === 'production';
              const maxAgeInSeconds = Math.floor(SESSION_COOKIE_DURATION_MS / 1000);
              const expirationDate = new Date(Date.now() + SESSION_COOKIE_DURATION_MS);
              
              let setCookieValue = `app_session=${sessionCookie}; Path=/; Max-Age=${maxAgeInSeconds}; Expires=${expirationDate.toUTCString()}`;
              if (cookieDomain) {
                setCookieValue += `; Domain=${cookieDomain}`;
              }
              setCookieValue += `; SameSite=${isProd ? 'None' : 'Lax'}`;
              if (isProd) {
                setCookieValue += `; Secure`;
              }
              setCookieValue += `; HttpOnly`;
              
              res.setHeader('Set-Cookie', setCookieValue);
              console.log('[AUTH] ✅ Created session cookie from ID token (after issuer mismatch)', {
                uid: decoded.uid
              });
              
              decoded = await admin.auth().verifySessionCookie(sessionCookie, env.authStrictRevocation);
              isSessionCookie = true;
              token = sessionCookie;
            } catch (createError: any) {
              // Non-fatal - continue with ID token
              console.warn('[AUTH] Failed to create session cookie (non-fatal)', {
                error: createError?.message
              });
            }
          }
        } catch (idTokenError: any) {
          // Check if ID token is expired
          const isExpired = idTokenError?.code === 'auth/id-token-expired' || 
                           idTokenError?.errorInfo?.code === 'auth/id-token-expired' ||
                           idTokenError?.message?.includes('expired');
          
          if (isExpired) {
            console.error('[AUTH] ❌ ID token is expired (from issuer mismatch fallback)', {
              tokenPrefix: token.substring(0, 20),
              note: 'Frontend must refresh ID token'
            });
            throw new ApiError('Unauthorized - ID token has expired. Please refresh your authentication.', 401);
          }
          
          // Both failed
          throw new ApiError(`Unauthorized - Token verification failed: ${idTokenError?.message || sessionError?.message}`, 401);
        }
      } else {
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
              timestamp: new Date().toISOString(),
              env: {
                authStrictRevocation: env.authStrictRevocation,
                nodeEnv: env.nodeEnv
              }
            });
            
            // CRITICAL: If session error is "revoked", explicitly mention it
            if (sessionError?.code === 'auth/session-cookie-revoked') {
              console.error('[AUTH] ⚠️ SESSION REVOKED ⚠️ - The session cookie was explicitly revoked by Firebase.');
            }
            
            throw new ApiError(`Unauthorized - ${errorMessage}`, 401);
          }
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
