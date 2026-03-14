import { admin } from "../../config/firebaseAdmin";
import { env, getAppBaseUrl, resolveSafeAppBaseUrl } from "../../config/env";
import { authRepository } from "../../repository/auth/authRepository"; // Updated with updateUserByEmail
import { AppUser, ProviderId } from "../../types/authTypes";
import { ApiError } from "../../utils/errorHandler";
import { validateEmail } from "../../utils/emailValidator";
import { sendEmail, isEmailConfigured } from "../../utils/mailer";
import {
  appendPasswordHistory,
  doesPasswordMatchHistory,
  getPasswordHistoryLimit,
} from "../../utils/passwordHistory";
import {
  generateOTPEmailHTML,
  generateOTPEmailText,
  generatePasswordResetEmailHTML,
  generatePasswordResetEmailText,
  generatePasswordResetSuccessEmailHTML,
  generatePasswordResetSuccessEmailText,
  generateWelcomeEmailHTML,
  generateWelcomeEmailText,
} from "../../utils/emailTemplates";

function normalizeUsername(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, 30);
}

function normalizeForPasswordComparison(input?: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function passwordContainsUsername(password?: string, username?: string): boolean {
  const normalizedUsername = normalizeForPasswordComparison(username);
  if (normalizedUsername.length < 3) {
    return false;
  }

  return normalizeForPasswordComparison(password).includes(normalizedUsername);
}

async function checkUsernameAvailability(
  username: string,
): Promise<{ available: boolean; normalized: string; suggestions?: string[] }> {
  const normalized = normalizeUsername(username);

  if (!/^[a-z0-9_.-]{3,30}$/.test(normalized)) {
    throw new ApiError("Invalid username", 400);
  }

  const existing = await authRepository.getUserByUsername(normalized);
  const available = !existing;

  let suggestions: string[] | undefined = undefined;
  if (!available) {
    suggestions = [];
    const base = normalized.replace(/\d+$/, "");
    const nowSuffix = new Date().getFullYear().toString().slice(-2);
    const candidates: string[] = [
      `${base}_${Math.floor(Math.random() * 90 + 10)}`,
      `${base}${nowSuffix}`,
      `${base}_${Math.floor(Math.random() * 900 + 100)}`,
      `${base}-app`,
      `${base}_${Math.floor(Math.random() * 9000 + 1000)}`,
    ]
      .map(normalizeUsername)
      .filter((c) => /^[a-z0-9_.-]{3,30}$/.test(c));

    for (const candidate of candidates) {
      if (suggestions.length >= 5) break;
      const exists = await authRepository.getUserByUsername(candidate);
      if (!exists && !suggestions.includes(candidate))
        suggestions.push(candidate);
    }
  }

  return { available, normalized, suggestions };
}

async function createSession(idToken: string): Promise<AppUser> {
  console.log("[AUTH][authService.createSession] ========== START ==========");
  console.log("[AUTH][authService.createSession] Function called", {
    hasIdToken: !!idToken,
    idTokenLength: idToken?.length || 0,
    idTokenPrefix: idToken?.substring(0, 30) || "N/A",
    timestamp: new Date().toISOString(),
  });

  try {
    console.log(
      "[AUTH][authService.createSession] Verifying ID token with Firebase Admin (checkRevoked=true)...",
    );
    const decoded = await admin.auth().verifyIdToken(idToken, true);
    console.log(
      "[AUTH][authService.createSession] ID token verified successfully:",
      {
        uid: decoded?.uid,
        email: decoded?.email,
        exp: decoded?.exp,
        expDate: decoded?.exp
          ? new Date(decoded.exp * 1000).toISOString()
          : "N/A",
        iat: decoded?.iat,
        iatDate: decoded?.iat
          ? new Date(decoded.iat * 1000).toISOString()
          : "N/A",
        auth_time: decoded?.auth_time,
        auth_timeDate: decoded?.auth_time
          ? new Date(decoded.auth_time * 1000).toISOString()
          : "N/A",
        currentTime: new Date().toISOString(),
        currentTimestamp: Date.now(),
        timeUntilExpiry: decoded?.exp ? decoded.exp * 1000 - Date.now() : "N/A",
        timeUntilExpiryMinutes: decoded?.exp
          ? Math.floor((decoded.exp * 1000 - Date.now()) / (1000 * 60))
          : "N/A",
      },
    );

    console.log(
      "[AUTH][authService.createSession] Upserting user from Firebase...",
    );
    const user = await upsertUserFromFirebase(decoded);
    console.log(
      "[AUTH][authService.createSession] User upserted successfully:",
      {
        uid: user?.uid,
        username: user?.username,
        email: user?.email,
      },
    );
    console.log(
      "[AUTH][authService.createSession] ========== SUCCESS ==========",
    );
    return user;
  } catch (error: any) {
    console.error(
      "[AUTH][authService.createSession] ========== ERROR ==========",
    );
    console.error("[AUTH][authService.createSession] Error details:", {
      message: error?.message,
      code: error?.code,
      errorCode: error?.errorCode,
      errorInfo: error?.errorInfo,
      stack: error?.stack,
      name: error?.name,
      idTokenLength: idToken?.length,
      idTokenPrefix: idToken?.substring(0, 30),
    });

    // Check if it's a TOKEN_EXPIRED error
    if (
      error?.code === "auth/id-token-expired" ||
      error?.errorInfo?.code === "auth/id-token-expired" ||
      error?.message?.includes("TOKEN_EXPIRED") ||
      error?.message?.includes("expired")
    ) {
      console.error(
        "[AUTH][authService.createSession] TOKEN_EXPIRED detected!",
        {
          currentTime: new Date().toISOString(),
          currentTimestamp: Date.now(),
          errorDetails: error,
        },
      );
      throw new ApiError(
        "ID token has expired. Please refresh and try again.",
        401,
      );
    }

    throw new ApiError(
      `Invalid token: ${error?.message || "Token verification failed"}`,
      401,
    );
  }
}

async function startEmailOtp(
  email: string,
): Promise<{ sent: boolean; ttl: number }> {
  console.log(`[AUTH] Starting OTP flow for email: ${email}`);

  // Check if user already exists in Firebase Auth
  try {
    const existingUser = await admin.auth().getUserByEmail(email);
    console.log(
      `[AUTH] User already exists in Firebase Auth: ${existingUser.uid}`,
    );

    // Check if user exists with Google provider
    const firestoreUser = await authRepository.getUserByEmail(email);
    if (firestoreUser && firestoreUser.user.provider === "google") {
      console.log(
        `[AUTH] User already signed up with Google, cannot use email/password`,
      );
      throw new ApiError(
        "You already have an account with Google. Please sign in with Google instead.",
        400,
      );
    }

    // User exists with email/password provider, ask to sign in instead
    throw new ApiError(
      "This email is already registered. Please login instead or try with other email.",
      400,
    );
  } catch (error: any) {
    // If user not found, continue with OTP flow
    if (error.code !== "auth/user-not-found") {
      console.log(`[AUTH] Error checking existing user: ${error.message}`);
      throw error; // Re-throw if it's our custom error or other Firebase error
    }
    console.log(`[AUTH] User not found in Firebase Auth, proceeding with OTP`);
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const ttlSeconds = 300; // OTP valid for 300s (5m)
  const expiresInMinutes = Math.ceil(ttlSeconds / 60); // Convert to minutes for email template

  console.log(
    `[AUTH] Generated OTP: ${code} for ${email}, TTL: ${ttlSeconds}s`,
  );

  await authRepository.saveOtp(email, code, ttlSeconds);
  console.log(`[AUTH] OTP saved to memory store`);

  // Generate formatted email templates
  const emailHTML = generateOTPEmailHTML({
    code,
    email,
    expiresInMinutes,
  });
  const emailText = generateOTPEmailText({
    code,
    email,
    expiresInMinutes,
  });

  // Fire-and-forget email send to reduce API latency; log result asynchronously
  const emailConfigured = isEmailConfigured();
  const shouldAwaitEmail = (() => {
    // Use env config, but also check runtime detection for serverless platforms
    if (env.otpEmailAwait) return true;
    // If running on typical serverless platforms, default to await for reliability
    if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL) return true; // Keep - runtime detection
    return false;
  })();

  if (shouldAwaitEmail) {
    try {
      await sendEmail(
        email,
        "Your WildMind AI verification code",
        emailText,
        emailHTML,
      );
      console.log(`[AUTH] OTP email sent (await) to ${email}`);
    } catch (emailError: any) {
      console.log(`[AUTH] Email send failed (await): ${emailError.message}`);
      // Do not throw: code is already saved; client can retry or use another channel
    }
  } else {
    (async () => {
      try {
        await sendEmail(
          email,
          "Your WildMind AI verification code",
          emailText,
          emailHTML,
        );
        console.log(`[AUTH] OTP email dispatched (async) to ${email}`);
      } catch (emailError: any) {
        console.log(`[AUTH] Async email send failed: ${emailError.message}`);
      }
    })();
  }

  // Respond and indicate delivery channel (email or console fallback)
  const exposeDebug = env.debugOtp || env.nodeEnv !== "production";
  return {
    sent: true,
    ttl: ttlSeconds,
    channel: emailConfigured ? "email" : "console",
    ...(exposeDebug ? { debugCode: code } : {}),
  } as any;
}

async function verifyEmailOtpAndCreateUser(
  email: string,
  username?: string,
  password?: string,
  deviceInfo?: any,
): Promise<{ user: AppUser; idToken: string }> {
  console.log(
    `[AUTH] Verifying OTP and creating user for email: ${email}, username: ${username}`,
  );

  const uname = username
    ? username.toLowerCase()
    : email.split("@")[0] || "user";
  console.log(`[AUTH] Processed username: ${uname}`);

  if (!/^[a-z0-9_.-]{3,30}$/.test(uname)) {
    console.log(`[AUTH] Invalid username format: ${uname}`);
    throw new ApiError("Invalid username", 400);
  }

  if (passwordContainsUsername(password, uname)) {
    throw new ApiError("Password must not contain your username.", 400);
  }

  const existingUserRecord = await authRepository.getUserByEmail(email);
  const existingPasswordHistory = existingUserRecord?.user?.passwordHistory || [];
  if (
    password &&
    (await doesPasswordMatchHistory(password, existingPasswordHistory))
  ) {
    throw new ApiError(
      `You cannot use any of your last ${getPasswordHistoryLimit()} passwords. Please choose a new password.`,
      400,
    );
  }

  let firebaseUser;
  let user;

  try {
    const existing = await admin.auth().getUserByEmail(email);
    console.log(`[AUTH] Found existing Firebase user: ${existing.uid}`);

    if (password) {
      await admin
        .auth()
        .updateUser(existing.uid, { password, emailVerified: true });
      console.log(
        `[AUTH] Updated existing user password and email verification`,
      );
    } else if (!existing.emailVerified) {
      await admin.auth().updateUser(existing.uid, { emailVerified: true });
      console.log(`[AUTH] Marked existing user email as verified`);
    }

    firebaseUser = existing;
    user = await authRepository.upsertUser(existing.uid, {
      email,
      username: uname.replace(/[^a-z0-9_.-]/g, "").slice(0, 30),
      provider: "password",
      photoURL: undefined,
      lastLoginIP: deviceInfo?.ip,
      userAgent: deviceInfo?.userAgent,
      deviceInfo: deviceInfo?.deviceInfo,
    });
    console.log(`[AUTH] Updated existing user in Firestore: ${user.username}`);
  } catch {
    console.log(`[AUTH] Creating new Firebase user for email: ${email}`);
    const created = await admin.auth().createUser({
      email,
      emailVerified: true,
      ...(password ? { password } : {}),
    });
    console.log(`[AUTH] Created Firebase user with UID: ${created.uid}`);

    firebaseUser = created;
    user = await authRepository.upsertUser(created.uid, {
      email,
      username: uname.replace(/[^a-z0-9_.-]/g, "").slice(0, 30),
      provider: "password",
      photoURL: undefined,
      lastLoginIP: deviceInfo?.ip,
      userAgent: deviceInfo?.userAgent,
      deviceInfo: deviceInfo?.deviceInfo,
    });
    console.log(`[AUTH] Created new user in Firestore: ${user.username}`);

    // Fire-and-forget welcome email for new email/password signup
    (async () => {
      try {
        await sendEmail(
          email,
          `🎉 Welcome to Wild Mind AI — You're In!`,
          generateWelcomeEmailText({
            email,
            username: user.username,
            dashboardUrl: getAppBaseUrl(),
          }),
          generateWelcomeEmailHTML({
            email,
            username: user.username,
            dashboardUrl: getAppBaseUrl(),
          }),
        );
        console.log(`[AUTH] Welcome email sent to new user: ${email}`);
      } catch (err: any) {
        console.log(
          `[AUTH] Welcome email failed (non-critical): ${err.message}`,
        );
      }
    })();
  }

  if (password) {
    const passwordChangedAt = new Date().toISOString();
    user = await authRepository.updateUser(firebaseUser.uid, {
      passwordHistory: await appendPasswordHistory(
        password,
        existingPasswordHistory,
      ),
      metadata: {
        ...(user.metadata || {
          accountStatus: "active",
          roles: ["user"],
        }),
        lastPasswordChange: passwordChangedAt,
      },
      updatedAt: passwordChangedAt,
    });
  }

  // Generate custom token for the user, then convert to ID token
  console.log(`[AUTH] Generating custom token for user: ${firebaseUser.uid}`);
  const customToken = await admin.auth().createCustomToken(firebaseUser.uid);
  console.log(`[AUTH] Custom token generated, now converting to ID token...`);

  // Note: Custom token needs to be exchanged for ID token on frontend
  // For now, we'll return the custom token and handle conversion in frontend
  return { user, idToken: customToken };
}

async function getCurrentUser(uid: string): Promise<AppUser> {
  const user = await authRepository.getUserById(uid);
  if (!user) {
    throw new ApiError("User not found", 404);
  }
  return user;
}

async function updateUser(
  uid: string,
  updates: Partial<AppUser>,
): Promise<AppUser> {
  return await authRepository.updateUser(uid, updates);
}

async function resolveEmailForLogin(
  identifier: string,
): Promise<string | null> {
  if (identifier.includes("@")) return identifier;
  const email = await authRepository.getEmailByUsername(
    identifier.toLowerCase(),
  );
  return email;
}

async function upsertUserFromFirebase(decoded: any): Promise<AppUser> {
  const uid: string = decoded.uid;
  const email: string = decoded.email || "";
  const displayName: string | undefined = decoded.name || decoded.displayName;
  const photoURL: string | undefined = decoded.picture;
  const providerId: ProviderId =
    (decoded.firebase?.sign_in_provider as ProviderId) || "unknown";

  let username =
    (displayName || email.split("@")[0] || "user")
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "")
      .slice(0, 28) || `user_${uid.slice(0, 6)}`;

  // SECURITY FIX: Check for username collision with a DIFFERENT user.
  // Two Google users with identical display names (e.g. "John Smith" → "johnsmith")
  // would previously share a username, causing getUserByUsername to return the wrong user.
  try {
    const existingByUsername = await authRepository.getUserByUsername(username);
    if (existingByUsername && existingByUsername.uid !== uid) {
      // Collision detected — append short UID suffix to ensure global uniqueness
      const suffix = uid.slice(0, 5);
      const original = username;
      username = `${username.slice(0, 23)}_${suffix}`;
      console.warn(
        "[AUTH][upsertUserFromFirebase] Username collision resolved",
        {
          originalUsername: original,
          resolvedUsername: username,
          collidingUid: existingByUsername.uid,
          newUid: uid,
        },
      );
    }
  } catch (checkErr: any) {
    // Non-fatal — if check fails, proceed with original username
    console.warn(
      "[AUTH][upsertUserFromFirebase] Username collision check failed (non-fatal):",
      checkErr?.message,
    );
  }

  return await authRepository.upsertUser(uid, {
    email,
    username,
    photoURL,
    provider: providerId,
  });
}

