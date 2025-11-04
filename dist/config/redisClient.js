"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRedisEnabled = isRedisEnabled;
exports.getRedisClient = getRedisClient;
exports.redisSetSafe = redisSetSafe;
exports.redisGetSafe = redisGetSafe;
exports.redisDelSafe = redisDelSafe;
const redis_1 = require("redis");
const env_1 = require("./env");
let client = null;
let lastErrorLog = 0;
const ERROR_THROTTLE_MS = 30000; // log at most once every 30s
function isRedisEnabled() {
    return Boolean(env_1.env.redisUrl);
}
function getRedisClient() {
    // Only initialize if explicitly configured
    if (!env_1.env.redisUrl)
        return null;
    if (client)
        return client;
    client = (0, redis_1.createClient)({ url: env_1.env.redisUrl });
    if (env_1.env.redisDebug) {
        // eslint-disable-next-line no-console
        console.log('[Redis] Creating client', { url: env_1.env.redisUrl, prefix: env_1.env.redisPrefix });
    }
    client.on('error', (err) => {
        const now = Date.now();
        if (now - lastErrorLog > ERROR_THROTTLE_MS) {
            lastErrorLog = now;
            // eslint-disable-next-line no-console
            console.error('[Redis] Client error:', err?.message || err);
        }
    });
    // Best-effort connect, do not crash app if redis is not available
    client
        .connect()
        .then(() => {
        if (env_1.env.redisDebug) {
            // eslint-disable-next-line no-console
            console.log('[Redis] Connected');
        }
    })
        .catch((e) => {
        const now = Date.now();
        if (now - lastErrorLog > ERROR_THROTTLE_MS) {
            lastErrorLog = now;
            // eslint-disable-next-line no-console
            console.warn('[Redis] Connect failed (continuing without cache):', e?.message || e);
        }
    });
    return client;
}
async function redisSetSafe(key, value, ttlSeconds) {
    if (!env_1.env.redisUrl)
        return; // disabled
    try {
        const c = getRedisClient();
        if (!c)
            return;
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        if (ttlSeconds && ttlSeconds > 0) {
            await c.set(key, serialized, { EX: ttlSeconds });
        }
        else {
            await c.set(key, serialized);
        }
        if (env_1.env.redisDebug) {
            // eslint-disable-next-line no-console
            console.log('[Redis][SET]', { key, ttlSeconds: ttlSeconds ?? null, bytes: serialized.length });
        }
    }
    catch {
        // swallow: non-fatal cache failure
    }
}
async function redisGetSafe(key) {
    if (!env_1.env.redisUrl)
        return null; // disabled
    try {
        const c = getRedisClient();
        if (!c)
            return null;
        const val = await c.get(key);
        if (env_1.env.redisDebug) {
            // eslint-disable-next-line no-console
            console.log('[Redis][GET]', { key, hit: Boolean(val), bytes: val ? val.length : 0 });
        }
        if (!val)
            return null;
        try {
            return JSON.parse(val);
        }
        catch {
            return val;
        }
    }
    catch {
        return null;
    }
}
async function redisDelSafe(key) {
    if (!env_1.env.redisUrl)
        return; // disabled
    try {
        const c = getRedisClient();
        if (!c)
            return;
        await c.del(key);
        if (env_1.env.redisDebug) {
            // eslint-disable-next-line no-console
            console.log('[Redis][DEL]', { key });
        }
    }
    catch {
        // swallow
    }
}
