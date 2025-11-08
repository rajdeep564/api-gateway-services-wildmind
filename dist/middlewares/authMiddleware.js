"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
const errorHandler_1 = require("../utils/errorHandler");
const sessionStore_1 = require("../utils/sessionStore");
const env_1 = require("../config/env");
const COOKIE_NAME = 'app_session';
async function requireAuth(req, res, next) {
    try {
        console.log("cookies", req.cookies);
        let token = req.cookies?.[COOKIE_NAME];
        // Fallback to Authorization: Bearer <token>
        if (!token) {
            const authHeader = req.headers.authorization || req.headers.Authorization;
            if (authHeader && /^Bearer\s+/i.test(authHeader)) {
                token = authHeader.replace(/^Bearer\s+/i, '').trim();
            }
        }
        if (!token)
            throw new errorHandler_1.ApiError('Unauthorized - No session token', 401);
        // Try Redis cache first to avoid repeated verifies
        const cached = await (0, sessionStore_1.getCachedSession)(token);
        if (cached?.uid) {
            if (env_1.env.redisDebug) {
                // eslint-disable-next-line no-console
                console.log('[AUTH][Redis] HIT', { uid: cached.uid });
            }
            req.uid = cached.uid;
            return next();
        }
        if (env_1.env.redisDebug) {
            // eslint-disable-next-line no-console
            console.log('[AUTH][Redis] MISS');
        }
        // Prefer verifying as a session cookie; fallback to ID token if needed
        let decoded;
        let isSessionCookie = true;
        try {
            // checkRevoked is controlled via env for performance
            decoded = await firebaseAdmin_1.admin.auth().verifySessionCookie(token, env_1.env.authStrictRevocation);
            console.log("decoded(session)", decoded);
        }
        catch (_e) {
            isSessionCookie = false;
            decoded = await firebaseAdmin_1.admin.auth().verifyIdToken(token, env_1.env.authStrictRevocation);
            console.log("decoded(idToken)", decoded);
        }
        req.uid = decoded.uid;
        // Cache in Redis with TTL derived from token exp
        try {
            const exp = typeof decoded?.exp === 'number' ? decoded.exp : undefined;
            await (0, sessionStore_1.cacheSession)(token, { uid: decoded.uid, exp, issuedAt: decoded?.iat, userAgent: req.get('user-agent') || undefined, ip: req.ip });
            if (env_1.env.redisDebug) {
                // eslint-disable-next-line no-console
                console.log('[AUTH][Redis] SET', { uid: decoded.uid, exp });
            }
        }
        catch { }
        return next();
    }
    catch (error) {
        if (error instanceof errorHandler_1.ApiError) {
            return next(error);
        }
        return next(new errorHandler_1.ApiError('Unauthorized - Invalid token', 401));
    }
}
