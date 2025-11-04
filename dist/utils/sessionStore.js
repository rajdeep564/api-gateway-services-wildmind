"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheSession = cacheSession;
exports.getCachedSession = getCachedSession;
exports.deleteCachedSession = deleteCachedSession;
exports.decodeJwtPayload = decodeJwtPayload;
const crypto_1 = __importDefault(require("crypto"));
const redisClient_1 = require("../config/redisClient");
const env_1 = require("../config/env");
function hashToken(token) {
    return crypto_1.default.createHash('sha256').update(token).digest('hex');
}
function keyForToken(token) {
    const prefix = env_1.env.redisPrefix || 'sess:app:';
    return `${prefix}${hashToken(token)}`;
}
async function cacheSession(token, session) {
    // Compute TTL from exp if available
    let ttlSec;
    if (session.exp) {
        const nowSec = Math.floor(Date.now() / 1000);
        ttlSec = Math.max(1, session.exp - nowSec);
    }
    const key = keyForToken(token);
    await (0, redisClient_1.redisSetSafe)(key, session, ttlSec);
}
async function getCachedSession(token) {
    const key = keyForToken(token);
    return await (0, redisClient_1.redisGetSafe)(key);
}
async function deleteCachedSession(token) {
    const key = keyForToken(token);
    await (0, redisClient_1.redisDelSafe)(key);
}
// Decode JWT payload without verifying signature to read 'exp' (base64url)
function decodeJwtPayload(jwt) {
    try {
        const parts = jwt.split('.');
        if (parts.length !== 3)
            return null;
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const json = Buffer.from(padded, 'base64').toString('utf8');
        return JSON.parse(json);
    }
    catch {
        return null;
    }
}
