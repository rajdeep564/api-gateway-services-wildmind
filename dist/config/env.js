"use strict";
// Centralized environment configuration
// Loads .env via index.ts ('dotenv/config') at process start
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
function normalizeBoolean(value, defaultTrue) {
    if (value == null)
        return defaultTrue;
    const v = value.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v))
        return true;
    if (['0', 'false', 'no', 'off'].includes(v))
        return false;
    return defaultTrue;
}
exports.env = {
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
    // Accept multiple env names for Replicate for robustness
    replicateApiKey: process.env.REPLICATE_API_KEY || process.env.REPLICATE_API_TOKEN || process.env.RAPLICATE_API_KEY,
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
};
