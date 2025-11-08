"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = void 0;
const firebaseAdmin_1 = require("../../config/firebaseAdmin");
const env_1 = require("../../config/env");
const authRepository_1 = require("../../repository/auth/authRepository"); // Updated with updateUserByEmail
const errorHandler_1 = require("../../utils/errorHandler");
const mailer_1 = require("../../utils/mailer");
function normalizeUsername(input) {
    return (input || '')
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '')
        .slice(0, 30);
}
async function checkUsernameAvailability(username) {
    const normalized = normalizeUsername(username);
    if (!/^[a-z0-9_.-]{3,30}$/.test(normalized)) {
        throw new errorHandler_1.ApiError('Invalid username', 400);
    }
    const existing = await authRepository_1.authRepository.getUserByUsername(normalized);
    const available = !existing;
    let suggestions = undefined;
    if (!available) {
        suggestions = [];
        const base = normalized.replace(/\d+$/, '');
        const nowSuffix = new Date().getFullYear().toString().slice(-2);
        const candidates = [
            `${base}_${Math.floor(Math.random() * 90 + 10)}`,
            `${base}${nowSuffix}`,
            `${base}_${Math.floor(Math.random() * 900 + 100)}`,
            `${base}-app`,
            `${base}_${Math.floor(Math.random() * 9000 + 1000)}`
        ]
            .map(normalizeUsername)
            .filter((c) => /^[a-z0-9_.-]{3,30}$/.test(c));
        for (const candidate of candidates) {
            if (suggestions.length >= 5)
                break;
            const exists = await authRepository_1.authRepository.getUserByUsername(candidate);
            if (!exists && !suggestions.includes(candidate))
                suggestions.push(candidate);
        }
    }
    return { available, normalized, suggestions };
}
async function createSession(idToken) {
    try {
        const decoded = await firebaseAdmin_1.admin.auth().verifyIdToken(idToken, true);
        const user = await upsertUserFromFirebase(decoded);
        return user;
    }
    catch (error) {
        throw new errorHandler_1.ApiError('Invalid token', 401);
    }
}
async function startEmailOtp(email) {
    console.log(`[AUTH] Starting OTP flow for email: ${email}`);
    // Check if user already exists in Firebase Auth
    try {
        const existingUser = await firebaseAdmin_1.admin.auth().getUserByEmail(email);
        console.log(`[AUTH] User already exists in Firebase Auth: ${existingUser.uid}`);
        // Check if user exists with Google provider
        const firestoreUser = await authRepository_1.authRepository.getUserByEmail(email);
        if (firestoreUser && firestoreUser.user.provider === 'google') {
            console.log(`[AUTH] User already signed up with Google, cannot use email/password`);
            throw new errorHandler_1.ApiError('You already have an account with Google. Please sign in with Google instead.', 400);
        }
        // User exists with email/password provider, ask to sign in instead
        throw new errorHandler_1.ApiError('Account already exists. Please use sign-in instead.', 400);
    }
    catch (error) {
        // If user not found, continue with OTP flow
        if (error.code !== 'auth/user-not-found') {
            console.log(`[AUTH] Error checking existing user: ${error.message}`);
            throw error; // Re-throw if it's our custom error or other Firebase error
        }
        console.log(`[AUTH] User not found in Firebase Auth, proceeding with OTP`);
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const ttlSeconds = 60; // OTP valid for 60s
    console.log(`[AUTH] Generated OTP: ${code} for ${email}, TTL: ${ttlSeconds}s`);
    await authRepository_1.authRepository.saveOtp(email, code, ttlSeconds);
    console.log(`[AUTH] OTP saved to memory store`);
    // Fire-and-forget email send to reduce API latency; log result asynchronously
    const emailConfigured = (0, mailer_1.isEmailConfigured)();
    const shouldAwaitEmail = (() => {
        const v = String(process.env.OTP_EMAIL_AWAIT || '').toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(v))
            return true;
        // If running on typical serverless platforms, default to await for reliability
        if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL)
            return true;
        return false;
    })();
    if (shouldAwaitEmail) {
        try {
            await (0, mailer_1.sendEmail)(email, 'Your verification code', `Your OTP code is: ${code}`);
            console.log(`[AUTH] OTP email sent (await) to ${email}`);
        }
        catch (emailError) {
            console.log(`[AUTH] Email send failed (await): ${emailError.message}`);
            // Do not throw: code is already saved; client can retry or use another channel
        }
    }
    else {
        (async () => {
            try {
                await (0, mailer_1.sendEmail)(email, 'Your verification code', `Your OTP code is: ${code}`);
                console.log(`[AUTH] OTP email dispatched (async) to ${email}`);
            }
            catch (emailError) {
                console.log(`[AUTH] Async email send failed: ${emailError.message}`);
            }
        })();
    }
    // Respond and indicate delivery channel (email or console fallback)
    const exposeDebug = String(process.env.DEBUG_OTP || '').toLowerCase() === 'true' || (process.env.NODE_ENV !== 'production');
    return { sent: true, ttl: ttlSeconds, channel: emailConfigured ? 'email' : 'console', ...(exposeDebug ? { debugCode: code } : {}) };
}
async function verifyEmailOtpAndCreateUser(email, username, password, deviceInfo) {
    console.log(`[AUTH] Verifying OTP and creating user for email: ${email}, username: ${username}`);
    const uname = username ? username.toLowerCase() : (email.split('@')[0] || 'user');
    console.log(`[AUTH] Processed username: ${uname}`);
    if (!/^[a-z0-9_.-]{3,30}$/.test(uname)) {
        console.log(`[AUTH] Invalid username format: ${uname}`);
        throw new errorHandler_1.ApiError('Invalid username', 400);
    }
    let firebaseUser;
    let user;
    try {
        const existing = await firebaseAdmin_1.admin.auth().getUserByEmail(email);
        console.log(`[AUTH] Found existing Firebase user: ${existing.uid}`);
        if (password) {
            await firebaseAdmin_1.admin.auth().updateUser(existing.uid, { password, emailVerified: true });
            console.log(`[AUTH] Updated existing user password and email verification`);
        }
        else if (!existing.emailVerified) {
            await firebaseAdmin_1.admin.auth().updateUser(existing.uid, { emailVerified: true });
            console.log(`[AUTH] Marked existing user email as verified`);
        }
        firebaseUser = existing;
        user = await authRepository_1.authRepository.upsertUser(existing.uid, {
            email,
            username: uname.replace(/[^a-z0-9_.-]/g, '').slice(0, 30),
            provider: 'password',
            photoURL: undefined,
            lastLoginIP: deviceInfo?.ip,
            userAgent: deviceInfo?.userAgent,
            deviceInfo: deviceInfo?.deviceInfo
        });
        console.log(`[AUTH] Updated existing user in Firestore: ${user.username}`);
    }
    catch {
        console.log(`[AUTH] Creating new Firebase user for email: ${email}`);
        const created = await firebaseAdmin_1.admin.auth().createUser({ email, emailVerified: true, ...(password ? { password } : {}) });
        console.log(`[AUTH] Created Firebase user with UID: ${created.uid}`);
        firebaseUser = created;
        user = await authRepository_1.authRepository.upsertUser(created.uid, {
            email,
            username: uname.replace(/[^a-z0-9_.-]/g, '').slice(0, 30),
            provider: 'password',
            photoURL: undefined,
            lastLoginIP: deviceInfo?.ip,
            userAgent: deviceInfo?.userAgent,
            deviceInfo: deviceInfo?.deviceInfo
        });
        console.log(`[AUTH] Created new user in Firestore: ${user.username}`);
    }
    // Generate custom token for the user, then convert to ID token
    console.log(`[AUTH] Generating custom token for user: ${firebaseUser.uid}`);
    const customToken = await firebaseAdmin_1.admin.auth().createCustomToken(firebaseUser.uid);
    console.log(`[AUTH] Custom token generated, now converting to ID token...`);
    // Note: Custom token needs to be exchanged for ID token on frontend
    // For now, we'll return the custom token and handle conversion in frontend
    return { user, idToken: customToken };
}
async function getCurrentUser(uid) {
    const user = await authRepository_1.authRepository.getUserById(uid);
    if (!user) {
        throw new errorHandler_1.ApiError('User not found', 404);
    }
    return user;
}
async function updateUser(uid, updates) {
    return await authRepository_1.authRepository.updateUser(uid, updates);
}
async function resolveEmailForLogin(identifier) {
    if (identifier.includes('@'))
        return identifier;
    const email = await authRepository_1.authRepository.getEmailByUsername(identifier.toLowerCase());
    return email;
}
async function upsertUserFromFirebase(decoded) {
    const uid = decoded.uid;
    const email = decoded.email || '';
    const displayName = decoded.name || decoded.displayName;
    const photoURL = decoded.picture;
    const providerId = decoded.firebase?.sign_in_provider || 'unknown';
    const username = (displayName || email.split('@')[0] || 'user')
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '')
        .slice(0, 30) || `user_${uid.slice(0, 6)}`;
    return await authRepository_1.authRepository.upsertUser(uid, {
        email,
        username,
        photoURL,
        provider: providerId
    });
}
async function setUsernameOnly(username, deviceInfo, email) {
    console.log(`[AUTH] Setting username only: ${username} for email: ${email}`);
    if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
        console.log(`[AUTH] Invalid username format: ${username}`);
        throw new errorHandler_1.ApiError('Invalid username', 400);
    }
    if (!email) {
        throw new errorHandler_1.ApiError('Email is required to set username', 400);
    }
    // Find existing user by email and update with username
    console.log(`[AUTH] Finding existing user by email: ${email}`);
    let existingUser = await authRepository_1.authRepository.getUserByEmail(email);
    if (!existingUser) {
        throw new errorHandler_1.ApiError('No existing user found for this email', 400);
    }
    console.log(`[AUTH] Updating existing user with username: ${username}`);
    // Update the existing user with username
    const updatedUser = await authRepository_1.authRepository.updateUserByEmail(email, {
        username: username.toLowerCase(),
        lastLoginIP: deviceInfo?.ip,
        userAgent: deviceInfo?.userAgent,
        deviceInfo: deviceInfo?.deviceInfo
    });
    console.log(`[AUTH] Updated user with username: ${updatedUser.username}`);
    return updatedUser;
}
async function loginWithEmailPassword(email, password, deviceInfo) {
    console.log(`[AUTH] Login attempt for email: ${email}`);
    try {
        // Check if user exists in Firebase Auth
        const firebaseUser = await firebaseAdmin_1.admin.auth().getUserByEmail(email);
        console.log(`[AUTH] Found Firebase user: ${firebaseUser.uid}`);
        // Check if user exists with Google provider
        const firestoreUser = await authRepository_1.authRepository.getUserByEmail(email);
        if (firestoreUser && firestoreUser.user.provider === 'google') {
            console.log(`[AUTH] User already signed up with Google, cannot login with email/password`);
            throw new errorHandler_1.ApiError('You already have an account with Google. Please sign in with Google instead.', 400);
        }
        if (!firebaseUser.emailVerified) {
            console.log(`[AUTH] User email not verified: ${email}`);
            throw new errorHandler_1.ApiError('Email not verified. Please verify your email first.', 400);
        }
        // IMPORTANT: Verify the password by attempting to sign in with Firebase
        // This will fail if the password is wrong or if the user was created without a password (Google users)
        let passwordLoginIdToken;
        try {
            // Use Firebase REST API to verify password since Admin SDK doesn't expose signInWithEmailAndPassword
            const firebaseApiKey = env_1.env.firebaseApiKey || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env?.FIREBASE_WEB_API_KEY;
            if (!firebaseApiKey) {
                // Explicit configuration error so ops can see it; don't mask as credentials issue
                throw new Error('FIREBASE_API_KEY missing (server). Set FIREBASE_API_KEY or NEXT_PUBLIC_FIREBASE_API_KEY');
            }
            const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: email,
                    password: password,
                    returnSecureToken: true
                })
            });
            const result = await response.json();
            if (!response.ok) {
                const code = String(result?.error?.message || '').toUpperCase();
                console.log(`[AUTH] Password verification failed: ${code}`);
                if (code === 'INVALID_LOGIN_CREDENTIALS' || code === 'INVALID_PASSWORD') {
                    throw new errorHandler_1.ApiError('Invalid credentials. Please check your email and password.', 401);
                }
                else if (code === 'EMAIL_NOT_FOUND') {
                    throw new errorHandler_1.ApiError('Invalid credentials. User not found.', 401);
                }
                else if (code === 'MISSING_PASSWORD') {
                    throw new errorHandler_1.ApiError('Password required. Please enter your password.', 401);
                }
                else {
                    // On misconfiguration or unexpected error, surface a generic 500 to avoid UX confusion
                    throw new errorHandler_1.ApiError('Authentication service unavailable. Please try again.', 503);
                }
            }
            console.log(`[AUTH] Password verification successful for: ${email}`);
            // Capture ID token from email/password login for optional immediate session cookie creation
            if (typeof result?.idToken === 'string' && result.idToken.length > 0) {
                passwordLoginIdToken = result.idToken;
            }
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                throw error;
            }
            // If the error is from missing API key, elevate it to 500
            const msg = String(error?.message || '').toLowerCase();
            if (msg.includes('firebase_api_key') || msg.includes('missing')) {
                console.log(`[AUTH] Server configuration error: ${error.message}`);
                throw new errorHandler_1.ApiError('Authentication service misconfigured. Please contact support.', 500);
            }
            console.log(`[AUTH] Password verification error: ${error.message}`);
            throw new errorHandler_1.ApiError('Invalid credentials. Please check your email and password.', 401);
        }
        // Get user from Firestore
        const user = await authRepository_1.authRepository.getUserById(firebaseUser.uid);
        if (!user) {
            console.log(`[AUTH] User not found in Firestore: ${firebaseUser.uid}`);
            throw new errorHandler_1.ApiError('User profile not found. Please complete registration.', 400);
        }
        // Update login tracking
        const updatedUser = await authRepository_1.authRepository.updateUser(firebaseUser.uid, {
            lastLoginAt: new Date().toISOString(),
            loginCount: (user.loginCount || 0) + 1,
            lastLoginIP: deviceInfo?.ip,
            userAgent: deviceInfo?.userAgent,
            deviceInfo: deviceInfo?.deviceInfo
        });
        // Generate custom token (frontend can signInWithCustomToken to sync Firebase client state)
        console.log(`[AUTH] Generating custom token for login: ${firebaseUser.uid}`);
        const customToken = await firebaseAdmin_1.admin.auth().createCustomToken(firebaseUser.uid);
        console.log(`[AUTH] Login successful for: ${email}`);
        return { user: updatedUser, customToken, passwordLoginIdToken };
    }
    catch (error) {
        console.log(`[AUTH] Login failed for ${email}:`, error.message);
        if (error.code === 'auth/user-not-found') {
            throw new errorHandler_1.ApiError('Invalid credentials. User not found.', 401);
        }
        else if (error instanceof errorHandler_1.ApiError) {
            throw error;
        }
        else {
            throw new errorHandler_1.ApiError('Login failed. Please check your credentials.', 401);
        }
    }
}
async function googleSignIn(idToken, deviceInfo) {
    console.log(`[AUTH] Google sign-in attempt`);
    try {
        // Verify Google ID token with Firebase Admin
        const decoded = await firebaseAdmin_1.admin.auth().verifyIdToken(idToken, true);
        console.log(`[AUTH] Google token verified for UID: ${decoded.uid}`);
        const { uid, email, name: displayName, picture: photoURL, email_verified: emailVerified } = decoded;
        if (!email) {
            throw new errorHandler_1.ApiError('Email is required for Google sign-in', 400);
        }
        // Check if user already exists with email/password provider
        const firestoreUser = await authRepository_1.authRepository.getUserByEmail(email);
        if (firestoreUser && firestoreUser.user.provider === 'password') {
            console.log(`[AUTH] User already signed up with email/password, cannot use Google`);
            throw new errorHandler_1.ApiError('You already have an account with email/password. Please sign in with your email and password instead.', 400);
        }
        // Check if user already exists in Firestore
        let existingUser = await authRepository_1.authRepository.getUserById(uid);
        if (existingUser) {
            console.log(`[AUTH] Existing Google user found: ${existingUser.username}`);
            // Update login tracking for existing user
            const updatedUser = await authRepository_1.authRepository.updateUser(uid, {
                lastLoginAt: new Date().toISOString(),
                loginCount: (existingUser.loginCount || 0) + 1,
                lastLoginIP: deviceInfo?.ip,
                userAgent: deviceInfo?.userAgent,
                deviceInfo: deviceInfo?.deviceInfo,
                photoURL: photoURL || existingUser.photoURL
            });
            // Generate session token for existing user
            const sessionToken = await firebaseAdmin_1.admin.auth().createCustomToken(uid);
            return {
                user: updatedUser,
                needsUsername: false,
                sessionToken
            };
        }
        else {
            console.log(`[AUTH] New Google user, creating profile: ${email}`);
            // For Google users without username, use email prefix as collection but mark username as temporary
            const emailPrefix = email.split('@')[0];
            console.log(`[AUTH] Using email prefix as collection: ${emailPrefix}, username will be set later`);
            // Create new user in Firestore using email prefix as collection name
            const newUser = await authRepository_1.authRepository.upsertUser(uid, {
                email,
                username: '', // Empty username - will be set by user
                provider: 'google',
                displayName: displayName || '',
                photoURL: photoURL || '',
                emailVerified: emailVerified || false,
                lastLoginIP: deviceInfo?.ip,
                userAgent: deviceInfo?.userAgent,
                deviceInfo: deviceInfo?.deviceInfo,
                isUsernameTemporary: true // Flag to indicate username needs to be set
            });
            console.log(`[AUTH] New Google user created in email collection, needs username: ${email}`);
            return {
                user: newUser,
                needsUsername: true // Frontend should show username form
            };
        }
    }
    catch (error) {
        console.log(`[AUTH] Google sign-in failed:`, error.message);
        if (error.code === 'auth/id-token-expired') {
            throw new errorHandler_1.ApiError('Google token expired. Please try again.', 401);
        }
        else if (error.code === 'auth/id-token-revoked') {
            throw new errorHandler_1.ApiError('Google token revoked. Please sign in again.', 401);
        }
        else if (error instanceof errorHandler_1.ApiError) {
            throw error;
        }
        else {
            throw new errorHandler_1.ApiError('Google sign-in failed. Please try again.', 401);
        }
    }
}
async function setGoogleUsername(uid, username, deviceInfo) {
    console.log(`[AUTH] Setting username for Google user: ${uid}, username: ${username}`);
    if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
        console.log(`[AUTH] Invalid username format: ${username}`);
        throw new errorHandler_1.ApiError('Invalid username format', 400);
    }
    // Get current user
    const currentUser = await authRepository_1.authRepository.getUserById(uid);
    if (!currentUser) {
        throw new errorHandler_1.ApiError('User not found', 404);
    }
    const newUsername = username.toLowerCase();
    console.log(`[AUTH] Setting username in existing email collection: ${newUsername}`);
    console.log(`[AUTH] Current user data before update:`, currentUser);
    // Simply update the username field in the existing email-based collection
    const updatedUser = await authRepository_1.authRepository.updateUser(uid, {
        username: newUsername,
        isUsernameTemporary: false, // Remove temporary flag
        updatedAt: new Date().toISOString()
    });
    console.log(`[AUTH] Updated user data after username set:`, updatedUser);
    // Generate session token
    const sessionToken = await firebaseAdmin_1.admin.auth().createCustomToken(uid);
    console.log(`[AUTH] Google user username set successfully in email collection: ${newUsername}`);
    return { user: updatedUser, sessionToken };
}
exports.authService = {
    createSession,
    startEmailOtp,
    verifyEmailOtpAndCreateUser,
    setUsernameOnly,
    getCurrentUser,
    updateUser,
    resolveEmailForLogin,
    loginWithEmailPassword,
    googleSignIn,
    setGoogleUsername,
    checkUsernameAvailability
};
