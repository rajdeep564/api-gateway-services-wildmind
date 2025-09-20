import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

if (!admin.apps.length) {
  // 1) Try local JSON in src/config/credentials/service-account.json
  const localJsonPath = path.resolve(__dirname, './credentials/service-account.json');
  if (fs.existsSync(localJsonPath)) {
    const raw = fs.readFileSync(localJsonPath, 'utf8');
    const svc = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(svc as admin.ServiceAccount) });
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // 2) Try env JSON string
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(svc as admin.ServiceAccount) });
  } else {
    // 3) Fallback to GOOGLE_APPLICATION_CREDENTIALS / default creds
    admin.initializeApp();
  }
}

export const adminDb = admin.firestore();
export { admin };


