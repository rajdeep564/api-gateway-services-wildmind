# Password Reset Implementation

## Overview

This document describes the forgot password / password reset functionality implemented using Firebase Authentication.

## Architecture

### Backend Flow

1. **User requests password reset** → `POST /api/auth/forgot-password`
2. **Backend validates email** → Checks format and validates against disposable email domains
3. **Backend checks user existence** → Verifies user exists in Firebase Auth (but doesn't reveal if not found)
4. **Backend generates reset link** → Uses Firebase Admin SDK `generatePasswordResetLink()`
5. **Backend sends email** → Sends password reset email with secure link
6. **User clicks link** → Redirects to frontend with Firebase action code
7. **Frontend handles reset** → Uses Firebase client SDK to complete password reset

### Security Features

- **Email Enumeration Protection**: Always returns success message, even if user doesn't exist
- **Secure Links**: Firebase generates time-limited, single-use reset links
- **Provider Check**: Prevents password reset for Google-only accounts
- **Email Validation**: Validates email format and checks for disposable email domains

## API Endpoint

### `POST /api/auth/forgot-password`

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (Success):**
```json
{
  "status": "success",
  "message": "If an account exists with this email, a password reset link has been sent.",
  "data": {
    "message": "Please check your email for password reset instructions."
  }
}
```

**Response (Validation Error):**
```json
{
  "status": "error",
  "message": "Validation failed",
  "errors": [...]
}
```

**Note**: The success response is always returned (even if user doesn't exist) to prevent email enumeration attacks.

## Frontend Implementation

### Step 1: Create Forgot Password Form

Create a form that calls the API endpoint:

```typescript
const handleForgotPassword = async (email: string) => {
  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await response.json();
    // Show success message
  } catch (error) {
    // Handle error
  }
};
```

### Step 2: Create Password Reset Page

Create a page at `/auth/reset-password` that handles the Firebase action code:

```typescript
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getAuth, confirmPasswordReset } from 'firebase/auth';

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const oobCode = searchParams.get('oobCode');
  const mode = searchParams.get('mode');

  useEffect(() => {
    // Verify this is a password reset request
    if (mode !== 'resetPassword' || !oobCode) {
      router.push('/login');
      return;
    }
  }, [mode, oobCode, router]);

  const handleResetPassword = async (newPassword: string) => {
    try {
      const auth = getAuth();
      await confirmPasswordReset(auth, oobCode, newPassword);
      // Redirect to login with success message
      router.push('/login?reset=success');
    } catch (error) {
      // Handle error (link expired, invalid code, etc.)
    }
  };

  return (
    <div>
      <h1>Reset Your Password</h1>
      <form onSubmit={(e) => {
        e.preventDefault();
        const password = e.target.password.value;
        handleResetPassword(password);
      }}>
        <input type="password" name="password" placeholder="New Password" required />
        <button type="submit">Reset Password</button>
      </form>
    </div>
  );
}
```

### Step 3: Configure Firebase Action URL

In Firebase Console:
1. Go to **Authentication** → **Settings** → **Authorized domains**
2. Add your domain (e.g., `www.wildmindai.com`)
3. Go to **Authentication** → **Templates** → **Password reset**
4. Set **Action URL** to: `https://www.wildmindai.com/auth/reset-password`

## Email Template

The password reset email includes:
- **Subject**: "Reset Your Password - WildMind AI"
- **Reset Button**: Styled button linking to the reset URL
- **Fallback Link**: Plain text link for email clients that don't support HTML
- **Security Notice**: Warning about ignoring if not requested
- **Expiration Notice**: Link expires in 1 hour

## Environment Variables

The following environment variables are used:

- `PRODUCTION_WWW_DOMAIN`: Production frontend URL (e.g., `https://www.wildmindai.com`)
- `PRODUCTION_DOMAIN`: Fallback production domain
- `DEV_FRONTEND_URL`: Development frontend URL (e.g., `http://localhost:3000`)

The reset link redirect URL is constructed as: `${frontendUrl}/auth/reset-password`

## Error Handling

### Backend Errors

- **Email not found**: Returns success (prevents enumeration)
- **Google-only user**: Returns success (prevents enumeration)
- **Email validation fails**: Returns 400 with validation errors
- **Email sending fails**: Returns 500 with error message

### Frontend Errors

- **Invalid/expired code**: Firebase SDK throws error
- **Weak password**: Firebase SDK validates password strength
- **Network error**: Handle fetch errors appropriately

## Testing

### Test Cases

1. **Valid email with password account**
   - Should send reset email
   - Link should work and allow password reset

2. **Valid email with Google-only account**
   - Should return success (but not send email)
   - Prevents enumeration

3. **Non-existent email**
   - Should return success (prevents enumeration)
   - No email sent

4. **Invalid email format**
   - Should return 400 validation error

5. **Expired reset link**
   - Should show error when user tries to use expired link

6. **Used reset link**
   - Should show error when user tries to reuse link

## Security Considerations

1. **Email Enumeration**: Always return success to prevent attackers from discovering valid emails
2. **Link Expiration**: Firebase links expire after 1 hour
3. **Single Use**: Links can only be used once
4. **HTTPS Only**: Links only work over HTTPS in production
5. **Password Strength**: Firebase enforces minimum password requirements

## Configuration

### Firebase Console Settings

1. **Authorized Domains**: Add your production domain
2. **Email Templates**: Customize the password reset email template
3. **Action URL**: Set to your frontend reset password page

### Backend Configuration

The redirect URL is automatically constructed from environment variables. Make sure to set:
- `PRODUCTION_WWW_DOMAIN` in production
- `DEV_FRONTEND_URL` in development

## Future Enhancements

- [ ] Rate limiting on forgot password requests
- [ ] Password strength requirements display
- [ ] Password reset confirmation email
- [ ] Account lockout after multiple failed attempts
- [ ] SMS-based password reset option