async function setUsernameOnly(
  username: string,
  deviceInfo?: any,
  email?: string,
): Promise<AppUser> {
  console.log(`[AUTH] Setting username only: ${username} for email: ${email}`);

  if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
    console.log(`[AUTH] Invalid username format: ${username}`);
    throw new ApiError("Invalid username", 400);
  }

  if (!email) {
    throw new ApiError("Email is required to set username", 400);
  }

  // Find existing user by email and update with username
  console.log(`[AUTH] Finding existing user by email: ${email}`);
  let existingUser = await authRepository.getUserByEmail(email);

  if (!existingUser) {
    throw new ApiError("No existing user found for this email", 400);
  }

  console.log(`[AUTH] Updating existing user with username: ${username}`);

  // Update the existing user with username
  const updatedUser = await authRepository.updateUserByEmail(email, {
    username: username.toLowerCase(),
    lastLoginIP: deviceInfo?.ip,
    userAgent: deviceInfo?.userAgent,
    deviceInfo: deviceInfo?.deviceInfo,
  });

  console.log(`[AUTH] Updated user with username: ${updatedUser.username}`);
  return updatedUser;
}

async function loginWithEmailPassword(
  email: string,
  password: string,
  deviceInfo?: any,
): Promise<{
  user: AppUser;
  customToken: string;
  passwordLoginIdToken?: string;
}> {
  console.log(`[AUTH] Login attempt for email: ${email}`);

  if (email.includes("@")) {
    try {
      await validateEmail(email);
    } catch (error: any) {
      if (error instanceof ApiError) {
        throw new ApiError("Enter valid email", 400);
      }
      throw error;
    }
  }

  // Step 1: Check if user exists in Firebase Auth
  let firebaseUser;
  try {
    firebaseUser = await admin.auth().getUserByEmail(email);
    console.log(`[AUTH] Found Firebase user: ${firebaseUser.uid}`);
  } catch (error: any) {
    // Handle user not found case
    if (error.code === "auth/user-not-found") {
      console.log(`[AUTH] User not found in Firebase Auth: ${email}`);
      throw new ApiError(
        "No account found with this email address. Please sign up first.",
        404,
      );
    }
    // Re-throw other Firebase Auth errors
    throw error;
  }

  // Step 2: Check if user exists with Google provider
  const firestoreUser = await authRepository.getUserByEmail(email);
  if (firestoreUser && firestoreUser.user.provider === "google") {
    console.log(
      `[AUTH] User already signed up with Google, cannot login with email/password`,
    );
    throw new ApiError(
      "You already have an account with Google. Please sign in with Google instead.",
      400,
    );
  }

  // Step 3: Check email verification
  if (!firebaseUser.emailVerified) {
    console.log(`[AUTH] User email not verified: ${email}`);
    throw new ApiError(
      "Email not verified. Please verify your email first.",
      400,
    );
  }

  // Step 4: Verify the password by attempting to sign in with Firebase
  // This will fail if the password is wrong or if the user was created without a password
  let passwordLoginIdToken: string | undefined;
  try {
    // Use Firebase REST API to verify password since Admin SDK doesn't expose signInWithEmailAndPassword
    // env.firebaseApiKey already handles fallbacks in env.ts
    const firebaseApiKey = env.firebaseApiKey;
    if (!firebaseApiKey) {
      // Explicit configuration error so ops can see it; don't mask as credentials issue
      throw new Error(
        "FIREBASE_API_KEY missing (server). Set FIREBASE_API_KEY or NEXT_PUBLIC_FIREBASE_API_KEY",
      );
    }

    const firebaseAuthApiBase = env.firebaseAuthApiBase;
    const response = await fetch(
      `${firebaseAuthApiBase}/accounts:signInWithPassword?key=${firebaseApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email,
          password: password,
          returnSecureToken: true,
        }),
      },
    );

    const result = await response.json();

    if (!response.ok) {
      const errorMessage = String(result?.error?.message || "").toUpperCase();
      const errorCode = String(result?.error?.code || "").toUpperCase();
      console.log(
        `[AUTH] Password verification failed: ${errorMessage} (code: ${errorCode})`,
      );

      // Handle specific Firebase error codes
      if (
        errorMessage.includes("INVALID_PASSWORD") ||
        errorCode === "INVALID_PASSWORD"
      ) {
        // User exists but password is incorrect
        throw new ApiError(
          "Invalid password. Please check your password and try again.",
          401,
        );
      } else if (
        errorMessage.includes("INVALID_LOGIN_CREDENTIALS") ||
        errorCode === "INVALID_LOGIN_CREDENTIALS"
      ) {
        // Generic invalid credentials (could be email or password)
        // Since we already verified user exists, this is likely a password issue
        throw new ApiError(
          "Invalid password. Please check your password and try again.",
          401,
        );
      } else if (
        errorMessage.includes("EMAIL_NOT_FOUND") ||
        errorCode === "EMAIL_NOT_FOUND"
      ) {
        // This shouldn't happen since we already checked, but handle it anyway
        throw new ApiError(
          "No account found with this email address. Please sign up first.",
          404,
        );
      } else if (
        errorMessage.includes("MISSING_PASSWORD") ||
        errorCode === "MISSING_PASSWORD"
      ) {
        throw new ApiError(
          "Password is required. Please enter your password.",
          400,
        );
      } else if (
        errorMessage.includes("TOO_MANY_ATTEMPTS") ||
        errorCode === "TOO_MANY_ATTEMPTS"
      ) {
        throw new ApiError(
          "Too many failed login attempts. Please try again later.",
          429,
        );
      } else if (
        errorMessage.includes("USER_DISABLED") ||
        errorCode === "USER_DISABLED"
      ) {
        throw new ApiError(
          "This account has been disabled. Please contact support.",
          403,
        );
      } else if (
        errorMessage.includes("OPERATION_NOT_ALLOWED") ||
        errorCode === "OPERATION_NOT_ALLOWED"
      ) {
        throw new ApiError(
          "Email/password sign-in is not enabled. Please contact support.",
          403,
        );
      } else {
        // On misconfiguration or unexpected error, surface a generic 500 to avoid UX confusion
        console.error(
          `[AUTH] Unexpected Firebase error: ${errorMessage} (code: ${errorCode})`,
        );
        throw new ApiError(
          "Authentication service unavailable. Please try again later.",
          503,
        );
      }
    }

    console.log(`[AUTH] Password verification successful for: ${email}`);
    // Capture ID token from email/password login for optional immediate session cookie creation
    if (typeof result?.idToken === "string" && result.idToken.length > 0) {
      passwordLoginIdToken = result.idToken;
    }
  } catch (error: any) {
    // Re-throw ApiError instances (already handled above)
    if (error instanceof ApiError) {
      throw error;
    }
    // If the error is from missing API key, elevate it to 500
    const msg = String(error?.message || "").toLowerCase();
    if (msg.includes("firebase_api_key") || msg.includes("missing")) {
      console.log(`[AUTH] Server configuration error: ${error.message}`);
      throw new ApiError(
        "Authentication service misconfigured. Please contact support.",
        500,
      );
    }
    // For any other unexpected errors during password verification
    console.error(
      `[AUTH] Password verification error: ${error.message}`,
      error,
    );
    throw new ApiError(
      "Invalid password. Please check your password and try again.",
      401,
    );
  }

  // Step 5: Get user from Firestore
  const user = await authRepository.getUserById(firebaseUser.uid);
  if (!user) {
    console.log(`[AUTH] User not found in Firestore: ${firebaseUser.uid}`);
    throw new ApiError(
      "User profile not found. Please complete registration.",
      400,
    );
  }

  // Check if account is suspended or banned
  if (user.isSuspended) {
    throw new ApiError(
      "Your account has been suspended. Please contact support.",
      403,
    );
  }
  if (user.isBanned) {
    throw new ApiError("Your account has been permanently banned.", 403);
  }

  // Step 6: Update login tracking
  const nextPasswordHistory = await appendPasswordHistory(
    password,
    user.passwordHistory || [],
  );
  const updatedUser = await authRepository.updateUser(firebaseUser.uid, {
    lastLoginAt: new Date().toISOString(),
    loginCount: (user.loginCount || 0) + 1,
    lastLoginIP: deviceInfo?.ip,
    userAgent: deviceInfo?.userAgent,
    deviceInfo: deviceInfo?.deviceInfo,
    passwordHistory: nextPasswordHistory,
  });

  // Step 7: Generate custom token (frontend can signInWithCustomToken to sync Firebase client state)
  console.log(`[AUTH] Generating custom token for login: ${firebaseUser.uid}`);
  const customToken = await admin.auth().createCustomToken(firebaseUser.uid);
  console.log(`[AUTH] Login successful for: ${email}`);

  return { user: updatedUser, customToken, passwordLoginIdToken };
}

// In-memory per-email cooldown for password reset (60 seconds)
// Keyed by normalized email, value is the Unix timestamp (ms) when the email was last sent.
// Entries are cleaned up automatically after the cooldown window to avoid unbounded growth.
const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000; // 60 seconds
const passwordResetCooldown = new Map<string, number>();

function buildPublicPasswordResetLink(
  generatedResetLink: string,
  appBaseUrl: string,
): string {
  try {
    const parsed = new URL(generatedResetLink);
    const publicUrl = new URL(
      `${appBaseUrl.replace(/\/$/, "")}/auth/reset-password`,
    );
    const mode = parsed.searchParams.get("mode") || "resetPassword";
    const oobCode = parsed.searchParams.get("oobCode");
    const lang = parsed.searchParams.get("lang");
    const apiKey = parsed.searchParams.get("apiKey");

    publicUrl.searchParams.set("mode", mode);
    if (oobCode) publicUrl.searchParams.set("oobCode", oobCode);
    if (lang) publicUrl.searchParams.set("lang", lang);
    if (apiKey) publicUrl.searchParams.set("apiKey", apiKey);

    return publicUrl.toString();
  } catch {
    return generatedResetLink;
  }
}

/**
 * Send password reset email to user
 * Returns result object with status and message for proper error handling
 */
async function sendPasswordResetEmail(
  email: string,
  requestOrigin?: string,
): Promise<{
  success: boolean;
  message: string;
  reason?: string;
  retryAfterSeconds?: number;
}> {
  console.log(`[AUTH] Password reset request for email: ${email}`);
  const appBaseUrl = resolveSafeAppBaseUrl(requestOrigin);
  const generationBaseUrls = Array.from(
    new Set(
      [
        appBaseUrl,
        getAppBaseUrl(),
        env.productionWwwDomain,
        env.productionDomain,
        env.firebaseAuthDomain
          ? `https://${String(env.firebaseAuthDomain).replace(/^https?:\/\//, "")}`
          : undefined,
      ]
        .filter(Boolean)
        .map((url) => String(url).replace(/\/$/, "")),
    ),
  );

  // Step 0: Enforce per-email cooldown to prevent email spam
  const now = Date.now();
  const lastSent = passwordResetCooldown.get(email);
  if (lastSent !== undefined) {
    const elapsed = now - lastSent;
    if (elapsed < PASSWORD_RESET_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil(
        (PASSWORD_RESET_COOLDOWN_MS - elapsed) / 1000,
      );
      console.log(
        `[AUTH] Password reset cooldown active for ${email}: ${retryAfterSeconds}s remaining`,
      );
      return {
        success: false,
        message: `Please wait ${retryAfterSeconds} seconds before requesting another reset email.`,
        reason: "TOO_MANY_REQUESTS",
        retryAfterSeconds,
      };
    }
  }

  // Step 1: Check if user exists in Firebase Auth
  let firebaseUser;
  try {
    firebaseUser = await admin.auth().getUserByEmail(email);
    console.log(
      `[AUTH] Found Firebase user for password reset: ${firebaseUser.uid}`,
    );
  } catch (error: any) {
    if (error.code === "auth/user-not-found") {
      console.log(`[AUTH] User not found: ${email}`);
      return {
        success: false,
        message: "No account found with this email address.",
        reason: "USER_NOT_FOUND",
      };
    }
    // Re-throw other Firebase Auth errors
    throw error;
  }

  // Step 2: Check if user signed up with Google only (no password)
  const firestoreUser = await authRepository.getUserByEmail(email);
  if (firestoreUser && firestoreUser.user.provider === "google") {
    console.log(
      `[AUTH] User signed up with Google only, cannot reset password: ${email}`,
    );
    return {
      success: false,
      message: "You signed up with Google. Please sign in with Google instead.",
      reason: "GOOGLE_ONLY_USER",
    };
  }

  // Step 3: Generate password reset link using Firebase Admin SDK
  let resetLink: string | undefined;
  let generatedWithBaseUrl: string | undefined;
  let lastGenerationError: any;

  for (const generationBaseUrl of generationBaseUrls) {
    const resetRedirectUrl = `${generationBaseUrl}/auth/reset-password`;
    console.log(`[AUTH] Trying reset redirect URL: ${resetRedirectUrl}`);

    const actionCodeSettings = {
      url: resetRedirectUrl,
      handleCodeInApp: false,
    };

    try {
      resetLink = await admin
        .auth()
        .generatePasswordResetLink(email, actionCodeSettings);
      generatedWithBaseUrl = generationBaseUrl;
      console.log(`[AUTH] Generated password reset link for: ${email}`, {
        generationBaseUrl,
      });
      break;
    } catch (error: any) {
      lastGenerationError = error;
      console.error(
        `[AUTH] Failed to generate password reset link with ${generationBaseUrl}: ${error.message}`,
      );
    }
  }

  if (!resetLink) {
    console.error(
      `[AUTH] Failed to generate password reset link: ${lastGenerationError?.message}`,
    );
    return {
      success: false,
      message:
        "Failed to generate password reset link. Please try again later.",
      reason: "LINK_GENERATION_FAILED",
    };
  }

  const publicResetLink = buildPublicPasswordResetLink(
    resetLink,
    appBaseUrl,
  );
  console.log(`[AUTH] Public password reset link prepared`, {
    requestOrigin,
    appBaseUrl,
    generatedWithBaseUrl,
    publicResetLink,
  });

  // Step 4: Send password reset email via Resend (using same template style as OTP)
  try {
    const emailSubject = "Reset Your Password - WildMind AI";
    const emailHTML = generatePasswordResetEmailHTML({
      resetLink: publicResetLink,
      email,
      companyName: "WildMind AI",
      supportEmail: "support@wildmindai.com",
    });
    const emailText = generatePasswordResetEmailText({
      resetLink: publicResetLink,
      email,
      companyName: "WildMind AI",
      supportEmail: "support@wildmindai.com",
    });

    await sendEmail(email, emailSubject, emailText, emailHTML);

    console.log(`[AUTH] Password reset email sent successfully to: ${email}`);

    // Record send time for cooldown — cleaned up automatically after the window
    passwordResetCooldown.set(email, Date.now());
    setTimeout(
      () => passwordResetCooldown.delete(email),
      PASSWORD_RESET_COOLDOWN_MS + 1000,
    );

    return {
      success: true,
      message: "Password reset link has been sent to your email.",
    };
  } catch (error: any) {
    console.error(
      `[AUTH] Failed to send password reset email: ${error.message}`,
    );
    return {
      success: false,
      message: "Failed to send password reset email. Please try again later.",
      reason: "EMAIL_SEND_FAILED",
    };
  }
}

