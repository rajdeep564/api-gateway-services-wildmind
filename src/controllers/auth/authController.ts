import { Request, Response, NextFunction } from "express";
import { authService } from "../../services/auth/authService";
import { creditsService } from "../../services/creditsService";
import { authRepository } from "../../repository/auth/authRepository";
import { formatApiResponse } from "../../utils/formatApiResponse";
import { ApiError } from "../../utils/errorHandler";
import { extractDeviceInfo } from "../../utils/deviceInfo";
import { admin } from "../../config/firebaseAdmin";
import { env } from "../../config/env";
import "../../types/http";
import { cacheSession, deleteCachedSession, decodeJwtPayload, getCachedSession, invalidateAllUserSessions } from "../../utils/sessionStore";
import { isRedisEnabled } from "../../config/redisClient";

// Module-level log to confirm file is loaded
console.log('[AUTH][authController] Module loaded at', new Date().toISOString());

async function checkUsername(req: Request, res: Response, next: NextFunction) {
  try {
    const username = String(req.query.username || "");
    const result = await authService.checkUsernameAvailability(username);
    res.json(formatApiResponse("success", "Checked", result));
  } catch (error) {
    next(error);
  }
}

async function createSession(req: Request, res: Response, next: NextFunction) {
  try {
    console.log('[AUTH][createSession] ========== START ==========');
    console.log('[AUTH][createSession] Function called', {
      hasIdToken: !!req.body?.idToken,
      idTokenLength: req.body?.idToken?.length || 0,
      idTokenPrefix: req.body?.idToken?.substring(0, 20) || 'N/A',
      origin: req.headers.origin,
      hostname: req.hostname,
      method: req.method,
      url: req.url,
      timestamp: new Date().toISOString()
    });
    
    const { idToken } = req.body;
    
    if (!idToken) {
      console.error('[AUTH][createSession] ERROR: No idToken provided in request body');
      console.log('[AUTH][createSession] Request body keys:', Object.keys(req.body || {}));
      throw new ApiError('Missing idToken in request body', 400);
    }
    
    console.log('[AUTH][createSession] idToken received:', {
      length: idToken.length,
      prefix: idToken.substring(0, 30),
      suffix: idToken.substring(idToken.length - 20),
      isString: typeof idToken === 'string'
    });
    
    console.log('[AUTH][createSession] Creating session with authService...');
    
    let user;
    try {
      user = await authService.createSession(idToken);
      console.log('[AUTH][createSession] Session created successfully, user:', { 
        uid: user?.uid, 
        username: user?.username,
        email: user?.email 
      });
    } catch (authServiceError: any) {
      console.error('[AUTH][createSession] ERROR in authService.createSession:', {
        message: authServiceError?.message,
        code: authServiceError?.code,
        errorCode: authServiceError?.errorCode,
        stack: authServiceError?.stack,
        name: authServiceError?.name
      });
      throw authServiceError;
    }

    // CRITICAL FIX: Create session cookie FIRST before revoking tokens
    // Revoking refresh tokens invalidates the ID token, so we must create the cookie first
    console.log('[AUTH][createSession] About to call setSessionCookie...');
    let sessionCookie;
    try {
      sessionCookie = await setSessionCookie(req, res, idToken);
      console.log('[AUTH][createSession] setSessionCookie completed successfully, cookie length:', sessionCookie?.length || 0);
    } catch (cookieError: any) {
      console.error('[AUTH][createSession] ERROR in setSessionCookie:', {
        message: cookieError?.message,
        code: cookieError?.code,
        errorCode: cookieError?.errorCode,
        statusCode: cookieError?.statusCode,
        stack: cookieError?.stack,
        name: cookieError?.name,
        idTokenLength: idToken?.length,
        idTokenPrefix: idToken?.substring(0, 30)
      });
      throw cookieError;
    }

    // BUG FIX #1: Invalidate all existing sessions for this user AFTER creating new session cookie
    // This prevents multiple active sessions across devices
    // BUG FIX #10: Also revoke old Firebase tokens to sync auth state
    // NOTE: We do this AFTER creating the session cookie because revoking tokens invalidates the ID token
    if (user?.uid) {
      try {
        // Delete old session cookie from Redis if present
        const oldToken = req.cookies?.['app_session'];
        if (oldToken && oldToken !== sessionCookie) {
          await deleteCachedSession(oldToken);
        }
        // Invalidate all other sessions for this user (but NEVER the one we just created)
        // CRITICAL FIX: Pass current session token to ensure it's never invalidated
        // BUG FIX #13: Keep newest session if under limit, otherwise remove oldest
        await invalidateAllUserSessions(user.uid, true, sessionCookie);
        
        if (env.revokeFirebaseTokens) {
          // BUG FIX #10: Revoke all refresh tokens for this user to force re-authentication on other devices
          // This ensures Firebase auth state is synced across devices
          // NOTE: This invalidates the ID token, but we've already created the session cookie above
          try {
            await admin.auth().revokeRefreshTokens(user.uid);
            console.log('[AUTH][createSession] Revoked Firebase refresh tokens for user', { uid: user.uid });
          } catch (revokeError) {
            console.warn('[AUTH][createSession] Failed to revoke refresh tokens (non-fatal):', revokeError);
          }
        } else {
          console.log('[AUTH][createSession] Skipping Firebase refresh token revocation (disabled via env). REVOKE_FIREBASE_TOKENS=', env.revokeFirebaseTokens);
        }
        
        console.log('[AUTH][createSession] Invalidated old sessions for user', { uid: user.uid });
      } catch (error) {
        console.warn('[AUTH][createSession] Failed to invalidate old sessions (non-fatal):', error);
      }
    }
    // Cache session in Redis for quick lookups
    try {
      const payload: any = decodeJwtPayload(sessionCookie) || {};
      const exp = typeof payload?.exp === 'number' ? payload.exp : undefined;
      const uid = user?.uid;
      if (uid) {
        await cacheSession(sessionCookie, { uid, exp, issuedAt: payload?.iat });
        // Lazy import to avoid cycles
        const { env } = await import('../../config/env');
        if (env.redisDebug) {
          // eslint-disable-next-line no-console
          console.log('[AUTH][Redis] SET (createSession)', { uid, exp });
        }
      }
    } catch {}

    // Initialize credits for this user (FREE plan on first use)
    try {
      console.log('[CREDITS][createSession] Init start', { uid: (user as any)?.uid });
      const init = await creditsService.ensureUserInit(user.uid as any);
      console.log('[CREDITS][createSession] Init done', init);
    } catch (e: any) {
      console.error('[CREDITS][createSession] Init error', { uid: (user as any)?.uid, err: e?.message });
    }

    console.log('[AUTH][createSession] ========== SUCCESS ==========');
    res.json(
      formatApiResponse("success", "Session created successfully", { user })
    );
  } catch (error: any) {
    console.error('[AUTH][createSession] ========== ERROR ==========');
    console.error('[AUTH][createSession] Error details:', {
      message: error?.message,
      code: error?.code,
      errorCode: error?.errorCode,
      statusCode: error?.statusCode,
      name: error?.name,
      stack: error?.stack,
      error: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });
    next(error);
  }
}

