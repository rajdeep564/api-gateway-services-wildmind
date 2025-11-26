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

// BUG FIX #13: Maximum concurrent sessions per user
const MAX_CONCURRENT_SESSIONS = 5;

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

/**
 * Get all active sessions for a user
 */
export async function getUserSessions(uid: string): Promise<Array<{ key: string; session: CachedSession }>> {
  try {
    const { getRedisClient } = await import('../config/redisClient');
    const { env } = await import('../config/env');
    const client = getRedisClient();
    if (!client) return [];

    const prefix = env.redisPrefix || 'sess:app:';
    const pattern = `${prefix}*`;
    const keys = await client.keys(pattern);
    
    if (keys.length === 0) return [];

    const userSessions: Array<{ key: string; session: CachedSession }> = [];
    for (const key of keys) {
      try {
        const sessionData = await redisGetSafe<CachedSession>(key);
        if (sessionData?.uid === uid) {
          userSessions.push({ key, session: sessionData });
        }
      } catch {
        continue;
      }
    }

    return userSessions;
  } catch (error) {
    console.warn('[AUTH] Failed to get user sessions (non-fatal):', error);
    return [];
  }
}

/**
 * Invalidate all sessions for a specific user
 * Used when user logs in from a new device to invalidate old sessions
 * BUG FIX #13: Enforces concurrent session limit by removing oldest sessions
 */
export async function invalidateAllUserSessions(uid: string, keepNewest: boolean = false): Promise<void> {
  try {
    const { getRedisClient } = await import('../config/redisClient');
    const { env } = await import('../config/env');
    const client = getRedisClient();
    if (!client) return;

    // Get all sessions for this user
    const userSessions = await getUserSessions(uid);
    
    if (userSessions.length === 0) return;

    // BUG FIX #13: If keeping newest and over limit, remove oldest sessions first
    if (keepNewest && userSessions.length >= MAX_CONCURRENT_SESSIONS) {
      // Sort by issuedAt (oldest first)
      userSessions.sort((a, b) => {
        const aTime = a.session.issuedAt || 0;
        const bTime = b.session.issuedAt || 0;
        return aTime - bTime;
      });
      
      // Remove oldest sessions until under limit
      const toRemove = userSessions.length - (MAX_CONCURRENT_SESSIONS - 1);
      for (let i = 0; i < toRemove; i++) {
        await redisDelSafe(userSessions[i].key);
      }
      
      if (env.redisDebug) {
        console.log('[AUTH][Redis] Removed oldest sessions to enforce limit', { 
          uid, 
          removed: toRemove,
          remaining: userSessions.length - toRemove 
        });
      }
    } else {
      // Delete all sessions for this user
      for (const { key } of userSessions) {
        await redisDelSafe(key);
      }
      
      if (env.redisDebug) {
        console.log('[AUTH][Redis] Invalidated all sessions for user', { uid, count: userSessions.length });
      }
    }
  } catch (error) {
    console.warn('[AUTH] Failed to invalidate all user sessions (non-fatal):', error);
  }
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