async function completePasswordReset(
  oobCode: string,
  newPassword: string,
): Promise<{ success: true; email: string }> {
  const firebaseApiKey = env.firebaseApiKey;
  if (!firebaseApiKey) {
    throw new ApiError(
      "Authentication service misconfigured. Please contact support.",
      500,
    );
  }

  const firebaseAuthApiBase = env.firebaseAuthApiBase;
  const resetEndpoint = `${firebaseAuthApiBase}/accounts:resetPassword?key=${firebaseApiKey}`;

  const verifyResponse = await fetch(resetEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ oobCode }),
  });

  const verifyResult = await verifyResponse.json().catch(() => ({}));
  if (!verifyResponse.ok || !verifyResult?.email) {
    const errorMessage = String(verifyResult?.error?.message || "").toUpperCase();
    if (errorMessage.includes("EXPIRED_OOB_CODE")) {
      throw new ApiError(
        "This password reset link has expired. Please request a new one.",
        400,
      );
    }
    if (errorMessage.includes("INVALID_OOB_CODE")) {
      throw new ApiError(
        "This password reset link is invalid or has already been used.",
        400,
      );
    }
    throw new ApiError("Invalid reset link", 400);
  }

  const email = String(verifyResult.email).trim().toLowerCase();
  const firestoreUser = await authRepository.getUserByEmail(email);
  const passwordHistory = firestoreUser?.user?.passwordHistory || [];

  if (await doesPasswordMatchHistory(newPassword, passwordHistory)) {
    throw new ApiError(
      `You cannot use any of your last ${getPasswordHistoryLimit()} passwords. Please choose a new password.`,
      400,
    );
  }

  const applyResponse = await fetch(resetEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ oobCode, newPassword }),
  });
  const applyResult = await applyResponse.json().catch(() => ({}));

  if (!applyResponse.ok) {
    const errorMessage = String(applyResult?.error?.message || "").toUpperCase();
    if (errorMessage.includes("WEAK_PASSWORD")) {
      throw new ApiError(
        "Password is too weak. Please choose a stronger password.",
        400,
      );
    }
    if (errorMessage.includes("EXPIRED_OOB_CODE")) {
      throw new ApiError(
        "This password reset link has expired. Please request a new one.",
        400,
      );
    }
    if (errorMessage.includes("INVALID_OOB_CODE")) {
      throw new ApiError(
        "This password reset link is invalid or has already been used.",
        400,
      );
    }
    throw new ApiError("Failed to reset password. Please try again.", 400);
  }

  const passwordChangedAt = new Date().toISOString();
  if (firestoreUser) {
    await authRepository.updateUser(firestoreUser.uid, {
      passwordHistory: await appendPasswordHistory(newPassword, passwordHistory),
      metadata: {
        ...(firestoreUser.user.metadata || {
          accountStatus: "active",
          roles: ["user"],
        }),
        lastPasswordChange: passwordChangedAt,
      },
      updatedAt: passwordChangedAt,
    });
  }

  try {
    await sendEmail(
      email,
      "Password Reset Successful - WildMind AI",
      generatePasswordResetSuccessEmailText({
        email,
        companyName: "Wild Mind AI",
        supportEmail: "support@wildmindai.com",
      }),
      generatePasswordResetSuccessEmailHTML({
        email,
        companyName: "Wild Mind AI",
        supportEmail: "support@wildmindai.com",
      }),
    );
  } catch (error: any) {
    console.log(
      `[AUTH] Password reset success email failed (non-critical): ${error?.message}`,
    );
  }

  return { success: true, email };
}