async function getCurrentUser(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid as string;
    console.log('[AuthController]/me request', {
      uid,
      cookiesPresent: Object.keys(req.cookies || {}),
      origin: req.headers.origin,
      host: req.headers.host,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    let user = await authService.getCurrentUser(uid);

    // Capture optional device headers from client
    const deviceId = req.get("x-device-id") || undefined;
    const deviceName = req.get("x-device-name") || undefined;
    const deviceInfoHeader = req.get("x-device-info");
    let deviceInfoHeaderParsed: any = undefined;
    if (deviceInfoHeader) {
      try {
        deviceInfoHeaderParsed = JSON.parse(deviceInfoHeader);
      } catch (_e) {
        deviceInfoHeaderParsed = deviceInfoHeader;
      }
    }

    // Parse baseline device info from User-Agent/IP for observability
    const parsedDevice = extractDeviceInfo(req);
    console.log("[ME] Device headers:", {
      deviceId,
      deviceName,
      deviceInfoHeaderParsed,
    });
    console.log("[ME] Parsed device from UA:", parsedDevice);

    // Backfill deviceInfo on the user if missing
    const needsBackfill = !user.deviceInfo || !user.deviceInfo.browser;
    if (needsBackfill) {
      try {
        user = await authService.updateUser(uid, {
          deviceInfo: parsedDevice.deviceInfo,
          lastLoginIP: parsedDevice.ip,
          userAgent: parsedDevice.userAgent,
        });
      } catch (_e) {
        // ignore backfill errors
      }
    }

    // Derive public-generation policy flags from planCode (computed, not persisted)
    // Only PLAN_C and PLAN_D can toggle public/private
    // FREE, PLAN_A, PLAN_B must have all generations public
    try {
      const planCode = String((user as any)?.planCode || 'FREE').toUpperCase();
      const canToggle = planCode === 'PLAN_C' || planCode === 'PLAN_D';
      (user as any).canTogglePublicGenerations = canToggle;
      (user as any).forcePublicGenerations = !canToggle;
    } catch {}

    res.json(
      formatApiResponse("success", "User retrieved successfully", { user })
    );
    console.log('[AuthController]/me success', { uid, username: user?.username, plan: (user as any)?.planCode });
  } catch (error) {
    console.error('[AuthController]/me error', { uid: req.uid, cookies: Object.keys(req.cookies || {}) }, error);
    next(error);
  }
}

async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid as string;
    const updates = req.body;
    const user = await authService.updateUser(uid, updates);

    res.json(
      formatApiResponse("success", "User updated successfully", { user })
    );
  } catch (error) {
    next(error);
  }
}

async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    // Remove from Redis cache if present
    try {
      const token = (req.cookies as any)?.['app_session'];
      if (token) {
        await deleteCachedSession(token);
        const { env } = await import('../../config/env');
        if (env.redisDebug) {
          // eslint-disable-next-line no-console
          console.log('[AUTH][Redis] DEL (logout)', { tokenHash: token.substring(0, 20) + '...' });
        }
      }
    } catch (e) {
      console.warn('[AUTH][logout] Failed to delete cached session:', e);
      // Non-fatal - continue with cookie clearing
    }
    
    // Clear session cookie (handles all variants)
    clearSessionCookie(res);
    
    // Log successful logout
    console.log('[AUTH][logout] Logout successful', {
      hasToken: !!(req.cookies as any)?.['app_session'],
      origin: req.headers.origin,
      userAgent: req.headers['user-agent']?.substring(0, 50),
    });
    
    res.json(formatApiResponse("success", "Logged out successfully", {}));
  } catch (error) {
    console.error('[AUTH][logout] Logout error:', error);
    // Even on error, try to clear cookies
    try {
      clearSessionCookie(res);
    } catch {}
    next(error);
  }
}

async function startEmailOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = req.body;
    console.log(`[CONTROLLER] Starting OTP for email: ${email}`);
    const result = await authService.startEmailOtp(email);
    console.log(`[CONTROLLER] OTP start result:`, result);
    res.json(formatApiResponse("success", "OTP sent", result));
  } catch (error) {
    console.log(`[CONTROLLER] OTP start error:`, error);
    next(error);
  }
}

async function verifyEmailOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, code, password } = req.body;
    console.log(
      `[CONTROLLER] Verifying OTP - email: ${email}, code: ${code}, hasPassword: ${!!password}`
    );

    const ok = await authRepository.verifyAndConsumeOtp(email, code);
    if (!ok) {
      console.log(`[CONTROLLER] OTP verification failed for ${email}`);
      throw new ApiError("Invalid or expired OTP", 400);
    }

    console.log(
      `[CONTROLLER] OTP verified successfully, creating Firebase user and Firestore user...`
    );
    const deviceInfo = extractDeviceInfo(req);
    const result = await authService.verifyEmailOtpAndCreateUser(
      email,
      undefined,
      password,
      deviceInfo
    );
    console.log(`[CONTROLLER] User created and ID token generated`);

    // OPTIMIZATION: OTP verification only creates user - NO session cookie here
    // Frontend must exchange custom token for ID token, then call /session endpoint
    // Only invalidate sessions if user already existed (account recovery scenario)
    if (result.user?.uid) {
      // Check if this is account recovery (user existed but password was reset)
      // Only then invalidate old sessions for security
      try {
        const existingUser = await admin.auth().getUser(result.user.uid);
        if (existingUser && password) {
          // Password was set/reset - invalidate old sessions for security
          // CRITICAL FIX: Don't pass currentToken here since we're creating a new session
          // The new session will be created after this, so we want to keep it
          // But we need to get the session cookie from the response to protect it
          // For now, just invalidate old ones - the new session will be created separately
          await invalidateAllUserSessions(result.user.uid, true);
          console.log('[AUTH][verifyEmailOtp] Invalidated old sessions (password reset scenario)', { uid: result.user.uid });
        }
      } catch (error) {
        console.warn('[AUTH][verifyEmailOtp] Failed to check/invalidate sessions (non-fatal):', error);
      }
    }

    // Initialize credits for the new user
    try {
      console.log('[CREDITS][verifyEmailOtp] Init start', { uid: (result.user as any)?.uid });
      const init = await creditsService.ensureUserInit(result.user.uid as any);
      console.log('[CREDITS][verifyEmailOtp] Init done', init);
    } catch (e: any) {
      console.error('[CREDITS][verifyEmailOtp] Init error', { uid: (result.user as any)?.uid, err: e?.message });
    }

    // Return user data and Firebase custom token
    res.json(
      formatApiResponse("success", "OTP verified and user created", {
        user: result.user,
        customToken: result.idToken,
      })
    );
  } catch (error) {
    console.log(`[CONTROLLER] OTP verify error:`, error);
    next(error);
  }
}

async function setEmailUsername(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { username, email } = req.body;
    const deviceInfo = extractDeviceInfo(req);

    console.log(
      `[CONTROLLER] Setting username: ${username} for email: ${email}`
    );
    console.log(`[CONTROLLER] Device info:`, deviceInfo);

    const user = await authService.setUsernameOnly(username, deviceInfo, email);
    console.log(`[CONTROLLER] Username set successfully:`, user);
    res.json(formatApiResponse("success", "Username set", { user }));
  } catch (error) {
    console.log(`[CONTROLLER] Set username error:`, error);
    next(error);
  }
}

