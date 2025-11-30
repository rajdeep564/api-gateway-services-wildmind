# Hardcoded Environment Variables - Complete List

This document lists all hardcoded `process.env.*` usages that should be replaced with the centralized `env` config from `src/config/env.ts`.

## Summary

**Total Files with Hardcoded Env Vars: 10**
**Total Hardcoded Usages: 30+**

---

## Files and Variables to Fix

### 1. `src/app/app.ts`
**Hardcoded Variables:**
- `process.env.NODE_ENV` (Line 18, 25) → Use `env.nodeEnv`
- `process.env.FRONTEND_ORIGIN` (Line 57, 58, 110, 111) → Use `env.frontendOrigin`

**Current Usage:**
```typescript
const isProd = process.env.NODE_ENV === 'production';
const isProdEnv = process.env.NODE_ENV === 'production';
if (process.env.FRONTEND_ORIGIN) {
  const allowHost = new URL(process.env.FRONTEND_ORIGIN).hostname;
}
```

**Should Be:**
```typescript
const isProd = env.nodeEnv === 'production';
const isProdEnv = env.nodeEnv === 'production';
if (env.frontendOrigin) {
  const allowHost = new URL(env.frontendOrigin).hostname;
}
```

---

### 2. `src/middlewares/security.ts`
**Hardcoded Variables:**
- `process.env.NODE_ENV` (Line 13, 55) → Use `env.nodeEnv`
- `process.env.ALLOWED_ORIGINS` (Line 63) → Use `env.allowedOrigins`
- `process.env.FRONTEND_ORIGIN` (Line 63) → Use `env.frontendOrigin`

**Current Usage:**
```typescript
const isDev = process.env.NODE_ENV !== 'production';
const isProd = process.env.NODE_ENV === 'production';
const extra = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_ORIGIN || '')
```

**Should Be:**
```typescript
const isDev = env.nodeEnv !== 'production';
const isProd = env.nodeEnv === 'production';
const extra = env.allowedOrigins.length > 0 ? env.allowedOrigins : (env.frontendOrigin ? [env.frontendOrigin] : []);
```

---

### 3. `src/controllers/auth/authController.ts`
**Hardcoded Variables:**
- `process.env.REVOKE_FIREBASE_TOKENS` (Line 9-10, 126) → **NEEDS TO BE ADDED TO env.ts**
- `process.env.NODE_ENV` (Line 429, 807, 1083) → Use `env.nodeEnv`
- `process.env.COOKIE_DOMAIN` (Line 430, 805, 1082) → Use `env.cookieDomain`

**Current Usage:**
```typescript
const shouldRevokeFirebaseTokens = (process.env.REVOKE_FIREBASE_TOKENS || '').toLowerCase() === 'true';
const isProd = process.env.NODE_ENV === "production";
const cookieDomain = process.env.COOKIE_DOMAIN;
```

**Should Be:**
```typescript
// First add to env.ts: revokeFirebaseTokens: boolean
const shouldRevokeFirebaseTokens = env.revokeFirebaseTokens;
const isProd = env.nodeEnv === "production";
const cookieDomain = env.cookieDomain;
```

---

### 4. `src/routes/authRoutes.ts`
**Hardcoded Variables:**
- `process.env.NODE_ENV` (Line 46, 58, 128) → Use `env.nodeEnv`
- `process.env.COOKIE_DOMAIN` (Line 47, 129) → Use `env.cookieDomain`
- Hardcoded fallback: `'.wildmindai.com'` (Line 129) → Use `env.cookieDomain` or `env.productionDomain`

**Current Usage:**
```typescript
const isProd = process.env.NODE_ENV === 'production';
const cookieDomain = process.env.COOKIE_DOMAIN;
const cookieDomain = process.env.COOKIE_DOMAIN || '.wildmindai.com';
nodeEnv: process.env.NODE_ENV,
```

**Should Be:**
```typescript
const isProd = env.nodeEnv === 'production';
const cookieDomain = env.cookieDomain;
const cookieDomain = env.cookieDomain || (env.productionDomain ? new URL(env.productionDomain).hostname.replace('www.', '.') : undefined);
nodeEnv: env.nodeEnv,
```

---

### 5. `src/services/replicateService.ts`
**Hardcoded Variables:**
- `process.env.REPLICATE_API_TOKEN` (Lines 156, 357, 900, 1629, 1814, 2007) → Use `env.replicateApiKey`

**Current Usage:**
```typescript
const key = ((env as any).replicateApiKey as string) || (process.env.REPLICATE_API_TOKEN as string);
```

**Should Be:**
```typescript
const key = env.replicateApiKey as string;
```

**Note:** `env.replicateApiKey` already handles `REPLICATE_API_TOKEN` as fallback in env.ts, so we can just use `env.replicateApiKey`.

---

### 6. `src/services/reimagineService.ts`
**Hardcoded Variables:**
- `process.env.REPLICATE_API_TOKEN` (Line 155) → Use `env.replicateApiKey`

