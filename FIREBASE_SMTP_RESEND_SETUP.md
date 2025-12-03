# Firebase SMTP Setup with Resend (Using no-reply@wildmindai.com)

## Overview

You're using:
- **Resend API** → For OTP emails (via code using `sendEmail()`)
- **Firebase Email Service** → For authentication emails (password reset, email verification)
- **Same email address**: `no-reply@wildmindai.com` (already verified on Resend)

## Solution: Use Resend SMTP in Firebase Console

Since your domain `wildmindai.com` is already verified on Resend, you can use **Resend's SMTP server** in Firebase Console. This allows Firebase to send auth emails using the same `no-reply@wildmindai.com` address.

## Step-by-Step Setup

### Step 1: Get Resend SMTP Credentials

1. Go to **Resend Dashboard** → **API Keys** → **SMTP**
2. Or go to: https://resend.com/emails/smtp
3. You'll see your SMTP credentials:
   - **SMTP Host**: `smtp.resend.com`
   - **SMTP Port**: `465` (SSL) or `587` (TLS)
   - **SMTP Username**: `resend` (always the same)
   - **SMTP Password**: Your Resend API key (starts with `re_`)

### Step 2: Configure Firebase SMTP Settings

1. Go to **Firebase Console** → **Authentication** → **Templates** → **SMTP settings**
2. Enable SMTP by toggling the **Enable** switch
3. Fill in the Resend SMTP details:
   - **Sender address**: `no-reply@wildmindai.com`
   - **SMTP server host**: `smtp.resend.com`
   - **SMTP server port**: `465` (or `587` if you prefer TLS)
   - **SMTP account username**: `resend`
   - **SMTP account password**: Your Resend API key (e.g., `re_xxxxxxxxxx`)
   - **SMTP security mode**: 
     - Select `SSL` if using port `465`
     - Select `TLS` if using port `587`
4. Click **Save**

### Step 3: Configure Password Reset Template

1. Go to **Firebase Console** → **Authentication** → **Templates** → **Password reset**
2. Set **Action URL** to: `https://www.wildmindai.com/auth/reset-password`
3. Customize the email template if desired
4. Click **Save**

## How It Works

### Email Flow Separation

```
┌─────────────────────────────────────────────────┐
│  OTP Emails (Sign-up)                           │
│  → Uses Resend API directly                     │
│  → Sent via: sendEmail() in code                │
│  → From: no-reply@wildmindai.com                │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  Auth Emails (Password Reset, Verification)     │
│  → Uses Firebase REST API                       │
│  → Firebase sends via Resend SMTP               │
│  → From: no-reply@wildmindai.com                │
└─────────────────────────────────────────────────┘
```

### Code Flow

1. **OTP Emails** (`startEmailOtp`):
   - Uses `sendEmail()` → Resend API
   - Custom HTML templates
   - Full control in code

2. **Password Reset** (`sendPasswordResetEmail`):
   - Uses Firebase REST API: `sendOobCode`
   - Firebase sends email via Resend SMTP (configured in Console)
   - Uses Firebase email templates (customizable in Console)

## Benefits

✅ **Same sender address**: Both use `no-reply@wildmindai.com`  
✅ **Domain already verified**: No additional verification needed  
✅ **Unified email service**: Both use Resend infrastructure  
✅ **Separation of concerns**: Auth emails managed in Firebase, OTP in code  

## Testing

### Test Password Reset

1. Request password reset: `POST /api/auth/forgot-password`
2. Check email from `no-reply@wildmindai.com`
3. Verify email is sent via Resend (check Resend dashboard)
4. Click reset link and verify it works

### Test OTP

1. Request OTP: `POST /api/auth/email/start`
2. Check email from `no-reply@wildmindai.com`
3. Verify email is sent via Resend API (check Resend dashboard)

## Troubleshooting

### Email Not Received

1. **Check Resend Dashboard**: Look for email delivery status
2. **Check Firebase Console**: Look for SMTP connection errors
3. **Verify SMTP Credentials**: Double-check Resend API key
4. **Check Spam Folder**: Emails might be filtered

### SMTP Connection Errors

1. **Port Configuration**:
   - Use port `465` with `SSL`
   - Use port `587` with `TLS`
2. **API Key**: Make sure you're using the full Resend API key (starts with `re_`)
3. **Username**: Must be exactly `resend` (lowercase)

### Domain Verification

Since `wildmindai.com` is already verified on Resend:
- ✅ You can send from `no-reply@wildmindai.com`
- ✅ No additional verification needed in Firebase
- ✅ Both Resend API and Resend SMTP will work

## Alternative: Use Different Email for Firebase Auth

If you prefer to keep them completely separate:

1. Use `auth@wildmindai.com` or `noreply-auth@wildmindai.com` for Firebase
2. Keep `no-reply@wildmindai.com` for Resend API (OTP)
3. Verify the new email domain in Resend if needed

But using the same email is fine since both use Resend infrastructure!

## Summary

✅ **Current Setup**:
- OTP emails → Resend API (via code)
- Password reset → Firebase → Resend SMTP (via Firebase Console)

✅ **What You Need to Do**:
1. Get Resend SMTP credentials (host, port, username, API key)
2. Configure Firebase Console SMTP settings with Resend credentials
3. Set sender address to `no-reply@wildmindai.com`
4. Test password reset flow

✅ **Result**:
- All emails from `no-reply@wildmindai.com`
- OTP via Resend API
- Auth emails via Firebase + Resend SMTP
- Domain already verified ✅

