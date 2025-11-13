// Centralized environment configuration
// Loads .env via index.ts ('dotenv/config') at process start

export interface EnvConfig {
  nodeEnv: string;
  port: number;
  // Firebase
  firebaseApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  firebaseStorageBucket?: string;
  firebaseMessagingSenderId?: string;
  firebaseAppId?: string;
  firebaseServiceAccount?: string;
  // Zata
  zataEndpoint: string;
  zataBucket: string;
  zataRegion: string;
  zataForcePathStyle: boolean;
  zataAccessKeyId: string;
  zataSecretAccessKey: string;
  // Third-party providers
  bflApiKey?: string;
  falKey?: string;
  runwayApiKey?: string;
  minimaxApiKey?: string;
  minimaxGroupId?: string;
  replicateApiKey?: string;
  // Mail
  emailUser?: string;
  emailAppPassword?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  resendApiKey?: string;
  // Logging
  logLevel: string;
  // BFL polling
  bflPollIntervalMs?: number;   
  bflPollMaxLoops?: number;
  reedemCodeAdminKey?: string;
  // Redis
  redisUrl?: string;
  redisPrefix?: string;
  redisDebug: boolean;
  // Auth
  authStrictRevocation: boolean; // when true, verify* checks revocation (slower); default false for speed
  // Local services
  scoreLocal?: string; // base URL for aesthetic scoring service
}

function normalizeBoolean(value: string | undefined, defaultTrue: boolean): boolean {
  if (value == null) return defaultTrue;
  const v = value.toLowerCase();        
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultTrue;
}

export const env: EnvConfig = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5001),
  firebaseApiKey: process.env.FIREBASE_API_KEY,
  firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  firebaseAppId: process.env.FIREBASE_APP_ID,
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
  zataEndpoint: (process.env.ZATA_ENDPOINT || 'https://idr01.zata.ai').replace(/\/$/, ''),
  zataBucket: process.env.ZATA_BUCKET || 'devstoragev1',
  // Many S3-compatible providers accept 'us-east-1'; allow override
  zataRegion: process.env.ZATA_REGION || 'us-east-1',
  zataForcePathStyle: normalizeBoolean(process.env.ZATA_FORCE_PATH_STYLE, true),
  zataAccessKeyId: process.env.ZATA_ACCESS_KEY_ID || '',
  zataSecretAccessKey: process.env.ZATA_SECRET_ACCESS_KEY || '',
  bflApiKey: process.env.BFL_API_KEY,
  falKey: process.env.FAL_KEY,
  runwayApiKey: process.env.RUNWAY_API_KEY,
  minimaxApiKey: process.env.MINIMAX_API_KEY,
  minimaxGroupId: process.env.MINIMAX_GROUP_ID,
  // Accept multiple env names for Replicate for robustness
  replicateApiKey: process.env.REPLICATE_API_KEY || process.env.REPLICATE_API_TOKEN || (process.env as any).RAPLICATE_API_KEY,
  emailUser: process.env.EMAIL_USER,
  emailAppPassword: process.env.EMAIL_APP_PASSWORD,
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  smtpFrom: process.env.SMTP_FROM,
  resendApiKey: process.env.RESEND_API_KEY,
  logLevel: process.env.LOG_LEVEL || 'info',
  bflPollIntervalMs: process.env.BFL_POLL_INTERVAL_MS ? parseInt(process.env.BFL_POLL_INTERVAL_MS, 10) : undefined,
  bflPollMaxLoops: process.env.BFL_POLL_MAX_LOOPS ? parseInt(process.env.BFL_POLL_MAX_LOOPS, 10) : undefined,
  reedemCodeAdminKey: process.env.REDEEM_CODE_ADMIN_KEY,
  // Redis
  redisUrl: process.env.REDIS_URL,
  redisPrefix: process.env.REDIS_PREFIX || 'sess:app:',
  redisDebug: normalizeBoolean(process.env.REDIS_DEBUG, false),
  // Auth
  authStrictRevocation: normalizeBoolean(process.env.AUTH_STRICT_REVOCATION, false),
  // Local services
  scoreLocal: (process.env.SCORE_LOCAL ? String(process.env.SCORE_LOCAL).trim() : undefined)?.replace(/\/$/, ''),
};


