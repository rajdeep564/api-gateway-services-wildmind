import { Request, Response, NextFunction } from 'express';
import { admin } from '../config/firebaseAdmin';
import { ApiError } from '../utils/errorHandler';

const COOKIE_NAME = 'app_session';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    console.log("cookies",req.cookies);
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      throw new ApiError('Unauthorized - No session token', 401);
    }
    // Prefer verifying as a session cookie; fallback to ID token if needed
    let decoded: any;
    try {
      decoded = await admin.auth().verifySessionCookie(token, true);
      console.log("decoded",decoded);
    } catch (_e) {
      decoded = await admin.auth().verifyIdToken(token, true);
    }
    (req as any).uid = decoded.uid;
    return next();
  } catch (error) {
    if (error instanceof ApiError) {
      return next(error);
    }
    return next(new ApiError('Unauthorized - Invalid token', 401));
  }
}