**Current Usage:**
```typescript
const replicateKey = ((env as any).replicateApiKey as string) || process.env.REPLICATE_API_TOKEN;
```

**Should Be:**
```typescript
const replicateKey = env.replicateApiKey as string;
```

---

### 7. `src/services/auth/authService.ts`
**Hardcoded Variables:**
- `process.env.OTP_EMAIL_AWAIT` (Line 153) → **NEEDS TO BE ADDED TO env.ts**
- `process.env.AWS_LAMBDA_FUNCTION_NAME` (Line 156) → Keep as-is (runtime detection)
- `process.env.VERCEL` (Line 156) → Keep as-is (runtime detection)
- `process.env.DEBUG_OTP` (Line 180) → **NEEDS TO BE ADDED TO env.ts**
- `process.env.NODE_ENV` (Line 180) → Use `env.nodeEnv`
- `process.env.NEXT_PUBLIC_FIREBASE_API_KEY` (Line 346) → Use `env.firebaseApiKey` (already handled)
- `process.env.FIREBASE_WEB_API_KEY` (Line 346) → Use `env.firebaseApiKey` (already handled)

**Current Usage:**
```typescript
const v = String(process.env.OTP_EMAIL_AWAIT || '').toLowerCase();
if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL) return true;
const exposeDebug = String(process.env.DEBUG_OTP || '').toLowerCase() === 'true' || (process.env.NODE_ENV !== 'production');
const firebaseApiKey = env.firebaseApiKey || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || (process as any).env?.FIREBASE_WEB_API_KEY;
```

**Should Be:**
```typescript
// Add to env.ts: otpEmailAwait: boolean, debugOtp: boolean
const v = env.otpEmailAwait;
if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL) return true; // Keep - runtime detection
const exposeDebug = env.debugOtp || env.nodeEnv !== 'production';
const firebaseApiKey = env.firebaseApiKey; // Already handles fallbacks in env.ts
```

---

### 8. `src/config/firebaseAdmin.ts`
**Hardcoded Variables:**
- `process.env.FIREBASE_SERVICE_ACCOUNT_JSON` (Line 4) → **NEEDS TO BE ADDED TO env.ts**
- `process.env.FIREBASE_SERVICE_ACCOUNT_B64` (Line 12) → **NEEDS TO BE ADDED TO env.ts**

**Current Usage:**
```typescript
const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
```

**Should Be:**
```typescript
// Add to env.ts: firebaseServiceAccountJson?: string, firebaseServiceAccountB64?: string
const json = env.firebaseServiceAccountJson;
const b64 = env.firebaseServiceAccountB64;
```

**Note:** This is a special case - these are alternative formats for Firebase service account. The main `firebaseServiceAccount` in env.ts is the JSON string version.

---

### 9. `src/workers/mirrorQueueWorker.ts`
**Hardcoded Variables:**
- `process.env.MIRROR_QUEUE_POLL_INTERVAL_MS` (Line 24) → **NEEDS TO BE ADDED TO env.ts**
- `process.env.MIRROR_QUEUE_CONCURRENCY` (Line 27) → **NEEDS TO BE ADDED TO env.ts**
- `process.env.MIRROR_QUEUE_BATCH_LIMIT` (Line 28) → **NEEDS TO BE ADDED TO env.ts**

**Current Usage:**
```typescript
const POLL_INTERVAL_MS = Number(process.env.MIRROR_QUEUE_POLL_INTERVAL_MS || 2500);
const PROMISE_POOL_SIZE = Number(process.env.MIRROR_QUEUE_CONCURRENCY || 4);
const BATCH_LIMIT = Number(process.env.MIRROR_QUEUE_BATCH_LIMIT || 12);
```

**Should Be:**
```typescript
// Add to env.ts: mirrorQueuePollIntervalMs?: number, mirrorQueueConcurrency?: number, mirrorQueueBatchLimit?: number
const POLL_INTERVAL_MS = env.mirrorQueuePollIntervalMs || 2500;
const PROMISE_POOL_SIZE = env.mirrorQueueConcurrency || 4;
const BATCH_LIMIT = env.mirrorQueueBatchLimit || 12;
```

---

### 10. `src/routes/proxy.ts`
**Hardcoded Variables:**
- `process.env.FFMPEG_MAX_CONCURRENCY` (Line 20) → **NEEDS TO BE ADDED TO env.ts**

**Current Usage:**
```typescript
const FFMPEG_MAX_CONCURRENCY = Math.max(1, parseInt(String(process.env.FFMPEG_MAX_CONCURRENCY || '1'), 10));
```

**Should Be:**
```typescript
// Add to env.ts: ffmpegMaxConcurrency?: number
const FFMPEG_MAX_CONCURRENCY = Math.max(1, env.ffmpegMaxConcurrency || 1);
```

---

