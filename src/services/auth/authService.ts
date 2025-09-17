import { admin } from '../../config/firebaseAdmin';
import { AuthRepository } from '../../repository/auth/authRepository';
import { AppUser, ProviderId } from '../../types/authTypes';
import { ApiError } from '../../utils/errorHandler';
import { sendEmail } from '../../utils/mailer';
import { UsernameSchema } from '../../schemas/authSchemas';

export class AuthService {
  private authRepository: AuthRepository;

  constructor() {
    this.authRepository = new AuthRepository();
  }

  async createSession(idToken: string): Promise<AppUser> {
    try {
      const decoded = await admin.auth().verifyIdToken(idToken, true);
      const user = await this.upsertUserFromFirebase(decoded);
      return user;
    } catch (error) {
      throw new ApiError('Invalid token', 401);
    }
  }

  async startEmailOtp(email: string): Promise<{ sent: boolean; ttl: number }> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const ttlSeconds = 60; // OTP valid for 60s
    await this.authRepository.saveOtp(email, code, ttlSeconds);
    await sendEmail(email, 'Your verification code', `Your OTP code is: ${code}`);
    return { sent: true, ttl: ttlSeconds };
  }

  async verifyEmailOtpAndCreateUser(email: string, username?: string, password?: string): Promise<AppUser> {
    // In a production system you'd link this OTP flow with a temporary session; simplified here
    // OTP verified email becomes a user record (passwordless-style). For classic password flow, you'd still use Firebase Auth.
    const dummyCode = '000000'; // not used here; verify should be called before this in controller
    const uname = username ? username.toLowerCase() : (email.split('@')[0] || 'user');
    const valid = UsernameSchema.safeParse(uname);
    if (!valid.success) throw new ApiError('Invalid username', 400, valid.error.flatten());
    try {
      const existing = await admin.auth().getUserByEmail(email);
      // If a password was provided, ensure the account can sign in with email/password
      if (password) {
        await admin.auth().updateUser(existing.uid, { password, emailVerified: true });
      } else if (!existing.emailVerified) {
        await admin.auth().updateUser(existing.uid, { emailVerified: true });
      }
      return await this.authRepository.upsertUser(existing.uid, {
        email,
        username: uname.replace(/[^a-z0-9_.-]/g, '').slice(0, 30),
        provider: 'password',
        photoURL: undefined
      });
    } catch {
      const created = await admin.auth().createUser({ email, emailVerified: true, ...(password ? { password } : {}) });
      return await this.authRepository.upsertUser(created.uid, {
        email,
        username: uname.replace(/[^a-z0-9_.-]/g, '').slice(0, 30),
        provider: 'password',
        photoURL: undefined
      });
    }
  }

  async getCurrentUser(uid: string): Promise<AppUser> {
    const user = await this.authRepository.getUserById(uid);
    if (!user) {
      throw new ApiError('User not found', 404);
    }
    return user;
  }

  async updateUser(uid: string, updates: Partial<AppUser>): Promise<AppUser> {
    return await this.authRepository.updateUser(uid, updates);
  }

  async resolveEmailForLogin(identifier: string): Promise<string | null> {
    // identifier can be email or username
    if (identifier.includes('@')) return identifier;
    const email = await this.authRepository.getEmailByUsername(identifier.toLowerCase());
    return email;
  }

  private async upsertUserFromFirebase(decoded: any): Promise<AppUser> {
    const uid: string = decoded.uid;
    const email: string = decoded.email || '';
    const displayName: string | undefined = decoded.name || decoded.displayName;
    const photoURL: string | undefined = decoded.picture;
    const providerId: ProviderId = (decoded.firebase?.sign_in_provider as ProviderId) || 'unknown';

    const username = (displayName || email.split('@')[0] || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '')
      .slice(0, 30) || `user_${uid.slice(0, 6)}`;

    return await this.authRepository.upsertUser(uid, {
      email,
      username,
      photoURL,
      provider: providerId
    });
  }
}
