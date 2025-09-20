import { Request, Response, NextFunction } from 'express';
import { authService } from '../../services/auth/authService';
import { authRepository } from '../../repository/auth/authRepository';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ApiError } from '../../utils/errorHandler';
import { extractDeviceInfo } from '../../utils/deviceInfo';

async function createSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { idToken } = req.body;
    const user = await authService.createSession(idToken);
    
    // Set session cookie
    setSessionCookie(res, idToken);
    
    res.json(formatApiResponse('success', 'Session created successfully', { user }));
  } catch (error) {
    next(error);
  }
}

async function getCurrentUser(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const user = await authService.getCurrentUser(uid);
    
    res.json(formatApiResponse('success', 'User retrieved successfully', { user }));
  } catch (error) {
    next(error);
  }
}

async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const updates = req.body;
    const user = await authService.updateUser(uid, updates);
    
    res.json(formatApiResponse('success', 'User updated successfully', { user }));
  } catch (error) {
    next(error);
  }
}

async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    clearSessionCookie(res);
    res.json(formatApiResponse('success', 'Logged out successfully', {}));
  } catch (error) {
    next(error);
  }
}

async function startEmailOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = req.body;
    console.log(`[CONTROLLER] Starting OTP for email: ${email}`);
    const result = await authService.startEmailOtp(email);
    console.log(`[CONTROLLER] OTP start result:`, result);
    res.json(formatApiResponse('success', 'OTP sent', result));
  } catch (error) {
    console.log(`[CONTROLLER] OTP start error:`, error);
    next(error);
  }
}

async function verifyEmailOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, code, password } = req.body;
    console.log(`[CONTROLLER] Verifying OTP - email: ${email}, code: ${code}, hasPassword: ${!!password}`);
    
    const ok = await authRepository.verifyAndConsumeOtp(email, code);
    if (!ok) {
      console.log(`[CONTROLLER] OTP verification failed for ${email}`);
      throw new ApiError('Invalid or expired OTP', 400);
    }
    
    console.log(`[CONTROLLER] OTP verified successfully, creating Firebase user and Firestore user...`);
    const deviceInfo = extractDeviceInfo(req);
    const result = await authService.verifyEmailOtpAndCreateUser(email, undefined, password, deviceInfo);
    console.log(`[CONTROLLER] User created and ID token generated`);
    
    // Return both user data and Firebase ID token
    res.json(formatApiResponse('success', 'OTP verified and user created', { 
      user: result.user,
      idToken: result.idToken 
    }));
  } catch (error) {
    console.log(`[CONTROLLER] OTP verify error:`, error);
    next(error);
  }
}

async function setEmailUsername(req: Request, res: Response, next: NextFunction) {
  try {
    const { username, email } = req.body;
    const deviceInfo = extractDeviceInfo(req);
    
    console.log(`[CONTROLLER] Setting username: ${username} for email: ${email}`);
    console.log(`[CONTROLLER] Device info:`, deviceInfo);
    
    const user = await authService.setUsernameOnly(username, deviceInfo, email);
    console.log(`[CONTROLLER] Username set successfully:`, user);
    res.json(formatApiResponse('success', 'Username set', { user }));
  } catch (error) {
    console.log(`[CONTROLLER] Set username error:`, error);
    next(error);
  }
}

async function resolveEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.query.id || '');
    if (!id) throw new ApiError('Missing id', 400);
    const email = await authService.resolveEmailForLogin(id);
    if (!email) throw new ApiError('Account not found', 404);
    res.json(formatApiResponse('success', 'Resolved', { email }));
  } catch (error) {
    next(error);
  }
}

function setSessionCookie(res: Response, token: string) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('app_session', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    path: '/'
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie('app_session', { path: '/' });
}

async function loginWithEmailPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    console.log(`[CONTROLLER] Login attempt - email: ${email}`);
    
    const deviceInfo = extractDeviceInfo(req);
    const result = await authService.loginWithEmailPassword(email, password, deviceInfo);
    
    console.log(`[CONTROLLER] Login successful for: ${email}`);
    
    // Return user data and custom token (frontend will convert to ID token)
    res.json(formatApiResponse('success', 'Login successful', { 
      user: result.user,
      idToken: result.idToken
    }));
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
    
    console.log(`[CONTROLLER] Google sign-in result - needsUsername: ${result.needsUsername}`);
    
    if (result.needsUsername) {
      // New user needs to set username
      res.json(formatApiResponse('success', 'Google account verified. Please set username.', { 
        user: result.user,
        needsUsername: true
      }));
    } else {
      // Existing user, return session token
      res.json(formatApiResponse('success', 'Google sign-in successful', { 
        user: result.user,
        needsUsername: false,
        idToken: result.sessionToken
      }));
    }
  } catch (error) {
    console.log(`[CONTROLLER] Google sign-in error:`, error);
    next(error);
  }
}

async function setGoogleUsername(req: Request, res: Response, next: NextFunction) {
  try {
    const { uid, username } = req.body;
    console.log(`[CONTROLLER] Setting Google username - UID: ${uid}, username: ${username}`);
    
    const deviceInfo = extractDeviceInfo(req);
    const result = await authService.setGoogleUsername(uid, username, deviceInfo);
    
    console.log(`[CONTROLLER] Google username set successfully`);
    
    res.json(formatApiResponse('success', 'Username set successfully', { 
      user: result.user,
      idToken: result.sessionToken
    }));
  } catch (error) {
    console.log(`[CONTROLLER] Set Google username error:`, error);
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
  setGoogleUsername
};