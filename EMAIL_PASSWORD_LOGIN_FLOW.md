# Email/Password Login Flow

## Current Flow (as of latest code)

### Endpoint
`POST /api/auth/login`

### Flow Steps

1. **Controller Entry Point** (`authController.ts:loginWithEmailPassword`)
   - Receives `{ email, password }` from request body
   - Extracts device info (IP, user agent, etc.)
   - Calls `authService.loginWithEmailPassword(email, password, deviceInfo)`

2. **Service Layer** (`authService.ts:loginWithEmailPassword`)
   
   **Step 2.1: Check Firebase Auth User**
   ```typescript
   try {
     firebaseUser = await admin.auth().getUserByEmail(email);
   } catch (error) {
     if (error.code === 'auth/user-not-found') {
       throw new ApiError('No account found with this email address. Please sign up first.', 404);
     }
   }
   ```
   - **Purpose**: Verify user exists in Firebase Authentication
   - **Error**: If user not found → Returns 404 with "No account found with this email address. Please sign up first."
   - **Note**: This is now handled gracefully with a clear, user-friendly error message

   **Step 2.2: Check Provider Type**
   ```typescript
   const firestoreUser = await authRepository.getUserByEmail(email);
   if (firestoreUser && firestoreUser.user.provider === 'google') {
     throw new ApiError('You already have an account with Google...');
   }
   ```
   - **Purpose**: Prevent email/password login if user signed up with Google
   - **Checks**: Firestore `users` collection for email match

   **Step 2.3: Check Email Verification**
   ```typescript
   if (!firebaseUser.emailVerified) {
     throw new ApiError('Email not verified...');
   }
   ```
   - **Purpose**: Ensure email is verified before allowing login

   **Step 2.4: Verify Password**
   ```typescript
   const response = await fetch(`${firebaseAuthApiBase}/accounts:signInWithPassword?key=${firebaseApiKey}`, {
     method: 'POST',
     body: JSON.stringify({ email, password, returnSecureToken: true })
   });
   ```
   - **Purpose**: Verify password using Firebase REST API
   - **Why REST API**: Admin SDK doesn't expose `signInWithEmailAndPassword`
   - **Returns**: ID token if successful
   - **Errors** (all handled with specific messages):
     - `INVALID_PASSWORD` or `INVALID_LOGIN_CREDENTIALS` → "Invalid password. Please check your password and try again." (401)
     - `EMAIL_NOT_FOUND` → "No account found with this email address. Please sign up first." (404)
     - `MISSING_PASSWORD` → "Password is required. Please enter your password." (400)
     - `TOO_MANY_ATTEMPTS` → "Too many failed login attempts. Please try again later." (429)
     - `USER_DISABLED` → "This account has been disabled. Please contact support." (403)
     - `OPERATION_NOT_ALLOWED` → "Email/password sign-in is not enabled. Please contact support." (403)
     - Other errors → "Authentication service unavailable. Please try again later." (503)

   **Step 2.5: Get User from Firestore**
   ```typescript
   const user = await authRepository.getUserById(firebaseUser.uid);
   if (!user) {
     throw new ApiError('User profile not found. Please complete registration.');
   }
   ```
   - **Purpose**: Retrieve user profile from Firestore `users` collection
   - **Error**: If user document doesn't exist in Firestore

   **Step 2.6: Update Login Tracking**
   ```typescript
   const updatedUser = await authRepository.updateUser(firebaseUser.uid, {
     lastLoginAt: new Date().toISOString(),
     loginCount: (user.loginCount || 0) + 1,
     lastLoginIP: deviceInfo?.ip,
     userAgent: deviceInfo?.userAgent,
     deviceInfo: deviceInfo?.deviceInfo
   });
   ```
   - **Purpose**: Track login history and device info

   **Step 2.7: Generate Custom Token**
   ```typescript
   const customToken = await admin.auth().createCustomToken(firebaseUser.uid);
   ```
   - **Purpose**: Generate token for frontend to sync Firebase client state
   - **Returns**: Custom token that frontend can use with `signInWithCustomToken()`

