import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Prefer environment variables; fall back to current values if needed
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyCRWmkXyPmux_leqANXftfEuVUfpCKRC5c",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "api-gateway-wildmind.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "api-gateway-wildmind",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "api-gateway-wildmind.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "150722845597",
  appId: process.env.FIREBASE_APP_ID || "1:150722845597:web:5edaa6b024add658adad74"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
export { app };