async function googleSignIn(
  idToken: string,
  deviceInfo?: any,
): Promise<{ user: AppUser; needsUsername: boolean; sessionToken?: string }> {
  console.log(`[AUTH] Google sign-in attempt`);

  try {
    // Verify Google ID token with Firebase Admin
    const decoded = await admin.auth().verifyIdToken(idToken, true);
    console.log(`[AUTH][authService.googleSignIn] Google token decoded`, {
      uid: decoded.uid,
      email: decoded.email,
      email_verified: decoded.email_verified,
      firebase: decoded.firebase,
    });

    const {
      uid,
      email,
      name: displayName,
      picture: photoURL,
      email_verified: emailVerified,
    } = decoded;

    if (!email) {
      throw new ApiError("Email is required for Google sign-in", 400);
    }

    // Check if user already exists with email/password provider
    const firestoreUser = await authRepository.getUserByEmail(email);
    if (firestoreUser && firestoreUser.user.provider === "password") {
      console.log(
        `[AUTH] User already signed up with email/password, cannot use Google`,
      );
      throw new ApiError(
        "You already have an account with email/password. Please sign in with your email and password instead.",
        400,
      );
    }

    // Check if user already exists in Firestore
    let existingUser = await authRepository.getUserById(uid);

    if (existingUser) {
      console.log(
        "[AUTH][authService.googleSignIn] Existing Google user found in Firestore",
        {
          firestoreUid: existingUser.uid,
          tokenUid: uid,
          username: existingUser.username,
          email: existingUser.email,
          isSuspended: existingUser.isSuspended,
          isBanned: existingUser.isBanned,
        },
      );

      // Check if account is suspended or banned before issuing tokens
      if (existingUser.isSuspended) {
        throw new ApiError(
          "Your account has been suspended. Please contact support.",
          403,
        );
      }
      if (existingUser.isBanned) {
        throw new ApiError("Your account has been permanently banned.", 403);
      }

      // Update login tracking for existing user
      const updatedUser = await authRepository.updateUser(uid, {
        lastLoginAt: new Date().toISOString(),
        loginCount: (existingUser.loginCount || 0) + 1,
        lastLoginIP: deviceInfo?.ip,
        userAgent: deviceInfo?.userAgent,
        deviceInfo: deviceInfo?.deviceInfo,
        photoURL: photoURL || existingUser.photoURL,
      });

      // Generate session token for existing user
      const sessionToken = await admin.auth().createCustomToken(uid);
      console.log(
        `[AUTH][authService.googleSignIn] Generated customToken for UID: ${uid}`,
      );

      return {
        user: updatedUser,
        needsUsername: false,
        sessionToken,
      };
    } else {
      console.log(`[AUTH] New Google user, creating profile: ${email}`);

      // For Google users without username, use email prefix as collection but mark username as temporary
      const emailPrefix = email.split("@")[0];

      console.log(
        `[AUTH] Using email prefix as collection: ${emailPrefix}, username will be set later`,
      );

      // Create new user in Firestore using email prefix as collection name
      const newUser = await authRepository.upsertUser(uid, {
        email,
        username: "", // Empty username - will be set by user
        provider: "google",
        displayName: displayName || "",
        photoURL: photoURL || "",
        emailVerified: emailVerified || false,
        lastLoginIP: deviceInfo?.ip,
        userAgent: deviceInfo?.userAgent,
        deviceInfo: deviceInfo?.deviceInfo,
        isUsernameTemporary: true, // Flag to indicate username needs to be set
      });

      console.log(
        `[AUTH] New Google user created in email collection, needs username: ${email}`,
      );

      // Fire-and-forget welcome email for new Google signup
      (async () => {
        try {
          await sendEmail(
            email,
            `🎉 Welcome to Wild Mind AI — You're In!`,
            generateWelcomeEmailText({
              email,
              username: displayName || undefined,
              dashboardUrl: getAppBaseUrl(),
            }),
            generateWelcomeEmailHTML({
              email,
              username: displayName || undefined,
              dashboardUrl: getAppBaseUrl(),
            }),
          );
          console.log(`[AUTH] Welcome email sent to new Google user: ${email}`);
        } catch (err: any) {
          console.log(
            `[AUTH] Welcome email failed (non-critical): ${err.message}`,
          );
        }
      })();

      return {
        user: newUser,
        needsUsername: true, // Frontend should show username form
      };
    }
  } catch (error: any) {
    console.log(`[AUTH] Google sign-in failed:`, error.message);

    if (error.code === "auth/id-token-expired") {
      throw new ApiError("Google token expired. Please try again.", 401);
    } else if (error.code === "auth/id-token-revoked") {
      throw new ApiError("Google token revoked. Please sign in again.", 401);
    } else if (error instanceof ApiError) {
      throw error;
    } else {
      throw new ApiError("Google sign-in failed. Please try again.", 401);
    }
  }
}

