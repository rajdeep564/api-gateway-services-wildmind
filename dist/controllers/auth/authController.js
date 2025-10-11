"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const authService_1 = require("../../services/auth/authService");
const creditsService_1 = require("../../services/creditsService");
const authRepository_1 = require("../../repository/auth/authRepository");
const formatApiResponse_1 = require("../../utils/formatApiResponse");
const errorHandler_1 = require("../../utils/errorHandler");
const deviceInfo_1 = require("../../utils/deviceInfo");
const firebaseAdmin_1 = require("../../config/firebaseAdmin");
require("../../types/http");
async function checkUsername(req, res, next) {
    try {
        const username = String(req.query.username || "");
        const result = await authService_1.authService.checkUsernameAvailability(username);
        res.json((0, formatApiResponse_1.formatApiResponse)("success", "Checked", result));
    }
    catch (error) {
        next(error);
    }
}
async function createSession(req, res, next) {
    try {
        const { idToken } = req.body;
        const user = await authService_1.authService.createSession(idToken);
        // Set session cookie
        await setSessionCookie(res, idToken);
        // Initialize credits for this user (FREE plan on first use)
        try {
            console.log('[CREDITS][createSession] Init start', { uid: user?.uid });
            const init = await creditsService_1.creditsService.ensureUserInit(user.uid);
            console.log('[CREDITS][createSession] Init done', init);
        }
        catch (e) {
            console.error('[CREDITS][createSession] Init error', { uid: user?.uid, err: e?.message });
        }
        res.json((0, formatApiResponse_1.formatApiResponse)("success", "Session created successfully", { user }));
    }
    catch (error) {
        next(error);
    }
}
async function getCurrentUser(req, res, next) {
    try {
        const uid = req.uid;
        let user = await authService_1.authService.getCurrentUser(uid);
        // Capture optional device headers from client
        const deviceId = req.get("x-device-id") || undefined;
        const deviceName = req.get("x-device-name") || undefined;
        const deviceInfoHeader = req.get("x-device-info");
        let deviceInfoHeaderParsed = undefined;
        if (deviceInfoHeader) {
            try {
                deviceInfoHeaderParsed = JSON.parse(deviceInfoHeader);
            }
            catch (_e) {
                deviceInfoHeaderParsed = deviceInfoHeader;
            }
        }
        // Parse baseline device info from User-Agent/IP for observability
        const parsedDevice = (0, deviceInfo_1.extractDeviceInfo)(req);
        console.log("[ME] Device headers:", {
            deviceId,
            deviceName,
            deviceInfoHeaderParsed,
        });
        console.log("[ME] Parsed device from UA:", parsedDevice);
        // Backfill deviceInfo on the user if missing
        const needsBackfill = !user.deviceInfo || !user.deviceInfo.browser;
        if (needsBackfill) {
            try {
                user = await authService_1.authService.updateUser(uid, {
                    deviceInfo: parsedDevice.deviceInfo,
                    lastLoginIP: parsedDevice.ip,
                    userAgent: parsedDevice.userAgent,
                });
            }
            catch (_e) {
                // ignore backfill errors
            }
        }
        // Derive public-generation policy flags from plan (computed, not persisted)
        try {
            const planRaw = String(user?.plan || '').toUpperCase();
            const canToggle = /(^|\b)PLAN\s*C\b/.test(planRaw) || /(^|\b)PLAN\s*D\b/.test(planRaw) || planRaw === 'C' || planRaw === 'D';
            user.canTogglePublicGenerations = canToggle;
            user.forcePublicGenerations = !canToggle;
        }
        catch { }
        res.json((0, formatApiResponse_1.formatApiResponse)("success", "User retrieved successfully", { user }));
    }
    catch (error) {
        next(error);
    }
}
async function updateUser(req, res, next) {
    try {
        const uid = req.uid;
        const updates = req.body;
        const user = await authService_1.authService.updateUser(uid, updates);
        res.json((0, formatApiResponse_1.formatApiResponse)("success", "User updated successfully", { user }));
    }
    catch (error) {
        next(error);
    }
}
async function logout(req, res, next) {
    try {
        clearSessionCookie(res);
        res.json((0, formatApiResponse_1.formatApiResponse)("success", "Logged out successfully", {}));
    }
    catch (error) {
        next(error);
    }
}
async function startEmailOtp(req, res, next) {
    try {
        const { email } = req.body;
        console.log(`[CONTROLLER] Starting OTP for email: ${email}`);
        const result = await authService_1.authService.startEmailOtp(email);
        console.log(`[CONTROLLER] OTP start result:`, result);
        res.json((0, formatApiResponse_1.formatApiResponse)("success", "OTP sent", result));
    }
    catch (error) {
        console.log(`[CONTROLLER] OTP start error:`, error);
        next(error);
    }
}
async function verifyEmailOtp(req, res, next) {
    try {
        const { email, code, password } = req.body;
        console.log(`[CONTROLLER] Verifying OTP - email: ${email}, code: ${code}, hasPassword: ${!!password}`);
        const ok = await authRepository_1.authRepository.verifyAndConsumeOtp(email, code);
        if (!ok) {
            console.log(`[CONTROLLER] OTP verification failed for ${email}`);
            throw new errorHandler_1.ApiError("Invalid or expired OTP", 400);
        }
        console.log(`[CONTROLLER] OTP verified successfully, creating Firebase user and Firestore user...`);
        const deviceInfo = (0, deviceInfo_1.extractDeviceInfo)(req);
        const result = await authService_1.authService.verifyEmailOtpAndCreateUser(email, undefined, password, deviceInfo);
        console.log(`[CONTROLLER] User created and ID token generated`);
        // Initialize credits for the new user
        try {
            console.log('[CREDITS][verifyEmailOtp] Init start', { uid: result.user?.uid });
            const init = await creditsService_1.creditsService.ensureUserInit(result.user.uid);
            console.log('[CREDITS][verifyEmailOtp] Init done', init);
        }
        catch (e) {
            console.error('[CREDITS][verifyEmailOtp] Init error', { uid: result.user?.uid, err: e?.message });
        }
        // Return user data and Firebase custom token
        res.json((0, formatApiResponse_1.formatApiResponse)("success", "OTP verified and user created", {
            user: result.user,
            customToken: result.idToken,
        }));
    }
    catch (error) {
        console.log(`[CONTROLLER] OTP verify error:`, error);
        next(error);
    }
}
async function setEmailUsername(req, res, next) {
    try {
        const { username, email } = req.body;
        const deviceInfo = (0, deviceInfo_1.extractDeviceInfo)(req);
        console.log(`[CONTROLLER] Setting username: ${username} for email: ${email}`);
        console.log(`[CONTROLLER] Device info:`, deviceInfo);
        const user = await authService_1.authService.setUsernameOnly(username, deviceInfo, email);
        console.log(`[CONTROLLER] Username set successfully:`, user);
        res.json((0, formatApiResponse_1.formatApiResponse)("success", "Username set", { user }));
    }
    catch (error) {
        console.log(`[CONTROLLER] Set username error:`, error);
        next(error);
    }
}
async function resolveEmail(req, res, next) {
    try {
        const id = String(req.query.id || "");
        if (!id)
            throw new errorHandler_1.ApiError("Missing id", 400);
        const email = await authService_1.authService.resolveEmailForLogin(id);
        if (!email)
            throw new errorHandler_1.ApiError("Account not found", 404);
        res.json((0, formatApiResponse_1.formatApiResponse)("success", "Resolved", { email }));
    }
    catch (error) {
        next(error);
    }
}
async function setSessionCookie(res, idToken) {
    const isProd = process.env.NODE_ENV === "production";
    const cookieDomain = process.env.COOKIE_DOMAIN; // e.g., .wildmindai.com when API runs on api.wildmindai.com
    const expiresIn = 1000 * 60 * 60 * 24 * 7; // 7 days
    const sessionCookie = await firebaseAdmin_1.admin
        .auth()
        .createSessionCookie(idToken, { expiresIn });
    res.cookie("app_session", sessionCookie, {
        httpOnly: true,
        // Cookies must be Secure when SameSite=None per Chrome requirements
        secure: true,
        sameSite: isProd ? "none" : "lax",
        maxAge: expiresIn,
        path: "/",
        ...(cookieDomain ? { domain: cookieDomain } : {}),
    });
}
function clearSessionCookie(res) {
    const cookieDomain = process.env.COOKIE_DOMAIN; // e.g. .wildmindai.com
    const expired = 'Thu, 01 Jan 1970 00:00:00 GMT';
    const variants = [];
    // SameSite=None; Secure variants
    variants.push(`app_session=; Path=/; Max-Age=0; Expires=${expired}; SameSite=None; Secure`);
    if (cookieDomain)
        variants.push(`app_session=; Domain=${cookieDomain}; Path=/; Max-Age=0; Expires=${expired}; SameSite=None; Secure`);
    // SameSite=Lax variants (older cookies)
    variants.push(`app_session=; Path=/; Max-Age=0; Expires=${expired}; SameSite=Lax`);
    if (cookieDomain)
        variants.push(`app_session=; Domain=${cookieDomain}; Path=/; Max-Age=0; Expires=${expired}; SameSite=Lax`);
    // Also clear auth_hint if present
    variants.push(`auth_hint=; Path=/; Max-Age=0; Expires=${expired}; SameSite=Lax`);
    if (cookieDomain)
        variants.push(`auth_hint=; Domain=${cookieDomain}; Path=/; Max-Age=0; Expires=${expired}; SameSite=Lax`);
    res.setHeader('Set-Cookie', variants);
}
async function loginWithEmailPassword(req, res, next) {
    try {
        const { email, password } = req.body;
        console.log(`[CONTROLLER] Login attempt - email: ${email}`);
        const deviceInfo = (0, deviceInfo_1.extractDeviceInfo)(req);
        const result = await authService_1.authService.loginWithEmailPassword(email, password, deviceInfo);
        console.log(`[CONTROLLER] Login successful for: ${email}`);
        try {
            console.log('[CREDITS][loginEmail] Init start', { uid: result.user?.uid });
            const init = await creditsService_1.creditsService.ensureUserInit(result.user.uid);
            console.log('[CREDITS][loginEmail] Init done', init);
        }
        catch (e) {
            console.error('[CREDITS][loginEmail] Init error', { uid: result.user?.uid, err: e?.message });
        }
        // Return user data and custom token (frontend will convert to ID token)
        res.json((0, formatApiResponse_1.formatApiResponse)("success", "Login successful", {
            user: result.user,
            customToken: result.idToken,
        }));
    }
    catch (error) {
        console.log(`[CONTROLLER] Login error:`, error);
        next(error);
    }
}
async function googleSignIn(req, res, next) {
    try {
        const { idToken } = req.body;
        console.log(`[CONTROLLER] Google sign-in request`);
        const deviceInfo = (0, deviceInfo_1.extractDeviceInfo)(req);
        const result = await authService_1.authService.googleSignIn(idToken, deviceInfo);
        console.log(`[CONTROLLER] Google sign-in result - needsUsername: ${result.needsUsername}`);
        if (result.needsUsername) {
            // Initialize credits even if username is pending
            try {
                console.log('[CREDITS][googleSignIn:needsUsername] Init start', { uid: result.user?.uid });
                const init = await creditsService_1.creditsService.ensureUserInit(result.user.uid);
                console.log('[CREDITS][googleSignIn:needsUsername] Init done', init);
            }
            catch (e) {
                console.error('[CREDITS][googleSignIn:needsUsername] Init error', { uid: result.user?.uid, err: e?.message });
            }
            // New user needs to set username
            res.json((0, formatApiResponse_1.formatApiResponse)("success", "Google account verified. Please set username.", {
                user: result.user,
                needsUsername: true,
            }));
        }
        else {
            // Existing user, return custom token for session creation on client
            try {
                console.log('[CREDITS][googleSignIn:existing] Init start', { uid: result.user?.uid });
                const init = await creditsService_1.creditsService.ensureUserInit(result.user.uid);
                console.log('[CREDITS][googleSignIn:existing] Init done', init);
            }
            catch (e) {
                console.error('[CREDITS][googleSignIn:existing] Init error', { uid: result.user?.uid, err: e?.message });
            }
            res.json((0, formatApiResponse_1.formatApiResponse)("success", "Google sign-in successful", {
                user: result.user,
                needsUsername: false,
                customToken: result.sessionToken,
            }));
        }
    }
    catch (error) {
        console.log(`[CONTROLLER] Google sign-in error:`, error);
        next(error);
    }
}
async function setGoogleUsername(req, res, next) {
    try {
        const { uid, username } = req.body;
        console.log(`[CONTROLLER] Setting Google username - UID: ${uid}, username: ${username}`);
        const deviceInfo = (0, deviceInfo_1.extractDeviceInfo)(req);
        const result = await authService_1.authService.setGoogleUsername(uid, username, deviceInfo);
        console.log(`[CONTROLLER] Google username set successfully`);
        try {
            console.log('[CREDITS][setGoogleUsername] Init start', { uid: result.user?.uid });
            const init = await creditsService_1.creditsService.ensureUserInit(result.user.uid);
            console.log('[CREDITS][setGoogleUsername] Init done', init);
        }
        catch (e) {
            console.error('[CREDITS][setGoogleUsername] Init error', { uid: result.user?.uid, err: e?.message });
        }
        res.json((0, formatApiResponse_1.formatApiResponse)("success", "Username set successfully", {
            user: result.user,
            customToken: result.sessionToken,
        }));
    }
    catch (error) {
        console.log(`[CONTROLLER] Set Google username error:`, error);
        next(error);
    }
}
exports.authController = {
    createSession,
    getCurrentUser,
    updateUser,
    logout,
    startEmailOtp,
    verifyEmailOtp,
    setEmailUsername,
    resolveEmail,
    loginWithEmailPassword,
    googleSignIn,
    setGoogleUsername,
    checkUsername,
};
