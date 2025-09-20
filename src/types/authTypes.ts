export type ProviderId = 'google' | 'password' | 'github' | 'apple' | 'username' | 'unknown';

export interface AppUser {
  uid: string;
  email: string;
  username: string;
  displayName?: string;
  photoURL?: string;
  provider: ProviderId;
  emailVerified: boolean;
  isActive: boolean;
  createdAt: string; // ISO string
  lastLoginAt: string; // ISO string
  loginCount: number;
  lastLoginIP?: string;
  userAgent?: string;
  deviceInfo?: {
    browser?: string;
    os?: string;
    device?: string;
  };
  preferences?: {
    theme?: 'light' | 'dark';
    language?: string;
    timezone?: string;
  };
  metadata?: {
    lastPasswordChange?: string;
    accountStatus: 'active' | 'suspended' | 'pending';
    roles?: string[];
  };
  isUsernameTemporary?: boolean; // For Google users who haven't set username yet
  updatedAt?: string; // ISO string
}


