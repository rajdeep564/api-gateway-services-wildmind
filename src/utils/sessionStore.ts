import crypto from 'crypto';
import { redisDelSafe, redisGetSafe, redisSetSafe } from '../config/redisClient';
import { env } from '../config/env';

export interface CachedSession {
  uid: string;
  issuedAt?: number; // seconds since epoch
  exp?: number; // seconds since epoch
  userAgent?: string;
  ip?: string;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function keyForToken(token: string): string {
  const prefix = env.redisPrefix || 'sess:app:';
  return `${prefix}${hashToken(token)}`;
}

export async function cacheSession(token: string, session: CachedSession): Promise<void> {
  // Compute TTL from exp if available
  let ttlSec: number | undefined;
  if (session.exp) {
    const nowSec = Math.floor(Date.now() / 1000);
    ttlSec = Math.max(1, session.exp - nowSec);
  }
  const key = keyForToken(token);
  await redisSetSafe(key, session, ttlSec);
}

export async function getCachedSession(token: string): Promise<CachedSession | null> {
  const key = keyForToken(token);
  return await redisGetSafe<CachedSession>(key);
}

export async function deleteCachedSession(token: string): Promise<void> {
  const key = keyForToken(token);
  await redisDelSafe(key);
}

// Decode JWT payload without verifying signature to read 'exp' (base64url)
export function decodeJwtPayload<T = any>(jwt: string): T | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}
