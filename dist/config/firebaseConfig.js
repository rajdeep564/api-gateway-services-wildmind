"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = exports.db = void 0;
const app_1 = require("firebase/app");
const firestore_1 = require("firebase/firestore");
const env_1 = require("./env");
// Prefer environment variables; fall back to current values if needed
const firebaseConfig = {
    apiKey: env_1.env.firebaseApiKey || "AIzaSyCRWmkXyPmux_leqANXftfEuVUfpCKRC5c",
    authDomain: env_1.env.firebaseAuthDomain || "api-gateway-wildmind.firebaseapp.com",
    projectId: env_1.env.firebaseProjectId || "api-gateway-wildmind",
    storageBucket: env_1.env.firebaseStorageBucket || "api-gateway-wildmind.firebasestorage.app",
    messagingSenderId: env_1.env.firebaseMessagingSenderId || "150722845597",
    appId: env_1.env.firebaseAppId || "1:150722845597:web:5edaa6b024add658adad74"
};
const app = (0, app_1.getApps)().length ? (0, app_1.getApp)() : (0, app_1.initializeApp)(firebaseConfig);
exports.app = app;
exports.db = (0, firestore_1.getFirestore)(app);
