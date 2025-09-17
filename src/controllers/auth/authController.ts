import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../../services/auth/authService';
import { SessionRequestSchema, UpdateMeSchema, OtpStartSchema, OtpVerifySchema, UsernameSchema, EmailUsernameSchema } from '../../schemas/authSchemas';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ApiError } from '../../utils/errorHandler';

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  async createSession(req: Request, res: Response, next: NextFunction) {
    try {
      const parse = SessionRequestSchema.safeParse(req.body);
      if (!parse.success) {
        throw new ApiError('Invalid request data', 400, parse.error.flatten());
      }

      const { idToken } = parse.data;
      const user = await this.authService.createSession(idToken);
      
      // Set session cookie
      this.setSessionCookie(res, idToken);
      
      res.json(formatApiResponse('success', 'Session created successfully', { user }));
    } catch (error) {
      next(error);
    }
  }

  async getCurrentUser(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = (req as any).uid as string;
      const user = await this.authService.getCurrentUser(uid);
      
      res.json(formatApiResponse('success', 'User retrieved successfully', { user }));
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req: Request, res: Response, next: NextFunction) {
    try {
      const parse = UpdateMeSchema.safeParse(req.body);
      if (!parse.success) {
        throw new ApiError('Invalid request data', 400, parse.error.flatten());
      }

      const uid = (req as any).uid as string;
      const updates = parse.data;
      const user = await this.authService.updateUser(uid, updates);
      
      res.json(formatApiResponse('success', 'User updated successfully', { user }));
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      this.clearSessionCookie(res);
      res.json(formatApiResponse('success', 'Logged out successfully', {}));
    } catch (error) {
      next(error);
    }
  }

  async startEmailOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = OtpStartSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError('Invalid request data', 400, parsed.error.flatten());
      const { email } = parsed.data;
      const result = await this.authService.startEmailOtp(email);
      res.json(formatApiResponse('success', 'OTP sent', result));
    } catch (error) {
      next(error);
    }
  }

  async verifyEmailOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = OtpVerifySchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError('Invalid request data', 400, parsed.error.flatten());
      const { email, code, password } = parsed.data;
      // Verify and consume OTP via repository
      const ok = await this.authService['authRepository'].verifyAndConsumeOtp(email, code);
      if (!ok) throw new ApiError('Invalid or expired OTP', 400);

      const user = await this.authService.verifyEmailOtpAndCreateUser(email, undefined, password);
      res.json(formatApiResponse('success', 'OTP verified', { user }));
    } catch (error) {
      next(error);
    }
  }

  async setEmailUsername(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = EmailUsernameSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError('Invalid request data', 400, parsed.error.flatten());
      const { email, username } = parsed.data;
      const user = await this.authService.verifyEmailOtpAndCreateUser(email, username);
      res.json(formatApiResponse('success', 'Username set', { user }));
    } catch (error) {
      next(error);
    }
  }

  async resolveEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.query.id || '');
      if (!id) throw new ApiError('Missing id', 400);
      const email = await this.authService.resolveEmailForLogin(id);
      if (!email) throw new ApiError('Account not found', 404);
      res.json(formatApiResponse('success', 'Resolved', { email }));
    } catch (error) {
      next(error);
    }
  }

  async resolveUid(req: Request, res: Response, next: NextFunction) {
    try {
      const username = String(req.query.username || '').toLowerCase();
      if (!username) throw new ApiError('Missing username', 400);
      const match = await this.authService['authRepository'].getEmailByUsername(username);
      if (!match) throw new ApiError('Account not found', 404);
      // Fetch uid by email from Firebase Auth
      const record = await (await import('../../config/firebaseAdmin')).admin.auth().getUserByEmail(match);
      res.json(formatApiResponse('success', 'Resolved', { uid: record.uid, email: match }));
    } catch (error) {
      next(error);
    }
  }

  private setSessionCookie(res: Response, token: string) {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('app_session', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      path: '/'
    });
  }

  private clearSessionCookie(res: Response) {
    res.clearCookie('app_session', { path: '/' });
  }
}
