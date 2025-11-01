import { createClient, RedisClientType } from 'redis';
import { env } from './env';

let client: RedisClientType | null = null;
let lastErrorLog = 0;
const ERROR_THROTTLE_MS = 30000; // log at most once every 30s

export function isRedisEnabled(): boolean {
  return Boolean(env.redisUrl);
}

export function getRedisClient(): RedisClientType | null {
  // Only initialize if explicitly configured
  if (!env.redisUrl) return null;
  if (client) return client;
  client = createClient({ url: env.redisUrl });
  if (env.redisDebug) {
    // eslint-disable-next-line no-console
    console.log('[Redis] Creating client', { url: env.redisUrl, prefix: env.redisPrefix });
  }
  client.on('error', (err: unknown) => {
    const now = Date.now();
    if (now - lastErrorLog > ERROR_THROTTLE_MS) {
      lastErrorLog = now;
      // eslint-disable-next-line no-console
      console.error('[Redis] Client error:', (err as any)?.message || err);
    }
  });
  // Best-effort connect, do not crash app if redis is not available
  client
    .connect()
    .then(() => {
      if (env.redisDebug) {
        // eslint-disable-next-line no-console
        console.log('[Redis] Connected');
      }
    })
    .catch((e: unknown) => {
    const now = Date.now();
    if (now - lastErrorLog > ERROR_THROTTLE_MS) {
      lastErrorLog = now;
      // eslint-disable-next-line no-console
      console.warn('[Redis] Connect failed (continuing without cache):', (e as any)?.message || e);
    }
  });
  return client;
}

export async function redisSetSafe(key: string, value: any, ttlSeconds?: number): Promise<void> {
  if (!env.redisUrl) return; // disabled
  try {
    const c = getRedisClient();
    if (!c) return;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await c.set(key, serialized, { EX: ttlSeconds });
    } else {
      await c.set(key, serialized);
    }
    if (env.redisDebug) {
      // eslint-disable-next-line no-console
      console.log('[Redis][SET]', { key, ttlSeconds: ttlSeconds ?? null, bytes: serialized.length });
    }
  } catch {
    // swallow: non-fatal cache failure
  }
}

export async function redisGetSafe<T = any>(key: string): Promise<T | null> {
  if (!env.redisUrl) return null; // disabled
  try {
    const c = getRedisClient();
    if (!c) return null;
    const val = await c.get(key);
    if (env.redisDebug) {
      // eslint-disable-next-line no-console
      console.log('[Redis][GET]', { key, hit: Boolean(val), bytes: val ? val.length : 0 });
    }
    if (!val) return null;
    try {
      return JSON.parse(val) as T;
    } catch {
      return val as any as T;
    }
  } catch {
    return null;
  }
}

export async function redisDelSafe(key: string): Promise<void> {
  if (!env.redisUrl) return; // disabled
  try {
    const c = getRedisClient();
    if (!c) return;
    await c.del(key);
    if (env.redisDebug) {
      // eslint-disable-next-line no-console
      console.log('[Redis][DEL]', { key });
    }
  } catch {
    // swallow
  }
}
