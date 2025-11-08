"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.admin = exports.adminDb = void 0;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
exports.admin = firebase_admin_1.default;
function getServiceAccountFromEnv() {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (json) {
        try {
            return JSON.parse(json);
        }
        catch {
            // ignore
        }
    }
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
    if (b64) {
        try {
            const decoded = Buffer.from(b64, 'base64').toString('utf8');
            return JSON.parse(decoded);
        }
        catch {
            // ignore
        }
    }
    return null;
}
if (!firebase_admin_1.default.apps.length) {
    const svc = getServiceAccountFromEnv();
    if (svc) {
        firebase_admin_1.default.initializeApp({ credential: firebase_admin_1.default.credential.cert(svc) });
    }
    else {
        // Fallback to GOOGLE_APPLICATION_CREDENTIALS or metadata if present in environment
        firebase_admin_1.default.initializeApp();
    }
}
exports.adminDb = firebase_admin_1.default.firestore();