async function resolveEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.query.id || "");
    if (!id) throw new ApiError("Missing id", 400);
    const email = await authService.resolveEmailForLogin(id);
    if (!email) throw new ApiError("Account not found", 404);
    res.json(formatApiResponse("success", "Resolved", { email }));
  } catch (error) {
    next(error);
  }
}

async function setSessionCookie(req: Request, res: Response, idToken: string) {
  // Log function entry immediately
  console.log('[AUTH][setSessionCookie] ========== START ==========');
  console.log('[AUTH][setSessionCookie] Function called', {
    hasIdToken: !!idToken,
    idTokenLength: idToken?.length || 0,
    idTokenPrefix: idToken?.substring(0, 30) || 'N/A',
    hostname: req.hostname,
    origin: req.headers.origin,
    timestamp: new Date().toISOString()
  });
  
  const isProd = env.nodeEnv === "production";
  const cookieDomain = env.cookieDomain; // e.g., .wildmindai.com when API runs on api.wildmindai.com
  
  // BUG FIX #11: Check ID token expiration first to prevent mismatch
  let decodedToken: any;
  console.log('[AUTH][setSessionCookie] Verifying ID token with Firebase Admin...');
  try {
    decodedToken = await admin.auth().verifyIdToken(idToken, true);
    console.log('[AUTH][setSessionCookie] ID token verified successfully:', {
      uid: decodedToken?.uid,
      email: decodedToken?.email,
      exp: decodedToken?.exp,
      expDate: decodedToken?.exp ? new Date(decodedToken.exp * 1000).toISOString() : 'N/A',
      iat: decodedToken?.iat,
      iatDate: decodedToken?.iat ? new Date(decodedToken.iat * 1000).toISOString() : 'N/A',
      auth_time: decodedToken?.auth_time,
      auth_timeDate: decodedToken?.auth_time ? new Date(decodedToken.auth_time * 1000).toISOString() : 'N/A'
    });
  } catch (verifyError: any) {
    console.error('[AUTH][setSessionCookie] ERROR verifying ID token:', {
      message: verifyError?.message,
      code: verifyError?.code,
      errorCode: verifyError?.errorCode,
      errorInfo: verifyError?.errorInfo,
      stack: verifyError?.stack,
      name: verifyError?.name,
      idTokenLength: idToken?.length,
      idTokenPrefix: idToken?.substring(0, 30)
    });
    
    // Check if it's a TOKEN_EXPIRED error specifically
    if (verifyError?.code === 'auth/id-token-expired' || 
        verifyError?.errorInfo?.code === 'auth/id-token-expired' ||
        verifyError?.message?.includes('TOKEN_EXPIRED') ||
        verifyError?.message?.includes('expired')) {
      console.error('[AUTH][setSessionCookie] TOKEN_EXPIRED detected!', {
        currentTime: new Date().toISOString(),
        currentTimestamp: Date.now(),
        errorDetails: verifyError
      });
    }
    
    throw new ApiError(`Invalid ID token: ${verifyError?.message || 'Token verification failed'}`, 401);
  }
  
  // CRITICAL FIX: Always use a FIXED 14-day expiration for session cookies
  // NEVER derive expiresIn from the ID token expiration time
  // ID tokens expire in ~60 minutes, but session cookies should last 14 days
  // This ensures the cookie persists regardless of when the ID token was issued
  const SESSION_COOKIE_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds
  const expiresIn = SESSION_COOKIE_DURATION_MS; // ALWAYS use fixed 14 days
  
  // Log ID token expiration for debugging (but don't use it for cookie expiration)
  const idTokenExp = decodedToken.exp * 1000; // Convert to milliseconds
  const now = Date.now();
  const idTokenExpiresIn = Math.max(0, idTokenExp - now);
  
  console.log('[AUTH][setSessionCookie] Session cookie expiration (FIXED 14 DAYS):', {
    expiresIn,
    expiresInMs: expiresIn,
    expiresInSeconds: Math.floor(expiresIn / 1000),
    expiresInDays: Math.floor(expiresIn / (1000 * 60 * 60 * 24)),
    expiresInHours: Math.floor(expiresIn / (1000 * 60 * 60)),
    expirationDate: new Date(Date.now() + expiresIn).toISOString(),
    // ID token info (for debugging only - NOT used for cookie expiration)
    idTokenExp,
    idTokenExpDate: new Date(idTokenExp).toISOString(),
    idTokenExpiresIn,
    idTokenExpiresInHours: Math.floor(idTokenExpiresIn / (1000 * 60 * 60)),
    idTokenExpiresInMinutes: Math.floor(idTokenExpiresIn / (1000 * 60)),
    now: new Date(now).toISOString(),
    note: 'Session cookie uses FIXED 14 days, independent of ID token expiration'
  });
  
  // Validate that ID token is still valid (must have at least 1 minute remaining)
  // This ensures we can create a session cookie before the ID token expires
  // Note: We use FIXED 14 days for session cookie, but ID token must still be valid
  const minIdTokenTimeRemaining = 1000 * 60; // 1 minute minimum
  if (idTokenExpiresIn < minIdTokenTimeRemaining) {
    console.error('[AUTH][setSessionCookie] ERROR: ID token expires too soon to create session cookie!', {
      idTokenExpiresIn,
      idTokenExpiresInSeconds: Math.floor(idTokenExpiresIn / 1000),
      idTokenExpiresInMinutes: Math.floor(idTokenExpiresIn / (1000 * 60)),
      minIdTokenTimeRemaining,
      minIdTokenTimeRemainingMinutes: 1,
      idTokenExp,
      idTokenExpDate: new Date(idTokenExp).toISOString(),
      now,
      nowDate: new Date(now).toISOString(),
      note: 'Session cookie will use FIXED 14 days, but ID token must be valid to create it'
    });
    throw new ApiError('ID token expires too soon. Please refresh and try again.', 401);
  }
  
  // Check if token is already expired
  if (idTokenExp < now) {
    console.error('[AUTH][setSessionCookie] ERROR: ID token is already expired!', {
      idTokenExp,
      idTokenExpDate: new Date(idTokenExp).toISOString(),
      now,
      nowDate: new Date(now).toISOString(),
      expiredBy: now - idTokenExp,
      expiredByMinutes: Math.floor((now - idTokenExp) / (1000 * 60))
    });
    throw new ApiError('ID token has expired. Please refresh and try again.', 401);
  }
  
  // BUG FIX #4: Mobile cookie compatibility - SameSite=None requires Secure=true
  // BUG FIX #22: Android WebView detection
  const userAgent = req.get('user-agent') || '';
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isWebView = /wv|WebView/i.test(userAgent); // Android WebView detection
  const forwardedProtoHeader = (req.headers['x-forwarded-proto'] || '').toString();
  const forwardedProto = forwardedProtoHeader.split(',')[0]?.trim().toLowerCase();
  const isHttpsRequest = (req.secure === true) || forwardedProto === 'https';
  const reqHost = (req.hostname || '').toLowerCase();
  const isLocalhostHost = reqHost === 'localhost' || reqHost === '127.0.0.1' || reqHost === '::1' || reqHost === '::ffff:127.0.0.1';
  const shouldUseSecureCookie =
    isProd ||
    isHttpsRequest ||
    (!isLocalhostHost && (isMobile || isWebView));
  
  console.log('[AUTH][setSessionCookie] Creating session cookie with FIXED 14-day expiration:', {
    isProd,
    cookieDomain: cookieDomain || '(not set in env)',
    sessionCookieExpiresIn: expiresIn,
    sessionCookieExpiresInMs: expiresIn,
    sessionCookieExpiresInSeconds: Math.floor(expiresIn / 1000),
    sessionCookieExpiresInDays: 14,
    sessionCookieExpiresInHours: 336,
    expirationDate: new Date(Date.now() + expiresIn).toISOString(),
    // ID token info (for reference only)
    idTokenExpiresIn,
    idTokenExpiresInHours: Math.floor(idTokenExpiresIn / (1000 * 60 * 60)),
    idTokenExpiresInMinutes: Math.floor(idTokenExpiresIn / (1000 * 60)),
    note: 'Session cookie expiration is FIXED at 14 days, independent of ID token expiration'
  });
  
  let sessionCookie: string;
  try {
    console.log('[AUTH][setSessionCookie] Calling admin.auth().createSessionCookie...', {
      expiresIn,
      expiresInMs: expiresIn,
      expiresInSeconds: Math.floor(expiresIn / 1000),
      expiresInDays: Math.floor(expiresIn / (1000 * 60 * 60 * 24)),
      expiresInHours: Math.floor(expiresIn / (1000 * 60 * 60))
    });
    sessionCookie = await admin
      .auth()
      .createSessionCookie(idToken, { expiresIn });
    
    // Decode the session cookie to verify its expiration
    let decodedSessionCookie: any = null;
    try {
      const { decodeJwtPayload } = await import('../../utils/sessionStore');
      decodedSessionCookie = decodeJwtPayload(sessionCookie);
      if (decodedSessionCookie?.exp) {
        const sessionExpDate = new Date(decodedSessionCookie.exp * 1000);
        const now = new Date();
        const sessionExpiresIn = decodedSessionCookie.exp * 1000 - Date.now();
        console.log('[AUTH][setSessionCookie] Session cookie JWT expiration:', {
          exp: decodedSessionCookie.exp,
          expDate: sessionExpDate.toISOString(),
          now: now.toISOString(),
          expiresInMs: sessionExpiresIn,
          expiresInDays: Math.floor(sessionExpiresIn / (1000 * 60 * 60 * 24)),
          expiresInHours: Math.floor(sessionExpiresIn / (1000 * 60 * 60)),
          requestedDays: Math.floor(expiresIn / (1000 * 60 * 60 * 24))
        });
        
        // Warn if Firebase limited the expiration
        const requestedDays = Math.floor(expiresIn / (1000 * 60 * 60 * 24));
        const actualDays = Math.floor(sessionExpiresIn / (1000 * 60 * 60 * 24));
        if (actualDays < requestedDays) {
          console.warn('[AUTH][setSessionCookie] WARNING: Firebase limited session cookie expiration!', {
            requestedDays,
            actualDays,
            difference: requestedDays - actualDays
          });
        }
      }
    } catch (decodeError) {
      console.warn('[AUTH][setSessionCookie] Could not decode session cookie for verification:', decodeError);
    }
    
    console.log('[AUTH][setSessionCookie] Session cookie created successfully', {
      cookieLength: sessionCookie?.length || 0,
      hasCookie: !!sessionCookie,
      cookiePrefix: sessionCookie?.substring(0, 30) || 'N/A'
    });
  } catch (createError: any) {
    console.error('[AUTH][setSessionCookie] ERROR creating session cookie:', {
      message: createError?.message,
      code: createError?.code,
      errorCode: createError?.errorCode,
      errorInfo: createError?.errorInfo,
      stack: createError?.stack,
      name: createError?.name,
      idTokenLength: idToken?.length,
      idTokenPrefix: idToken?.substring(0, 30),
      expiresIn,
      expiresInSeconds: Math.floor(expiresIn / 1000)
    });

  
    
    // Check if it's a TOKEN_EXPIRED error
    if (createError?.code === 'auth/id-token-expired' || 
        createError?.errorInfo?.code === 'auth/id-token-expired' ||
        createError?.message?.includes('TOKEN_EXPIRED') ||
        createError?.message?.includes('expired')) {
      console.error('[AUTH][setSessionCookie] TOKEN_EXPIRED in createSessionCookie!', {
        currentTime: new Date().toISOString(),
        currentTimestamp: Date.now(),
        errorDetails: createError
      });
    }
    
    throw new ApiError(`Failed to create session cookie: ${createError?.message || 'Unknown error'}`, 500);
  }
  
  // In production, always use the cookie domain if set (for cross-subdomain sharing)
  // In development, only use domain if it matches the current host
  const host = reqHost;
  const origin = req.headers.origin || '';
  const dom = (cookieDomain || '').toLowerCase();
  let shouldSetDomain = false;
  
  // Check if we're in a production-like environment:
  // 1. NODE_ENV === 'production', OR
  // 2. Origin is a production domain subdomain, OR
  // 3. Host matches the cookie domain
  const prodDomainHost = env.productionDomain ? new URL(env.productionDomain).hostname : (env.productionWwwDomain ? new URL(env.productionWwwDomain).hostname.replace(/^www\./, '') : undefined);
  const studioDomainHost = env.productionStudioDomain ? new URL(env.productionStudioDomain).hostname : undefined;
  const isProductionLike = isProd || 
    (origin && prodDomainHost && (origin.includes(prodDomainHost) || (studioDomainHost && origin.includes(studioDomainHost)))) ||
    (host && prodDomainHost && (host.includes(prodDomainHost) || (studioDomainHost && host.includes(studioDomainHost))));
  
  // Always set domain cookie if COOKIE_DOMAIN is configured (for cross-subdomain sharing)
  // This works in both production and when NODE_ENV isn't set (Render.com production)
  if (cookieDomain) {
    if (isProductionLike) {
      // Production: always use domain for cross-subdomain cookie sharing
      shouldSetDomain = true;
    } else {
      // Development: only use domain if it matches the host (localhost won't match .wildmindai.com)
      const domainMatches = !!(dom && (host === dom.replace(/^\./, '') || host.endsWith(dom)));
      shouldSetDomain = domainMatches;
    }
  } else {
    // CRITICAL WARNING: COOKIE_DOMAIN is not set - cookies will NOT share across subdomains!
    if (isProductionLike) {
      console.error('[AUTH][setSessionCookie] ⚠️⚠️⚠️ CRITICAL: COOKIE_DOMAIN is NOT SET! ⚠️⚠️⚠️');
      console.error('[AUTH][setSessionCookie] Cookies will NOT be shared across subdomains (www.wildmindai.com <-> studio.wildmindai.com)');
      console.error('[AUTH][setSessionCookie] To fix: Set COOKIE_DOMAIN=.wildmindai.com in Render.com environment variables');
      console.error('[AUTH][setSessionCookie] Then restart the backend service and have users log in again');
    }
  }
  
  // CRITICAL: Log domain setting decision for debugging cross-subdomain issues
  console.log('[AUTH][setSessionCookie] Domain setting decision:', {
    cookieDomain: cookieDomain || '(NOT SET - COOKIES WILL NOT SHARE ACROSS SUBDOMAINS!)',
    isProd,
    isProductionLike,
    host,
    origin,
    shouldSetDomain,
    willSetDomain: shouldSetDomain ? cookieDomain : '(NOT SETTING - COOKIES WON\'T SHARE!)',
    warning: !cookieDomain ? '⚠️⚠️⚠️ COOKIE_DOMAIN env var is NOT SET! Set it to ".wildmindai.com" in Render.com ⚠️⚠️⚠️' : 
             !shouldSetDomain ? '⚠️ Domain will NOT be set - cookies won\'t share across subdomains' :
             '✅ Domain will be set - cookies will share across subdomains'
  });

  // Determine sameSite: use "none" for cross-subdomain cookies in production-like environments
  // This allows cookies to work between www.wildmindai.com and studio.wildmindai.com
  const useSameSiteNone = isProductionLike && !isWebView && shouldUseSecureCookie;
  
  // Calculate expiration date (14 days from now) - FIXED value, not derived from ID token
  const expirationDate = new Date(Date.now() + expiresIn);
  
  // CRITICAL: maxAge must be in SECONDS (not milliseconds)
  // expiresIn is in milliseconds (14 days = 1,209,600,000 ms)
  // maxAge needs to be in seconds (14 days = 1,209,600 seconds)
  const maxAgeInSeconds = Math.floor(expiresIn / 1000); // Convert milliseconds to seconds
  
  const cookieOptions = {
    httpOnly: true,
    // BUG FIX #4: Cookies must be Secure when SameSite=None per Chrome requirements
    // BUG FIX #22: WebView requires Secure cookies
    // Updated: avoid forcing Secure=true on localhost HTTP (mobile dev) to ensure cookies are accepted
    secure: shouldUseSecureCookie,
    // BUG FIX #22: WebView doesn't support SameSite=None well, use Lax
    // Use "none" for cross-subdomain cookies (www.wildmindai.com <-> studio.wildmindai.com)
    sameSite: (useSameSiteNone ? "none" : "lax") as "none" | "lax" | "strict",
    // CRITICAL FIX: maxAge is in SECONDS (14 days = 1,209,600 seconds)
    // This is a FIXED value, NOT derived from ID token expiration
    maxAge: maxAgeInSeconds,
    path: "/",
    ...(shouldSetDomain ? { domain: cookieDomain } : {}),
  };

  // Debug logging for cookie setting - use both console.log and logger for visibility
  const logData = {
    isProd,
    cookieDomain: cookieDomain || '(not set)',
    shouldSetDomain,
    host,
    origin,
    cookieOptions: {
      domain: cookieOptions.domain || '(not set)',
      sameSite: cookieOptions.sameSite,
      secure: cookieOptions.secure,
      httpOnly: cookieOptions.httpOnly,
      path: cookieOptions.path,
      maxAge: cookieOptions.maxAge,
      maxAgeInSeconds: cookieOptions.maxAge,
      maxAgeInDays: 14, // Fixed 14 days
      expires: expirationDate.toISOString(),
      expiresInDays: 14, // Fixed 14 days
      expiresInHours: 336, // Fixed 336 hours (14 days)
      note: 'Cookie expiration is FIXED at 14 days, independent of ID token expiration'
    }
  };
  
  // Use console.log (always visible) and logger (structured logging)
  console.log('[AUTH][setSessionCookie] Setting cookie', JSON.stringify(logData, null, 2));
  try {
    const { logger } = await import('../../utils/logger');
    logger.info(logData, '[AUTH][setSessionCookie] Setting cookie');
  } catch (e) {
    // Logger not available, console.log is enough
  }

  // CRITICAL FIX: Manually set Set-Cookie header to ensure correct Max-Age value
  // Express res.cookie() may truncate or miscalculate maxAge, so we set it manually
  // This ensures Max-Age is always exactly 1,209,600 seconds (14 days)
  let setCookieValue = `app_session=${sessionCookie}; Path=${cookieOptions.path}`;
  
  // Set Max-Age (in seconds) - FIXED at 1,209,600 seconds (14 days)
  setCookieValue += `; Max-Age=${maxAgeInSeconds}`;
  
  // Add Expires header (RFC 1123 format) - 14 days from now
  setCookieValue += `; Expires=${expirationDate.toUTCString()}`;
  
  // Add domain if set
  if (cookieOptions.domain) {
    setCookieValue += `; Domain=${cookieOptions.domain}`;
  }
  
  // Add SameSite
  setCookieValue += `; SameSite=${cookieOptions.sameSite === 'none' ? 'None' : cookieOptions.sameSite === 'lax' ? 'Lax' : 'Strict'}`;
  
  // Add Secure if needed
  if (cookieOptions.secure) {
    setCookieValue += `; Secure`;
  }
  
  // Add HttpOnly
  setCookieValue += `; HttpOnly`;
  
  // Set the header manually
  res.setHeader('Set-Cookie', setCookieValue);
  
  // Log what we set (for verification)
  console.log('[AUTH][setSessionCookie] Set-Cookie header set manually:', {
    maxAge: maxAgeInSeconds,
    maxAgeInSeconds: maxAgeInSeconds,
    maxAgeInDays: 14,
    expires: expirationDate.toUTCString(),
    expiresISO: expirationDate.toISOString(),
    fullHeader: setCookieValue.substring(0, 200) + '...' // Truncate for logging
  });
  console.log('[AUTH][setSessionCookie] ========== SUCCESS ==========');
  
  return sessionCookie;
}

