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
  // Mail
  emailUser?: string;
  emailAppPassword?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  // Logging
  logLevel: string;
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
  port: Number(process.env.PORT || 5000),
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
  emailUser: process.env.EMAIL_USER,
  emailAppPassword: process.env.EMAIL_APP_PASSWORD,
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  smtpFrom: process.env.SMTP_FROM,
  logLevel: process.env.LOG_LEVEL || 'info',
};


