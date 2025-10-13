"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
const errorHandler_1 = require("../utils/errorHandler");
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
        // Prefer verifying as a session cookie; fallback to ID token if needed
        let decoded;
        try {
            decoded = await firebaseAdmin_1.admin.auth().verifySessionCookie(token, true);
            console.log("decoded", decoded);
        }
        catch (_e) {
            decoded = await firebaseAdmin_1.admin.auth().verifyIdToken(token, true);
        }
        req.uid = decoded.uid;
        return next();
    }
    catch (error) {
        if (error instanceof errorHandler_1.ApiError) {
            return next(error);
        }
        return next(new errorHandler_1.ApiError('Unauthorized - Invalid token', 401));
    }
}