function clearSessionCookie(res: Response) {
  const cookieDomain = env.cookieDomain; // e.g. .wildmindai.com
  const expired = 'Thu, 01 Jan 1970 00:00:00 GMT';
  const isProd = env.nodeEnv === 'production';

  const variants: string[] = [];
  const cookiesToClear = ['app_session', 'app_session.sig', 'auth_hint'];
  
  // Generate all cookie clearing variants
  cookiesToClear.forEach(cookieName => {
    // SameSite=None; Secure variants (for cross-site cookies)
    variants.push(`${cookieName}=; Path=/; Max-Age=0; Expires=${expired}; SameSite=None; Secure`);
    if (cookieDomain) {
      variants.push(`${cookieName}=; Domain=${cookieDomain}; Path=/; Max-Age=0; Expires=${expired}; SameSite=None; Secure`);
    }
    
    // SameSite=Lax variants (for same-site cookies)
    variants.push(`${cookieName}=; Path=/; Max-Age=0; Expires=${expired}; SameSite=Lax`);
    if (cookieDomain) {
      variants.push(`${cookieName}=; Domain=${cookieDomain}; Path=/; Max-Age=0; Expires=${expired}; SameSite=Lax`);
    }
    
    // SameSite=Strict variants (for strict cookies)
    variants.push(`${cookieName}=; Path=/; Max-Age=0; Expires=${expired}; SameSite=Strict`);
    if (cookieDomain) {
      variants.push(`${cookieName}=; Domain=${cookieDomain}; Path=/; Max-Age=0; Expires=${expired}; SameSite=Strict`);
    }
  });

  // Set all cookie clearing variants
  res.setHeader('Set-Cookie', variants);
  
  console.log('[AUTH][clearSessionCookie] Cleared cookies', {
    cookieCount: variants.length,
    cookieDomain: cookieDomain || '(not set)',
    isProd,
  });
}

