import { admin } from '../../config/firebaseAdmin';
import { AppUser } from '../../types/authTypes';

export class AuthRepository {
  async upsertUser(uid: string, userData: Partial<AppUser>): Promise<AppUser> {
    const ref = admin.firestore().collection('users').doc(uid);
    const snap = await ref.get();
    
    const nowIso = new Date().toISOString();
    
    if (!snap.exists) {
      // Create new user
      const newUser: AppUser = {
        uid,
        email: userData.email || '',
        username: userData.username || '',
        provider: userData.provider || 'unknown',
        createdAt: nowIso,
        lastLoginAt: nowIso
      } as AppUser;
      if ((userData as any).displayName !== undefined) {
        (newUser as any).displayName = (userData as any).displayName;
      }
      if (userData.photoURL !== undefined) {
        (newUser as any).photoURL = userData.photoURL;
      }
      await ref.set(newUser);
      return newUser;
    } else {
      // Update existing user
      const existing = snap.data() as AppUser;
      const updatesRaw: Partial<AppUser> = { lastLoginAt: nowIso, ...userData };
      const updates: Partial<AppUser> = Object.entries(updatesRaw).reduce((acc, [k, v]) => {
        if (v !== undefined) (acc as any)[k] = v;
        return acc;
      }, {} as Partial<AppUser>);
      await ref.set(updates, { merge: true });
      return { ...existing, ...updates } as AppUser;
    }
  }

  async getUserById(uid: string): Promise<AppUser | null> {
    const ref = admin.firestore().collection('users').doc(uid);
    const snap = await ref.get();
    
    if (!snap.exists) {
      return null;
    }
    
    return snap.data() as AppUser;
  }

  async getUserByEmail(email: string): Promise<{ uid: string; user: AppUser } | null> {
    const col = admin.firestore().collection('users');
    const qs = await col.where('email', '==', email).limit(1).get();
    if (qs.empty) return null;
    const doc = qs.docs[0];
    return { uid: doc.id, user: doc.data() as AppUser };
  }

  async getEmailByUsername(username: string): Promise<string | null> {
    const col = admin.firestore().collection('users');
    const qs = await col.where('username', '==', username).limit(1).get();
    if (qs.empty) return null;
    const data = qs.docs[0].data() as AppUser;
    return data.email || null;
  }

  async updateUser(uid: string, updates: Partial<AppUser>): Promise<AppUser> {
    const ref = admin.firestore().collection('users').doc(uid);
    const cleaned = Object.entries(updates).reduce((acc, [k, v]) => {
      if (v !== undefined) (acc as any)[k] = v;
      return acc;
    }, {} as Partial<AppUser>);
    await ref.set(cleaned, { merge: true });
    
    const snap = await ref.get();
    return snap.data() as AppUser;
  }

  // In-memory OTP store to avoid persisting in Firestore
  private static otpStore: Map<string, { code: string; expiresAt: number }> = new Map();

  async saveOtp(email: string, code: string, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    AuthRepository.otpStore.set(email, { code, expiresAt });
  }

  async verifyAndConsumeOtp(email: string, code: string): Promise<boolean> {
    const record = AuthRepository.otpStore.get(email);
    if (!record) return false;
    if (record.code !== code) return false;
    if (Date.now() > record.expiresAt) return false;
    AuthRepository.otpStore.delete(email);
    return true;
  }
}
