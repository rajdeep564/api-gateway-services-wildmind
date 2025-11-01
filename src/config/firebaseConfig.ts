import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { env } from './env';

// Prefer environment variables; fall back to current values if needed
const firebaseConfig = {
  apiKey: env.firebaseApiKey || "AIzaSyCRWmkXyPmux_leqANXftfEuVUfpCKRC5c",
  authDomain: env.firebaseAuthDomain || "api-gateway-wildmind.firebaseapp.com",
  projectId: env.firebaseProjectId || "api-gateway-wildmind",
  storageBucket: env.firebaseStorageBucket || "api-gateway-wildmind.firebasestorage.app",
  messagingSenderId: env.firebaseMessagingSenderId || "150722845597",
  appId: env.firebaseAppId || "1:150722845597:web:5edaa6b024add658adad74"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
export { app };