async function loginWithEmailPassword(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    console.log('[AUTH][loginWithEmailPassword] ========== START ==========');
    const { email, password } = req.body;
    console.log(`[AUTH][loginWithEmailPassword] Login attempt`, {
      email,
      hasPassword: !!password,
      passwordLength: password?.length || 0,
      origin: req.headers.origin,
      hostname: req.hostname,
      timestamp: new Date().toISOString()
    });

    const deviceInfo = extractDeviceInfo(req);
    console.log('[AUTH][loginWithEmailPassword] Calling authService.loginWithEmailPassword...');
    const result = await authService.loginWithEmailPassword(
      email,
      password,
      deviceInfo
    );

    console.log(`[AUTH][loginWithEmailPassword] Login successful`, {
      email,
      uid: result.user?.uid,
      username: result.user?.username,
      hasPasswordLoginIdToken: !!result.passwordLoginIdToken,
      passwordLoginIdTokenLength: result.passwordLoginIdToken?.length || 0,
      passwordLoginIdTokenPrefix: result.passwordLoginIdToken?.substring(0, 30) || 'N/A',
      hasCustomToken: !!result.customToken,
      customTokenLength: result.customToken?.length || 0
    });

    try {
      console.log('[CREDITS][loginEmail] Init start', { uid: (result.user as any)?.uid });
      const init = await creditsService.ensureUserInit(result.user.uid as any);
      console.log('[CREDITS][loginEmail] Init done', init);
    } catch (e: any) {
      console.error('[CREDITS][loginEmail] Init error', { uid: (result.user as any)?.uid, err: e?.message });
    }

    // OPTIMIZATION: Login endpoint only authenticates - NO session cookie here
    // Frontend should use Firebase SDK: signInWithEmailAndPassword() → getIdToken() → POST /session
    // This ensures single cookie creation point and better performance
    
    // Only invalidate sessions when necessary (password reset, suspicious activity)
    // For normal login, don't invalidate - let /session endpoint handle it

    console.log('[AUTH][loginWithEmailPassword] ========== SUCCESS ==========');
    // Return user data and custom token (frontend can signInWithCustomToken to sync Firebase client state)
    res.json(
      formatApiResponse("success", "Login successful", {
        user: result.user,
        customToken: result.customToken,
      })
    );
  } catch (error: any) {
    console.error('[AUTH][loginWithEmailPassword] ========== ERROR ==========');
    console.error(`[AUTH][loginWithEmailPassword] Login error:`, {
      message: error?.message,
      code: error?.code,
      errorCode: error?.errorCode,
      statusCode: error?.statusCode,
      stack: error?.stack,
      name: error?.name,
      error: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });
    next(error);
  }
}