async function setGoogleUsername(
  uid: string,
  username: string,
  deviceInfo?: any,
): Promise<{ user: AppUser; sessionToken: string }> {
  console.log(
    `[AUTH] Setting username for Google user: ${uid}, username: ${username}`,
  );

  if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
    console.log(`[AUTH] Invalid username format: ${username}`);
    throw new ApiError("Invalid username format", 400);
  }

  // Get current user
  const currentUser = await authRepository.getUserById(uid);
  if (!currentUser) {
    throw new ApiError("User not found", 404);
  }

  const newUsername = username.toLowerCase();
  console.log(
    `[AUTH] Setting username in existing email collection: ${newUsername}`,
  );
  console.log(`[AUTH] Current user data before update:`, currentUser);

  // Simply update the username field in the existing email-based collection
  const updatedUser = await authRepository.updateUser(uid, {
    username: newUsername,
    isUsernameTemporary: false, // Remove temporary flag
    updatedAt: new Date().toISOString(),
  });

  console.log(`[AUTH] Updated user data after username set:`, updatedUser);

  // Generate session token
  const sessionToken = await admin.auth().createCustomToken(uid);

  console.log(
    `[AUTH] Google user username set successfully in email collection: ${newUsername}`,
  );

  return { user: updatedUser, sessionToken };
}

export const authService = {
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
  checkUsernameAvailability,
  sendPasswordResetEmail,
  completePasswordReset,
};
