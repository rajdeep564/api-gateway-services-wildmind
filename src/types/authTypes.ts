export type ProviderId = 'google' | 'password' | 'github' | 'apple' | 'unknown';

export interface AppUser {
  uid: string;
  email: string;
  username: string;
  photoURL?: string;
  provider: ProviderId;
  createdAt: string; // ISO string
  lastLoginAt: string; // ISO string
}