async function googleSignIn(req: Request, res: Response, next: NextFunction) {
  try {
    console.log('[AUTH][googleSignIn] ========== START ==========');
    const { idToken } = req.body;
    console.log(`[AUTH][googleSignIn] Google sign-in request`, {
      hasIdToken: !!idToken,
      idTokenLength: idToken?.length || 0,
      idTokenPrefix: idToken?.substring(0, 30) || 'N/A',
      origin: req.headers.origin,
      hostname: req.hostname,
      timestamp: new Date().toISOString()
    });

    const deviceInfo = extractDeviceInfo(req);
    console.log('[AUTH][googleSignIn] Calling authService.googleSignIn...');
    const result = await authService.googleSignIn(idToken, deviceInfo);

    console.log(
      `[AUTH][googleSignIn] Google sign-in result`, {
        needsUsername: result.needsUsername,
        uid: result.user?.uid,
        username: result.user?.username,
        email: result.user?.email,
        hasSessionToken: !!result.sessionToken,
        sessionTokenLength: result.sessionToken?.length || 0
      }
    );

    // OPTIMIZATION: Google sign-in only creates/updates user - NO session cookie here
    // Frontend must call /session endpoint separately to create session cookie
    // This ensures single cookie creation point and better performance

    if (result.needsUsername) {
      // Initialize credits even if username is pending
      try {
        console.log('[CREDITS][googleSignIn:needsUsername] Init start', { uid: (result.user as any)?.uid });
        const init = await creditsService.ensureUserInit(result.user.uid as any);
        console.log('[CREDITS][googleSignIn:needsUsername] Init done', init);
      } catch (e: any) {
        console.error('[CREDITS][googleSignIn:needsUsername] Init error', { uid: (result.user as any)?.uid, err: e?.message });
      }
      // OPTIMIZATION: New user needs username - NO session cookie here
      // Frontend must call /session endpoint after username is set
      
      // New user needs to set username
      res.json(
        formatApiResponse(
          "success",
          "Google account verified. Please set username.",
          {
            user: result.user,
            needsUsername: true,
          }
        )
      );
    } else {
      // Existing user, return custom token for session creation on client
      try {
        console.log('[CREDITS][googleSignIn:existing] Init start', { uid: (result.user as any)?.uid });
        const init = await creditsService.ensureUserInit(result.user.uid as any);
        console.log('[CREDITS][googleSignIn:existing] Init done', init);
      } catch (e: any) {
        console.error('[CREDITS][googleSignIn:existing] Init error', { uid: (result.user as any)?.uid, err: e?.message });
      }
      // OPTIMIZATION: Only invalidate sessions when necessary (provider change, suspicious activity)
      // For normal Google sign-in, don't invalidate - let /session endpoint handle it
      // This improves performance and avoids logging out user from other devices unnecessarily
      
      res.json(
        formatApiResponse("success", "Google sign-in successful", {
          user: result.user,
          needsUsername: false,
          customToken: result.sessionToken,
        })
      );
    }
    console.log('[AUTH][googleSignIn] ========== SUCCESS ==========');
  } catch (error: any) {
    console.error('[AUTH][googleSignIn] ========== ERROR ==========');
    console.error(`[AUTH][googleSignIn] Google sign-in error:`, {
      message: error?.message,
      code: error?.code,
      errorCode: error?.errorCode,
      statusCode: error?.statusCode,
      stack: error?.stack,
      name: error?.name,
      idTokenLength: req.body?.idToken?.length,
      idTokenPrefix: req.body?.idToken?.substring(0, 30),
      error: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });
    next(error);
  }
}

async function setGoogleUsername(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { uid, username } = req.body;
    console.log(
      `[CONTROLLER] Setting Google username - UID: ${uid}, username: ${username}`
    );

    const deviceInfo = extractDeviceInfo(req);
    const result = await authService.setGoogleUsername(
      uid,
      username,
      deviceInfo
    );

    console.log(`[CONTROLLER] Google username set successfully`);

    try {
      console.log('[CREDITS][setGoogleUsername] Init start', { uid: (result.user as any)?.uid });
      const init = await creditsService.ensureUserInit(result.user.uid as any);
      console.log('[CREDITS][setGoogleUsername] Init done', init);
    } catch (e: any) {
      console.error('[CREDITS][setGoogleUsername] Init error', { uid: (result.user as any)?.uid, err: e?.message });
    }

    res.json(
      formatApiResponse("success", "Username set successfully", {
        user: result.user,
        customToken: result.sessionToken,
      })
    );
  } catch (error) {
    console.log(`[CONTROLLER] Set Google username error:`, error);
    next(error);
  }
}

