import admin from 'firebase-admin';

function getServiceAccountFromEnv(): admin.ServiceAccount | null {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      return JSON.parse(json);
    } catch {
      // ignore
    }
  }
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (b64) {
    try {
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch {
      // ignore
    }
  }
  return null;
}

if (!admin.apps.length) {
  const svc = getServiceAccountFromEnv();
  if (svc) {
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  } else {
    // Fallback to GOOGLE_APPLICATION_CREDENTIALS or metadata if present in environment
    admin.initializeApp();
  }
}

export const adminDb = admin.firestore();
// Safety: ignore undefined properties globally to prevent accidental undefined field writes
try {
  // @ts-ignore - settings is available on Firestore instance
  adminDb.settings({ ignoreUndefinedProperties: true });
} catch {
  // ignore if not supported in this SDK version
}
export { admin };

