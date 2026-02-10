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
  firebaseServiceAccountJson?: string; // Alternative: JSON string format
  firebaseServiceAccountB64?: string; // Alternative: Base64 encoded format
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
  googleGenAIApiKey?: string;
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
  revokeFirebaseTokens: boolean; // when true, revoke all Firebase tokens on login
  cookieDomain?: string;
  frontendOrigin?: string; // Single URL or comma-separated list of URLs
  frontendOrigins: string[]; // Parsed array from frontendOrigin (comma-separated)
  allowedOrigins: string[];
  otpEmailAwait: boolean; // when true, await email sending before responding
  debugOtp: boolean; // when true, expose OTP codes in response (dev only)
  // Local services
  scoreLocal?: string; // base URL for aesthetic scoring service
  promptEnhancerUrl?: string; // base URL for prompt enhancer service (Python FastAPI)
  wildmindImageServiceUrl?: string; // base URL for WILDMINDIMAGE Python service (ngrok)
  // API Base URLs
  minimaxApiBase?: string; // MiniMax API base URL
  resendApiBase?: string; // Resend API base URL
  falQueueBase?: string; // FAL queue API base URL
  firebaseAuthApiBase?: string; // Firebase Auth API base URL
  // Zata Storage
  zataPrefix: string; // Zata storage prefix URL
  // SMTP Configuration
  gmailSmtpHost?: string; // Gmail SMTP host
  gmailSmtpPort?: number; // Gmail SMTP port
  // Frontend Domains
  productionDomain?: string; // Production domain (e.g., wildmindai.com)
  productionWwwDomain?: string; // Production www domain (e.g., www.wildmindai.com)
  productionStudioDomain?: string; // Production studio domain (e.g., studio.wildmindai.com)
  // Development URLs
  devFrontendUrl?: string; // Development frontend URL (e.g., http://localhost:3000)
  devCanvasUrl?: string; // Development canvas URL (e.g., http://localhost:3001)
  devBackendUrl?: string; // Development backend URL (e.g., http://localhost:5001)
  // External Services
  bflApiBase?: string; // BFL API base URL
  apiGatewayUrl?: string; // API Gateway URL
  disposableEmailDomainsUrl?: string; // Disposable email domains list URL
  // Worker Configuration
  mirrorQueuePollIntervalMs?: number; // Mirror queue polling interval in ms
  mirrorQueueConcurrency?: number; // Mirror queue concurrent workers
  mirrorQueueBatchLimit?: number; // Mirror queue batch size limit
  // Media Processing
  ffmpegMaxConcurrency?: number; // FFmpeg max concurrent operations
}

function normalizeBoolean(value: string | undefined, defaultTrue: boolean): boolean {
  if (value == null) return defaultTrue;
  const v = value.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultTrue;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  // Remove surrounding quotes from the whole string first
  const cleanValue = value.replace(/^["']|["']$/g, '');
  return cleanValue.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
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
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  firebaseServiceAccountB64: process.env.FIREBASE_SERVICE_ACCOUNT_B64,
  zataEndpoint: (process.env.ZATA_ENDPOINT || '').replace(/\/$/, ''),
  zataBucket: process.env.ZATA_BUCKET || '',
  zataRegion: process.env.ZATA_REGION || '',
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
  googleGenAIApiKey: process.env.GOOGLE_GENAI_API_KEY || process.env.GENAI_API_KEY || process.env.GEMINI_API_KEY,
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
  revokeFirebaseTokens: normalizeBoolean(process.env.REVOKE_FIREBASE_TOKENS, false),
  cookieDomain: process.env.COOKIE_DOMAIN,
  frontendOrigin: process.env.FRONTEND_ORIGIN || process.env.FRONTEND_URL,
  frontendOrigins: parseList(process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || process.env.FRONTEND_URL),
  allowedOrigins: parseList(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS),
  otpEmailAwait: normalizeBoolean(process.env.OTP_EMAIL_AWAIT, false),
  debugOtp: normalizeBoolean(process.env.DEBUG_OTP, false),
  // Local services
  scoreLocal: (process.env.SCORE_LOCAL ? String(process.env.SCORE_LOCAL).trim() : undefined)?.replace(/\/$/, ''),
  promptEnhancerUrl: (process.env.PROMPT_ENHANCER_URL || process.env.NGROK_LANGUAGE)?.replace(/\/$/, ''),
  wildmindImageServiceUrl: (process.env.WILDMINDIMAGE_URL || 'https://ac38194cdfc0.ngrok-free.app')?.replace(/\/$/, ''),
  // API Base URLs
  minimaxApiBase: process.env.MINIMAX_API_BASE || 'https://api.minimax.io/v1',
  resendApiBase: process.env.RESEND_API_BASE || 'https://api.resend.com',
  falQueueBase: process.env.FAL_QUEUE_BASE || 'https://queue.fal.run',
  firebaseAuthApiBase: process.env.FIREBASE_AUTH_API_BASE || 'https://identitytoolkit.googleapis.com/v1',
  // Zata Storage
  zataPrefix: process.env.ZATA_PREFIX || process.env.NEXT_PUBLIC_ZATA_PREFIX || 'https://idr01.zata.ai/devstoragev1/',
  // SMTP Configuration
  gmailSmtpHost: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com',
  gmailSmtpPort: process.env.GMAIL_SMTP_PORT ? parseInt(process.env.GMAIL_SMTP_PORT, 10) : 465,
  // Frontend Domains
  productionDomain: process.env.PRODUCTION_DOMAIN || 'https://wildmindai.com',
  productionWwwDomain: process.env.PRODUCTION_WWW_DOMAIN || 'https://www.wildmindai.com',
  productionStudioDomain: process.env.PRODUCTION_STUDIO_DOMAIN || 'https://studio.wildmindai.com',
  // Development URLs
  devFrontendUrl: process.env.DEV_FRONTEND_URL || 'http://localhost:3000',
  devCanvasUrl: process.env.DEV_CANVAS_URL || 'http://localhost:3001',
  devBackendUrl: process.env.DEV_BACKEND_URL || 'http://localhost:5001',
  // External Services
  bflApiBase: process.env.BFL_API_BASE || 'https://api.bfl.ai',
  apiGatewayUrl: process.env.API_GATEWAY_URL,
  disposableEmailDomainsUrl: process.env.DISPOSABLE_EMAIL_DOMAINS_URL || 'https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.json',
  // Worker Configuration
  mirrorQueuePollIntervalMs: process.env.MIRROR_QUEUE_POLL_INTERVAL_MS ? parseInt(process.env.MIRROR_QUEUE_POLL_INTERVAL_MS, 10) : undefined,
  mirrorQueueConcurrency: process.env.MIRROR_QUEUE_CONCURRENCY ? parseInt(process.env.MIRROR_QUEUE_CONCURRENCY, 10) : undefined,
  mirrorQueueBatchLimit: process.env.MIRROR_QUEUE_BATCH_LIMIT ? parseInt(process.env.MIRROR_QUEUE_BATCH_LIMIT, 10) : undefined,
  // Media Processing
  ffmpegMaxConcurrency: process.env.FFMPEG_MAX_CONCURRENCY ? parseInt(process.env.FFMPEG_MAX_CONCURRENCY, 10) : undefined,
};