### 11. `src/index.ts`
**Hardcoded Variables:**
- `process.env.NODE_ENV` (Line 10) → Use `env.nodeEnv`
- `process.env.GOOGLE_GENAI_API_KEY` (Line 12) → Use `env.googleGenAIApiKey`
- `process.env.GENAI_API_KEY` (Line 13) → Use `env.googleGenAIApiKey` (already handles both)

**Current Usage:**
```typescript
if (process.env.NODE_ENV !== 'production') {
  console.log(`[ENV] GOOGLE_GENAI_API_KEY exists: ${!!process.env.GOOGLE_GENAI_API_KEY}`);
  console.log(`[ENV] GENAI_API_KEY exists: ${!!process.env.GENAI_API_KEY}`);
}
```

**Should Be:**
```typescript
if (env.nodeEnv !== 'production') {
  console.log(`[ENV] GOOGLE_GENAI_API_KEY exists: ${!!env.googleGenAIApiKey}`);
  console.log(`[ENV] GENAI_API_KEY exists: ${!!env.googleGenAIApiKey}`); // Same value, env.ts handles both
}
```

---

## New Variables Needed in `env.ts`

These variables need to be added to the `EnvConfig` interface and `env` object:

1. **`revokeFirebaseTokens: boolean`** - For `REVOKE_FIREBASE_TOKENS`
2. **`otpEmailAwait: boolean`** - For `OTP_EMAIL_AWAIT`
3. **`debugOtp: boolean`** - For `DEBUG_OTP`
4. **`firebaseServiceAccountJson?: string`** - For `FIREBASE_SERVICE_ACCOUNT_JSON`
5. **`firebaseServiceAccountB64?: string`** - For `FIREBASE_SERVICE_ACCOUNT_B64`
6. **`mirrorQueuePollIntervalMs?: number`** - For `MIRROR_QUEUE_POLL_INTERVAL_MS`
7. **`mirrorQueueConcurrency?: number`** - For `MIRROR_QUEUE_CONCURRENCY`
8. **`mirrorQueueBatchLimit?: number`** - For `MIRROR_QUEUE_BATCH_LIMIT`
9. **`ffmpegMaxConcurrency?: number`** - For `FFMPEG_MAX_CONCURRENCY`

---

## Variables That Should Stay as `process.env` (Runtime Detection)

These are runtime environment detection variables that should NOT be moved to env.ts:

- `process.env.AWS_LAMBDA_FUNCTION_NAME` - AWS Lambda runtime detection
- `process.env.VERCEL` - Vercel runtime detection
- `process.env.NGROK_LANGUAGE` - Already handled as fallback in `promptEnhancerUrl`

---

## Summary by Variable

| Variable | Current Usage | Files | Should Use |
|----------|--------------|-------|------------|
| `NODE_ENV` | Direct `process.env` | 6 files | `env.nodeEnv` |
| `FRONTEND_ORIGIN` | Direct `process.env` | 2 files | `env.frontendOrigin` |
| `ALLOWED_ORIGINS` | Direct `process.env` | 1 file | `env.allowedOrigins` |
| `COOKIE_DOMAIN` | Direct `process.env` | 3 files | `env.cookieDomain` |
| `REVOKE_FIREBASE_TOKENS` | Direct `process.env` | 1 file | `env.revokeFirebaseTokens` (NEW) |
| `REPLICATE_API_TOKEN` | Direct `process.env` | 2 files | `env.replicateApiKey` |
| `OTP_EMAIL_AWAIT` | Direct `process.env` | 1 file | `env.otpEmailAwait` (NEW) |
| `DEBUG_OTP` | Direct `process.env` | 1 file | `env.debugOtp` (NEW) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Direct `process.env` | 1 file | `env.firebaseServiceAccountJson` (NEW) |
| `FIREBASE_SERVICE_ACCOUNT_B64` | Direct `process.env` | 1 file | `env.firebaseServiceAccountB64` (NEW) |
| `MIRROR_QUEUE_POLL_INTERVAL_MS` | Direct `process.env` | 1 file | `env.mirrorQueuePollIntervalMs` (NEW) |
| `MIRROR_QUEUE_CONCURRENCY` | Direct `process.env` | 1 file | `env.mirrorQueueConcurrency` (NEW) |
| `MIRROR_QUEUE_BATCH_LIMIT` | Direct `process.env` | 1 file | `env.mirrorQueueBatchLimit` (NEW) |
| `FFMPEG_MAX_CONCURRENCY` | Direct `process.env` | 1 file | `env.ffmpegMaxConcurrency` (NEW) |
| `GOOGLE_GENAI_API_KEY` | Direct `process.env` | 1 file | `env.googleGenAIApiKey` |
| `GENAI_API_KEY` | Direct `process.env` | 1 file | `env.googleGenAIApiKey` |

---

## Next Steps

1. ✅ Review this list
2. Add missing variables to `env.ts`
3. Replace all hardcoded `process.env.*` with `env.*` throughout the codebase
4. Test to ensure all functionality works
5. Update documentation

