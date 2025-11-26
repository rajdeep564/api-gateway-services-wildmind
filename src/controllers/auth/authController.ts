import { Request, Response, NextFunction } from "express";
import { authService } from "../../services/auth/authService";
import { creditsService } from "../../services/creditsService";
import { authRepository } from "../../repository/auth/authRepository";
import { formatApiResponse } from "../../utils/formatApiResponse";
import { ApiError } from "../../utils/errorHandler";
import { extractDeviceInfo } from "../../utils/deviceInfo";
import { admin } from "../../config/firebaseAdmin";
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
    console.log('[AUTH][createSession] Function called', {
      hasIdToken: !!req.body?.idToken,
      idTokenLength: req.body?.idToken?.length || 0,
      origin: req.headers.origin,
      hostname: req.hostname
    });
    
    const { idToken } = req.body;
    console.log('[AUTH][createSession] Creating session with authService...');
    
    const user = await authService.createSession(idToken);
    console.log('[AUTH][createSession] Session created, user:', { uid: user?.uid, username: user?.username });

    // BUG FIX #1: Invalidate all existing sessions for this user before creating new one
    // This prevents multiple active sessions across devices
    // BUG FIX #10: Also revoke old Firebase tokens to sync auth state
    if (user?.uid) {
      try {
        // Delete old session cookie from Redis if present
        const oldToken = req.cookies?.['app_session'];
        if (oldToken) {
          await deleteCachedSession(oldToken);
        }
        // Invalidate all other sessions for this user
        // BUG FIX #13: Keep newest session if under limit, otherwise remove oldest
        await invalidateAllUserSessions(user.uid, true);
        
        // BUG FIX #10: Revoke all refresh tokens for this user to force re-authentication on other devices
        // This ensures Firebase auth state is synced across devices
        try {
          await admin.auth().revokeRefreshTokens(user.uid);
          console.log('[AUTH][createSession] Revoked Firebase refresh tokens for user', { uid: user.uid });
        } catch (revokeError) {
          console.warn('[AUTH][createSession] Failed to revoke refresh tokens (non-fatal):', revokeError);
        }
        
        console.log('[AUTH][createSession] Invalidated old sessions for user', { uid: user.uid });
      } catch (error) {
        console.warn('[AUTH][createSession] Failed to invalidate old sessions (non-fatal):', error);
      }
    }

    // Set session cookie (safely handle domain so browsers don't drop it in prod)
    console.log('[AUTH][createSession] About to call setSessionCookie...');
    const sessionCookie = await setSessionCookie(req, res, idToken);
    console.log('[AUTH][createSession] setSessionCookie completed, cookie length:', sessionCookie?.length || 0);
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

    res.json(
      formatApiResponse("success", "Session created successfully", { user })
    );
  } catch (error) {
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

    // BUG FIX #9: Invalidate any existing sessions for this user (if user already existed)
    if (result.user?.uid) {
      try {
        const oldToken = req.cookies?.['app_session'];
        if (oldToken) {
          await deleteCachedSession(oldToken);
        }
        // BUG FIX #13: Keep newest session if under limit
        await invalidateAllUserSessions(result.user.uid, true);
        console.log('[AUTH][verifyEmailOtp] Invalidated old sessions for user', { uid: result.user.uid });
      } catch (error) {
        console.warn('[AUTH][verifyEmailOtp] Failed to invalidate old sessions (non-fatal):', error);
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
  console.log('[AUTH][setSessionCookie] Function called', {
    hasIdToken: !!idToken,
    idTokenLength: idToken?.length || 0,
    hostname: req.hostname,
    origin: req.headers.origin
  });
  
  const isProd = process.env.NODE_ENV === "production";
  const cookieDomain = process.env.COOKIE_DOMAIN; // e.g., .wildmindai.com when API runs on api.wildmindai.com
  // BUG FIX #11: Check ID token expiration first to prevent mismatch
  let decodedToken: any;
  try {
    decodedToken = await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    throw new ApiError('Invalid ID token', 401);
  }
  
  // Calculate expiration based on ID token expiration (max 30 days)
  const idTokenExp = decodedToken.exp * 1000; // Convert to milliseconds
  const now = Date.now();
  const idTokenExpiresIn = Math.max(0, idTokenExp - now);
  const maxExpiresIn = 1000 * 60 * 60 * 24 * 30; // 30 days max
  const expiresIn = Math.min(idTokenExpiresIn, maxExpiresIn);
  
  // If ID token expires very soon, use a shorter expiration
  if (expiresIn < 1000 * 60 * 60) { // Less than 1 hour
    throw new ApiError('ID token expires too soon. Please refresh and try again.', 401);
  }
  
  // BUG FIX #4: Mobile cookie compatibility - SameSite=None requires Secure=true
  // BUG FIX #22: Android WebView detection
  const userAgent = req.get('user-agent') || '';
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isWebView = /wv|WebView/i.test(userAgent); // Android WebView detection
  
  console.log('[AUTH][setSessionCookie] Before creating session cookie', {
    isProd,
    cookieDomain: cookieDomain || '(not set in env)',
    expiresIn,
    idTokenExpiresIn,
    expiresInDays: Math.floor(expiresIn / (1000 * 60 * 60 * 24))
  });
  
  const sessionCookie = await admin
    .auth()
    .createSessionCookie(idToken, { expiresIn });
  
  console.log('[AUTH][setSessionCookie] Session cookie created', {
    cookieLength: sessionCookie?.length || 0,
    hasCookie: !!sessionCookie
  });
  
  // In production, always use the cookie domain if set (for cross-subdomain sharing)
  // In development, only use domain if it matches the current host
  const host = (req.hostname || '').toLowerCase();
  const origin = req.headers.origin || '';
  const dom = (cookieDomain || '').toLowerCase();
  let shouldSetDomain = false;
  
  if (isProd && cookieDomain) {
    // Production: always use domain for cross-subdomain cookie sharing
    shouldSetDomain = true;
  } else if (cookieDomain) {
    // Development: only use domain if it matches the host
    const domainMatches = !!(dom && (host === dom.replace(/^\./, '') || host.endsWith(dom)));
    shouldSetDomain = domainMatches;
  }

  const cookieOptions = {
    httpOnly: true,
    // BUG FIX #4: Cookies must be Secure when SameSite=None per Chrome requirements
    // Also always secure on mobile for compatibility
    // BUG FIX #22: WebView requires Secure cookies
    secure: isProd || isMobile || isWebView, // Always secure on mobile/WebView, secure in production
    // BUG FIX #22: WebView doesn't support SameSite=None well, use Lax
    sameSite: (isProd && !isWebView ? "none" : "lax") as "none" | "lax" | "strict", // None for cross-subdomain, Lax for WebView/same-site
    maxAge: expiresIn,
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
      maxAge: cookieOptions.maxAge
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

  // Actually set the cookie
  res.cookie("app_session", sessionCookie, cookieOptions);
  
  // Log the actual Set-Cookie header that will be sent
  const setCookieHeader = res.getHeader('Set-Cookie');
  console.log('[AUTH][setSessionCookie] Set-Cookie header:', setCookieHeader);
  
  // Also log what the browser should receive
  const cookieString = `app_session=${sessionCookie}; Domain=${cookieOptions.domain || '(no domain)'}; Path=${cookieOptions.path}; Max-Age=${cookieOptions.maxAge}; SameSite=${cookieOptions.sameSite}; Secure=${cookieOptions.secure}; HttpOnly=${cookieOptions.httpOnly}`;
  console.log('[AUTH][setSessionCookie] Cookie string that will be sent:', cookieString);
  
  return sessionCookie;
}

function clearSessionCookie(res: Response) {
  const cookieDomain = process.env.COOKIE_DOMAIN; // e.g. .wildmindai.com
  const expired = 'Thu, 01 Jan 1970 00:00:00 GMT';
  const isProd = process.env.NODE_ENV === 'production';

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
    const { email, password } = req.body;
    console.log(`[CONTROLLER] Login attempt - email: ${email}`);

    const deviceInfo = extractDeviceInfo(req);
    const result = await authService.loginWithEmailPassword(
      email,
      password,
      deviceInfo
    );

    console.log(`[CONTROLLER] Login successful for: ${email}`);

    // BUG FIX #1: Invalidate all existing sessions for this user before creating new one
    // BUG FIX #10: Also revoke Firebase tokens to sync auth state
    if (result.user?.uid) {
      try {
        const oldToken = req.cookies?.['app_session'];
        if (oldToken) {
          await deleteCachedSession(oldToken);
        }
        // BUG FIX #13: Keep newest session if under limit
        await invalidateAllUserSessions(result.user.uid, true);
        
        // Revoke Firebase refresh tokens
        try {
          await admin.auth().revokeRefreshTokens(result.user.uid);
          console.log('[AUTH][loginEmail] Revoked Firebase refresh tokens for user', { uid: result.user.uid });
        } catch (revokeError) {
          console.warn('[AUTH][loginEmail] Failed to revoke refresh tokens (non-fatal):', revokeError);
        }
        
        console.log('[AUTH][loginEmail] Invalidated old sessions for user', { uid: result.user.uid });
      } catch (error) {
        console.warn('[AUTH][loginEmail] Failed to invalidate old sessions (non-fatal):', error);
      }
    }

    try {
      console.log('[CREDITS][loginEmail] Init start', { uid: (result.user as any)?.uid });
      const init = await creditsService.ensureUserInit(result.user.uid as any);
      console.log('[CREDITS][loginEmail] Init done', init);
    } catch (e: any) {
      console.error('[CREDITS][loginEmail] Init error', { uid: (result.user as any)?.uid, err: e?.message });
    }

    // If we have an ID token from password login, set the session cookie now so the client doesn't need to call session explicitly
    console.log('[AUTH][loginEmail] Checking for passwordLoginIdToken', {
      hasPasswordLoginIdToken: !!result.passwordLoginIdToken,
      tokenLength: result.passwordLoginIdToken?.length || 0
    });
    
    try {
      if (result.passwordLoginIdToken) {
        console.log('[AUTH][loginEmail] About to call setSessionCookie with passwordLoginIdToken...');
        await setSessionCookie(req, res, result.passwordLoginIdToken);
        console.log('[AUTH][loginEmail] setSessionCookie completed successfully');
      } else {
        console.log('[AUTH][loginEmail] No passwordLoginIdToken, skipping setSessionCookie');
      }
    } catch (e) {
      // Non-fatal; client still has customToken fallback
      console.error('[CONTROLLER][loginEmail] session cookie create failed', {
        error: (e as any)?.message,
        stack: (e as any)?.stack
      });
    }

    // Return user data and custom token (frontend can signInWithCustomToken to sync Firebase client state)
    res.json(
      formatApiResponse("success", "Login successful", {
        user: result.user,
        customToken: result.customToken,
      })
    );
  } catch (error) {
    console.log(`[CONTROLLER] Login error:`, error);
    next(error);
  }
}

async function googleSignIn(req: Request, res: Response, next: NextFunction) {
  try {
    const { idToken } = req.body;
    console.log(`[CONTROLLER] Google sign-in request`);

    const deviceInfo = extractDeviceInfo(req);
    const result = await authService.googleSignIn(idToken, deviceInfo);

    console.log(
      `[CONTROLLER] Google sign-in result - needsUsername: ${result.needsUsername}`
    );

    // BUG FIX #1: Invalidate all existing sessions for this user before creating new one
    // BUG FIX #10: Also revoke Firebase tokens to sync auth state
    if (result.user?.uid) {
      try {
        const oldToken = req.cookies?.['app_session'];
        if (oldToken) {
          await deleteCachedSession(oldToken);
        }
        // BUG FIX #13: Keep newest session if under limit
        await invalidateAllUserSessions(result.user.uid, true);
        
        // Revoke Firebase refresh tokens
        try {
          await admin.auth().revokeRefreshTokens(result.user.uid);
          console.log('[AUTH][googleSignIn] Revoked Firebase refresh tokens for user', { uid: result.user.uid });
        } catch (revokeError) {
          console.warn('[AUTH][googleSignIn] Failed to revoke refresh tokens (non-fatal):', revokeError);
        }
        
        console.log('[AUTH][googleSignIn] Invalidated old sessions for user', { uid: result.user.uid });
      } catch (error) {
        console.warn('[AUTH][googleSignIn] Failed to invalidate old sessions (non-fatal):', error);
      }
    }

    if (result.needsUsername) {
      // Initialize credits even if username is pending
      try {
        console.log('[CREDITS][googleSignIn:needsUsername] Init start', { uid: (result.user as any)?.uid });
        const init = await creditsService.ensureUserInit(result.user.uid as any);
        console.log('[CREDITS][googleSignIn:needsUsername] Init done', init);
      } catch (e: any) {
        console.error('[CREDITS][googleSignIn:needsUsername] Init error', { uid: (result.user as any)?.uid, err: e?.message });
      }
      // Set session cookie immediately so client doesn't need a follow-up session call
      console.log('[AUTH][googleSignIn:needsUsername] Checking idToken for setSessionCookie', {
        hasIdToken: !!idToken,
        idTokenType: typeof idToken,
        idTokenLength: idToken?.length || 0
      });
      
      try {
        if (typeof idToken === 'string' && idToken.length > 0) {
          console.log('[AUTH][googleSignIn:needsUsername] About to call setSessionCookie...');
          await setSessionCookie(req, res, idToken);
          console.log('[AUTH][googleSignIn:needsUsername] setSessionCookie completed successfully');
        } else {
          console.log('[AUTH][googleSignIn:needsUsername] Invalid idToken, skipping setSessionCookie');
        }
      } catch (cookieErr) {
        console.error('[CONTROLLER][googleSignIn:needsUsername] session cookie create failed', {
          error: (cookieErr as any)?.message,
          stack: (cookieErr as any)?.stack
        });
      }
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
      // Set session cookie immediately for existing users too
      console.log('[AUTH][googleSignIn:existing] Checking idToken for setSessionCookie', {
        hasIdToken: !!idToken,
        idTokenType: typeof idToken,
        idTokenLength: idToken?.length || 0
      });
      
      try {
        if (typeof idToken === 'string' && idToken.length > 0) {
          console.log('[AUTH][googleSignIn:existing] About to call setSessionCookie...');
          await setSessionCookie(req, res, idToken);
          console.log('[AUTH][googleSignIn:existing] setSessionCookie completed successfully');
        } else {
          console.log('[AUTH][googleSignIn:existing] Invalid idToken, skipping setSessionCookie');
        }
      } catch (cookieErr) {
        console.error('[CONTROLLER][googleSignIn:existing] session cookie create failed', {
          error: (cookieErr as any)?.message,
          stack: (cookieErr as any)?.stack
        });
      }
      res.json(
        formatApiResponse("success", "Google sign-in successful", {
          user: result.user,
          needsUsername: false,
          customToken: result.sessionToken,
        })
      );
    }
  } catch (error) {
    console.log(`[CONTROLLER] Google sign-in error:`, error);
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
 * Refresh session cookie - extends expiration by another 30 days
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
    const cookieDomain = process.env.COOKIE_DOMAIN;
    const isProd = process.env.NODE_ENV === "production";
    
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
    
    // Create new session cookie with extended expiration (30 days)
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
        expiresIn: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
      })
    );
  } catch (error) {
    next(error);
  }
}

export const authController = {
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