/**
 * Refresh session cookie - extends expiration by another 14 days (2 weeks)
 * Called automatically when session is about to expire (within 3 days)
 * Requires a fresh ID token from the client
 */
async function refreshSession(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid as string;
    if (!uid) {
      throw new ApiError('Unauthorized - No user ID', 401);
    }

    // Get fresh ID token from request body (client must send it)
    const { idToken } = req.body;
    if (!idToken) {
      throw new ApiError('Missing idToken - client must provide fresh Firebase ID token', 400);
    }

    // Verify the ID token to ensure it's valid and matches the current user
    let decoded: any;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
      if (decoded.uid !== uid) {
        throw new ApiError('ID token does not match current user', 403);
      }
    } catch (error: any) {
      throw new ApiError(`Invalid ID token: ${error.message}`, 401);
    }

    // BUG FIX #6: Clear old cookie before creating new one
    const oldToken = req.cookies?.['app_session'];
    const cookieDomain = env.cookieDomain;
    const isProd = env.nodeEnv === "production";
    
    if (oldToken) {
      // Delete old session from Redis cache
      try {
        await deleteCachedSession(oldToken);
      } catch {}
      
      // Clear old cookie explicitly
      try {
        const expired = 'Thu, 01 Jan 1970 00:00:00 GMT';
        const cookieVariants = [
          { domain: undefined, sameSite: 'None', secure: true },
          { domain: cookieDomain, sameSite: 'None', secure: true },
          { domain: undefined, sameSite: 'Lax', secure: false },
          { domain: cookieDomain, sameSite: 'Lax', secure: false },
        ];
        
        cookieVariants.forEach(variant => {
          let cookieString = `app_session=; Path=/; Max-Age=0; Expires=${expired}`;
          if (variant.domain) cookieString += `; Domain=${variant.domain}`;
          cookieString += `; SameSite=${variant.sameSite}`;
          if (variant.secure || isProd) cookieString += '; Secure';
          res.setHeader('Set-Cookie', cookieString);
        });
      } catch {}
    }
    
    // Create new session cookie with extended expiration (14 days / 2 weeks)
    const newSessionCookie = await setSessionCookie(req, res, idToken);
    
    // Update Redis cache with new session
    try {
      const payload: any = decodeJwtPayload(newSessionCookie) || {};
      const exp = typeof payload?.exp === 'number' ? payload.exp : undefined;
      if (uid && exp) {
        
        // Cache new session
        await cacheSession(newSessionCookie, { 
          uid, 
          exp, 
          issuedAt: payload?.iat,
          userAgent: req.get('user-agent') || undefined,
          ip: req.ip,
        });
        const { env } = await import('../../config/env');
        if (env.redisDebug) {
          console.log('[AUTH][Redis] SET (refreshSession)', { uid, exp });
        }
      }
    } catch (cacheError) {
      console.warn('[AUTH] Failed to cache refreshed session (non-fatal):', cacheError);
    }

    res.json(
      formatApiResponse("success", "Session refreshed successfully", {
        expiresIn: 14 * 24 * 60 * 60 * 1000, // 14 days in milliseconds (Firebase Admin max: 2 weeks)
      })
    );
  } catch (error) {
    next(error);
  }
}

export const authController = {
  forgotPassword,
  createSession,
  getCurrentUser,
  updateUser,
  logout,
  startEmailOtp,
  verifyEmailOtp,
  setEmailUsername,
  resolveEmail,
  loginWithEmailPassword,
  googleSignIn,
  setGoogleUsername,
  checkUsername,
  refreshSession,
  debugSession,
};

// Lightweight endpoint to check if current session token is cached in Redis
export async function sessionCacheStatus(req: Request, res: Response, _next: NextFunction) {
  try {
    const enabled = isRedisEnabled();
    const token = (req.cookies as any)?.['app_session'];
    if (!enabled) {
      return res.json(formatApiResponse('success', 'Redis disabled', { enabled: false }));
    }
    if (!token) {
      return res.json(formatApiResponse('success', 'No session cookie', { enabled: true, cached: false }));
    }
    const cached = await getCachedSession(token);
    return res.json(formatApiResponse('success', 'OK', {
      enabled: true,
      cached: Boolean(cached?.uid),
      uid: (cached as any)?.uid || undefined,
    }));
  } catch (_e) {
    return res.json(formatApiResponse('success', 'Error checking cache', { enabled: false }));
  }
}

/**
 * Debug endpoint to check comprehensive session status
 * Helps verify session persistence without waiting for logout
 */