3. **Response**
   ```typescript
   return { 
     user: updatedUser, 
     customToken, 
     passwordLoginIdToken 
   };
   ```
   - **user**: Updated user object from Firestore
   - **customToken**: Token for Firebase client SDK
   - **passwordLoginIdToken**: ID token from password verification (optional)

## Current Issue

### Error: "There is no user record corresponding to the provided identifier"

**Location**: Step 2.1 - `admin.auth().getUserByEmail(email)`

**Root Cause**: The user `rajdeep@wildmindai.com` does not exist in Firebase Authentication.

**Possible Reasons**:
1. User was never created in Firebase Auth (only exists in Firestore)
2. User was deleted from Firebase Auth
3. Email doesn't match exactly (case sensitivity, typos)
4. User was created with a different email

**Solution Options**:
1. **Create the user in Firebase Auth** (if they should exist)
2. **Check if user exists in Firestore first**, then create in Firebase Auth if missing
3. **Allow signup flow** if user doesn't exist

## Data Flow

```
Frontend Request
    ↓
POST /api/auth/login { email, password }
    ↓
authController.loginWithEmailPassword()
    ↓
authService.loginWithEmailPassword()
    ↓
1. Firebase Auth: getUserByEmail() ← FAILING HERE
    ↓
2. Firestore: getUserByEmail() (check provider)
    ↓
3. Firebase REST API: signInWithPassword() (verify password)
    ↓
4. Firestore: getUserById() (get user profile)
    ↓
5. Firestore: updateUser() (update login tracking)
    ↓
6. Firebase Auth: createCustomToken() (generate token)
    ↓
Response: { user, customToken, passwordLoginIdToken }
```

## Dependencies

- **Firebase Admin SDK**: For user lookup and custom token generation
- **Firebase REST API**: For password verification (Admin SDK limitation)
- **Firestore**: For user profile storage and login tracking
- **Environment Variables**:
  - `FIREBASE_API_KEY` or `NEXT_PUBLIC_FIREBASE_API_KEY`
  - `FIREBASE_AUTH_API_BASE` (defaults to `https://identitytoolkit.googleapis.com/v1`)

## Error Handling

All edge cases are now handled with specific, user-friendly error messages:

| Error Case | Message | Status Code |
|------------|---------|-------------|
| **User not found** (Firebase Auth) | No account found with this email address. Please sign up first. | 404 |
| **Invalid password** (user exists, password wrong) | Invalid password. Please check your password and try again. | 401 |
| **Email not found** (Firebase REST API) | No account found with this email address. Please sign up first. | 404 |
| **Missing password** | Password is required. Please enter your password. | 400 |
| **Too many attempts** | Too many failed login attempts. Please try again later. | 429 |
| **User disabled** | This account has been disabled. Please contact support. | 403 |
| **Operation not allowed** | Email/password sign-in is not enabled. Please contact support. | 403 |
| **Missing API key** | Authentication service misconfigured. Please contact support. | 500 |
| **User not in Firestore** | User profile not found. Please complete registration. | 400 |
| **Google provider user** | You already have an account with Google. Please sign in with Google instead. | 400 |
| **Email not verified** | Email not verified. Please verify your email first. | 400 |
| **Service unavailable** | Authentication service unavailable. Please try again later. | 503 |

### Error Handling Flow

1. **User Existence Check**: First checks if user exists in Firebase Auth
   - If not found → Returns 404 with "No account found with this email address"
   
2. **Provider Check**: Verifies user didn't sign up with Google
   - If Google provider → Returns 400 with message to use Google sign-in
   
3. **Email Verification**: Checks if email is verified
   - If not verified → Returns 400 with message to verify email
   
4. **Password Verification**: Attempts to sign in with Firebase REST API
   - If password wrong → Returns 401 with "Invalid password"
   - If too many attempts → Returns 429 with rate limit message
   - If user disabled → Returns 403 with disabled message
   - Other errors → Returns appropriate status code with specific message
   
5. **Firestore Check**: Verifies user profile exists in Firestore
   - If not found → Returns 400 with message to complete registration

