# Firebase Email Service Setup for Password Reset

## Overview

The password reset functionality now uses **Firebase's built-in email service** with **Resend SMTP**. This means:
- **OTP emails** (sign-up) → Still use Resend API directly (via code)
- **Auth emails** (password reset) → Use Firebase REST API → Resend SMTP (via Firebase Console)

Both use the same sender: `no-reply@wildmindai.com` (already verified on Resend).

## Benefits of Using Firebase Email Service

1. **Unified Email Management**: All authentication emails (verification, password reset) managed in one place
2. **No Additional Service**: No need to maintain separate Resend/Gmail SMTP configuration for auth emails
3. **Firebase Templates**: Customize email templates directly in Firebase Console
4. **Built-in Security**: Firebase handles email delivery, rate limiting, and security

## Setup Instructions

### Step 1: Get Resend SMTP Credentials

1. Go to **Resend Dashboard** → **API Keys** → **SMTP**
   - Or visit: https://resend.com/emails/smtp
2. Note your SMTP credentials:
   - **SMTP Host**: `smtp.resend.com`
   - **SMTP Port**: `465` (SSL) or `587` (TLS)
   - **SMTP Username**: `resend` (always the same)
   - **SMTP Password**: Your Resend API key (starts with `re_`)

### Step 2: Configure SMTP in Firebase Console

1. Go to **Firebase Console** → **Authentication** → **Templates**
2. Click on **SMTP settings** (gear icon in the sidebar)
3. Enable SMTP by toggling the **Enable** switch
4. Fill in Resend SMTP configuration:
   - **Sender address**: `no-reply@wildmindai.com` (already verified on Resend)
   - **SMTP server host**: `smtp.resend.com`
   - **SMTP server port**: `465` (SSL) or `587` (TLS)
   - **SMTP account username**: `resend`
   - **SMTP account password**: Your Resend API key (e.g., `re_xxxxxxxxxx`)
   - **SMTP security mode**: 
     - Select `SSL` if using port `465`
     - Select `TLS` if using port `587`

5. Click **Save**

### Step 2: Configure Password Reset Template (Optional)

1. Go to **Firebase Console** → **Authentication** → **Templates**
2. Click on **Password reset** (envelope icon)
3. Customize the email template if desired
4. Set **Action URL** to: `https://www.wildmindai.com/auth/reset-password`
   - This is where users will be redirected after clicking the reset link
5. Click **Save**

### Step 3: Verify Authorized Domains

1. Go to **Firebase Console** → **Authentication** → **Settings**
2. Under **Authorized domains**, ensure your domain is listed:
   - `www.wildmindai.com`
   - `wildmindai.com`
   - Any other domains you use

## How It Works

### Backend Flow

1. User requests password reset → `POST /api/auth/forgot-password`
2. Backend validates email and checks user existence
3. Backend calls Firebase REST API: `sendOobCode` with `requestType: 'PASSWORD_RESET'`
4. Firebase sends email using your configured SMTP settings
5. Email contains a secure link that redirects to your frontend

### Email Content

Firebase will use the **Password reset** template configured in Firebase Console. You can customize:
- Email subject
- Email body (HTML and plain text)
- Sender name
- Action URL (where users are redirected)

## Code Changes

The implementation now uses Firebase's REST API endpoint:

```typescript
POST https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key={API_KEY}
{
  "requestType": "PASSWORD_RESET",
  "email": "user@example.com",
  "continueUrl": "https://www.wildmindai.com/auth/reset-password"
}
```

## Testing

### Test Password Reset Flow

1. Request password reset: `POST /api/auth/forgot-password` with email
2. Check email inbox for password reset email from Firebase
3. Click the reset link in the email
4. Verify redirect to `/auth/reset-password?mode=resetPassword&oobCode=<code>`
5. Complete password reset on frontend

### Verify SMTP Configuration

1. Go to Firebase Console → Authentication → Templates → SMTP settings
2. Click **Test email** (if available) or trigger a password reset
3. Check that email is received from your configured sender address

## Troubleshooting

### Email Not Received

1. **Check SMTP Settings**: Verify all SMTP credentials are correct
2. **Check Spam Folder**: Password reset emails might be filtered
3. **Check Firebase Logs**: Look for email delivery errors in Firebase Console
4. **Verify Sender Address**: Ensure sender address is verified with your email provider
5. **Check Rate Limits**: Firebase has rate limits on email sending

### SMTP Connection Errors

1. **Port Configuration**: 
   - Use port `587` for TLS
   - Use port `465` for SSL
2. **Security Mode**: Match the security mode (TLS/SSL) with the port
3. **Firewall**: Ensure Firebase can connect to your SMTP server
4. **Credentials**: Double-check username and password

### Link Not Working

1. **Action URL**: Verify Action URL is set correctly in password reset template
2. **Authorized Domains**: Ensure your domain is in authorized domains list
3. **Link Expiration**: Reset links expire after 1 hour
4. **HTTPS**: Links only work over HTTPS in production

## Environment Variables

No additional environment variables are needed. The implementation uses:
- `FIREBASE_API_KEY`: Already configured
- `FIREBASE_AUTH_API_BASE`: Already configured (defaults to Firebase API)
- `PRODUCTION_WWW_DOMAIN`: Used for redirect URL (already configured)

## Migration from Resend

If you were previously using Resend for password reset emails:

1. ✅ **Code Updated**: Already switched to Firebase REST API
2. ⚠️ **SMTP Configuration**: Configure SMTP in Firebase Console (Step 1 above)
3. ⚠️ **Email Templates**: Customize password reset template in Firebase Console
4. ✅ **No Code Changes Needed**: Backend code is already updated

## Comparison: Resend vs Firebase Email Service

| Feature | Resend | Firebase Email Service |
|---------|--------|------------------------|
| Setup | API key in env | SMTP config in Firebase Console |
| Templates | Custom HTML in code | Customizable in Firebase Console |
| Delivery | Resend infrastructure | Your SMTP server |
| Cost | Resend pricing | Your SMTP provider pricing |
| Management | Separate service | Integrated with Firebase Auth |

## Next Steps

1. ✅ Configure SMTP settings in Firebase Console
2. ✅ Customize password reset email template (optional)
3. ✅ Test password reset flow
4. ✅ Monitor email delivery in Firebase Console

## Support

If you encounter issues:
1. Check Firebase Console → Authentication → Templates → SMTP settings
2. Review Firebase logs for email delivery errors
3. Verify SMTP credentials with your email provider
4. Test SMTP connection outside of Firebase if needed