export async function debugSession(req: Request, res: Response, _next: NextFunction) {
  try {
    // CRITICAL: Log all cookie information for debugging cross-subdomain issues
    const cookieHeader = req.headers.cookie || '';
    const allCookies = cookieHeader.split(';').map(c => c.trim());
    const hasAppSessionInHeader = cookieHeader.includes('app_session=');
    const appSessionCookie = allCookies.find(c => c.startsWith('app_session='));
    
    console.log('[AUTH][debugSession] Cookie debug info:', {
      hasCookieHeader: !!req.headers.cookie,
      cookieHeaderLength: cookieHeader.length,
      cookieHeaderPreview: cookieHeader.substring(0, 150) + (cookieHeader.length > 150 ? '...' : ''),
      allCookies: allCookies,
      hasAppSessionInHeader,
      appSessionCookie: appSessionCookie ? (appSessionCookie.length > 50 ? appSessionCookie.substring(0, 50) + '...' : appSessionCookie) : null,
      hostname: req.hostname,
      origin: req.headers.origin,
      referer: req.headers.referer
    });
    
    const token = (req.cookies as any)?.['app_session'];
    const hasToken = !!token;
    
    let decoded: any = null;
    let verificationStatus = 'not_verified';
    let verificationError: any = null;
    let isSessionCookie = false;
    
    // Try to verify the token
    if (token) {
      try {
        const { admin } = await import('../../config/firebaseAdmin');
        const { env } = await import('../../config/env');
        
        try {
          decoded = await admin.auth().verifySessionCookie(token, env.authStrictRevocation);
          isSessionCookie = true;
          verificationStatus = 'verified_session_cookie';
        } catch (sessionError: any) {
          try {
            decoded = await admin.auth().verifyIdToken(token, env.authStrictRevocation);
            isSessionCookie = false;
            verificationStatus = 'verified_id_token';
          } catch (idTokenError: any) {
            verificationStatus = 'verification_failed';
            verificationError = {
              sessionError: sessionError?.message || sessionError?.code,
              idTokenError: idTokenError?.message || idTokenError?.code,
            };
          }
        }
      } catch (verifyErr: any) {
        verificationError = verifyErr?.message || 'Unknown verification error';
      }
    }
    
    // Check Redis cache
    let cacheStatus: any = null;
    try {
      const cached = token ? await getCachedSession(token) : null;
      if (cached) {
        const nowSec = Math.floor(Date.now() / 1000);
        const isExpired = cached.exp && cached.exp < nowSec;
        cacheStatus = {
          found: true,
          uid: cached.uid,
          exp: cached.exp,
          expDate: cached.exp ? new Date(cached.exp * 1000).toISOString() : null,
          issuedAt: cached.issuedAt,
          issuedAtDate: cached.issuedAt ? new Date(cached.issuedAt * 1000).toISOString() : null,
          isExpired,
          expiresIn: cached.exp ? Math.max(0, cached.exp - nowSec) : null,
          expiresInDays: cached.exp ? Math.floor((cached.exp - nowSec) / (24 * 60 * 60)) : null,
        };
      } else {
        cacheStatus = { found: false };
      }
    } catch (cacheErr: any) {
      cacheStatus = { error: cacheErr?.message };
    }
    
    // Decode JWT payload to get expiration info
    let jwtInfo: any = null;
    if (token && decoded) {
      jwtInfo = {
        uid: decoded.uid,
        email: decoded.email,
        exp: decoded.exp,
        expDate: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
        iat: decoded.iat,
        iatDate: decoded.iat ? new Date(decoded.iat * 1000).toISOString() : null,
        auth_time: decoded.auth_time,
        auth_timeDate: decoded.auth_time ? new Date(decoded.auth_time * 1000).toISOString() : null,
        isSessionCookie,
      };
      
      if (decoded.exp) {
        const nowSec = Math.floor(Date.now() / 1000);
        const expiresInSec = decoded.exp - nowSec;
        jwtInfo.expiresIn = expiresInSec;
        jwtInfo.expiresInDays = Math.floor(expiresInSec / (24 * 60 * 60));
        jwtInfo.expiresInHours = Math.floor(expiresInSec / (60 * 60));
        jwtInfo.isExpired = expiresInSec <= 0;
        jwtInfo.ageInDays = decoded.iat ? Math.floor((nowSec - decoded.iat) / (24 * 60 * 60)) : null;
      }
    } else if (token) {
      // Try to decode without verification to at least get expiration
      try {
        const payload = decodeJwtPayload(token);
        if (payload) {
          jwtInfo = {
            exp: payload.exp,
            expDate: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
            iat: payload.iat,
            iatDate: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
            uid: payload.uid,
            note: 'Decoded without verification - token may be invalid',
          };
          if (payload.exp) {
            const nowSec = Math.floor(Date.now() / 1000);
            const expiresInSec = payload.exp - nowSec;
            jwtInfo.expiresIn = expiresInSec;
            jwtInfo.expiresInDays = Math.floor(expiresInSec / (24 * 60 * 60));
            jwtInfo.isExpired = expiresInSec <= 0;
          }
        }
      } catch {}
    }
    
    return res.json(formatApiResponse('success', 'Session debug info', {
      timestamp: new Date().toISOString(),
      hasToken,
      tokenLength: token?.length || 0,
      tokenPrefix: token ? token.substring(0, 20) + '...' : null,
      verification: {
        status: verificationStatus,
        error: verificationError,
        isSessionCookie,
      },
      jwt: jwtInfo,
      cache: cacheStatus,
      // CRITICAL: Add cookie header analysis for cross-subdomain debugging
      cookieHeaderAnalysis: {
        hasCookieHeader: !!req.headers.cookie,
        cookieHeaderLength: cookieHeader.length,
        allCookies: allCookies,
        hasAppSessionInHeader,
        appSessionCookieFound: !!appSessionCookie,
        cookieCount: allCookies.length,
        hostname: req.hostname,
        origin: req.headers.origin,
        diagnosis: !hasAppSessionInHeader ? {
          issue: 'Cookie NOT in request header',
          explanation: 'The app_session cookie is not being sent with this request. This means the cookie either:',
          possibleCauses: [
            '1. COOKIE_DOMAIN env var is NOT set in backend (most likely)',
            '2. Cookie was set without Domain attribute (old cookie before env var was set)',
            '3. Cookie domain mismatch (cookie for www.wildmindai.com but accessing studio.wildmindai.com)',
            '4. User is not logged in on www.wildmindai.com'
          ],
          howToFix: [
            '1. Set COOKIE_DOMAIN=.wildmindai.com in Render.com environment',
            '2. Restart backend service',
            '3. Log in again on www.wildmindai.com (old cookies won\'t have domain)',
            '4. Check DevTools → Application → Cookies → verify Domain: .wildmindai.com',
            '5. Then try studio.wildmindai.com again'
          ],
          networkTabCheck: 'Open DevTools → Network tab → Find /api/auth/me request → Headers → Request Headers → Check if Cookie header includes app_session'
        } : hasAppSessionInHeader && !hasToken ? {
          issue: 'Cookie in header but not parsed',
          possibleCauses: [
            'Cookie parsing issue',
            'Cookie format incorrect'
          ]
        } : {
          issue: 'Cookie found and parsed successfully',
          status: 'OK'
        }
      },
      recommendations: !hasToken 
        ? ['No session token found - user is not logged in']
        : verificationStatus === 'verification_failed'
        ? ['Session token verification failed - user may be logged out', 'Check backend logs for detailed error']
        : jwtInfo?.isExpired
        ? ['Session token is expired - user needs to log in again']
        : jwtInfo?.expiresInDays !== undefined && jwtInfo.expiresInDays < 1
        ? ['Session expires soon - refresh may be needed']
        : ['Session appears valid', `Expires in ${jwtInfo?.expiresInDays || 'unknown'} days`],
    }));
  } catch (error: any) {
    return res.json(formatApiResponse('error', 'Debug endpoint error', {
      error: error?.message,
      stack: error?.stack,
    }));
  }
}

async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    console.log('[AUTH][forgotPassword] ========== START ==========');
    const { email } = req.body;
    
    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new ApiError('Email is required', 400);
    }
    
    const normalizedEmail = email.trim().toLowerCase();
    console.log(`[AUTH][forgotPassword] Password reset request for: ${normalizedEmail}`);
    
    // Send password reset email - now returns detailed result
    const result = await authService.sendPasswordResetEmail(normalizedEmail);
    
    console.log('[AUTH][forgotPassword] Result:', result);
    
    if (result.success) {
      console.log('[AUTH][forgotPassword] ========== SUCCESS ==========');
      res.json(
        formatApiResponse("success", result.message, {
          message: result.message
        })
      );
    } else {
      // Handle different error cases
      if (result.reason === 'USER_NOT_FOUND') {
        console.log('[AUTH][forgotPassword] User not found');
        res.status(404).json(
          formatApiResponse("error", result.message, {
            message: result.message,
            reason: result.reason
          })
        );
      } else if (result.reason === 'GOOGLE_ONLY_USER') {
        console.log('[AUTH][forgotPassword] Google-only user');
        res.status(400).json(
          formatApiResponse("error", result.message, {
            message: result.message,
            reason: result.reason
          })
        );
      } else {
        console.log('[AUTH][forgotPassword] Other error:', result.reason);
        res.status(500).json(
          formatApiResponse("error", result.message, {
            message: result.message,
            reason: result.reason
          })
        );
      }
    }
  } catch (error) {
    next(error);
  }
}