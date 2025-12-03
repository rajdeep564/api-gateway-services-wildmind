# Firebase Authorized Domains Fix

## Error: `UNAUTHORIZED_DOMAIN : DOMAIN NOT ALLOWLISTED BY PROJECT`

### What's Happening

Firebase is rejecting the password reset request because the domain in the `continueUrl` is not in Firebase's **Authorized domains** list.

### Root Cause

When sending a password reset email, Firebase requires that the `continueUrl` domain must be in the authorized domains list. This is a security feature to prevent redirect attacks.

### Solution

Add your domain to Firebase's authorized domains:

1. **Go to Firebase Console** → **Authentication** → **Settings**
2. Scroll down to **Authorized domains**
3. Click **Add domain**
4. Add your domain(s):
   - `www.wildmindai.com` (if using `PRODUCTION_WWW_DOMAIN`)
   - `wildmindai.com` (if using `PRODUCTION_DOMAIN`)
   - `localhost` (for local development)
   - Any other domains you use

### Check Current Domain Being Used

The backend logs will show:
```
[AUTH] Using reset redirect URL: https://www.wildmindai.com/auth/reset-password
[AUTH] Domain to add: www.wildmindai.com
```

Add the domain shown in the logs to Firebase Console.

### Environment Variables

The domain is determined by these environment variables (in order of priority):
1. `PRODUCTION_WWW_DOMAIN` (e.g., `https://www.wildmindai.com`)
2. `PRODUCTION_DOMAIN` (e.g., `https://wildmindai.com`)
3. `DEV_FRONTEND_URL` (e.g., `http://localhost:3000`)

### Quick Fix

1. Check your backend logs to see which domain is being used
2. Go to Firebase Console → Authentication → Settings → Authorized domains
3. Add that domain
4. Try the password reset again

### Note

The error is currently being silently handled (returns success to prevent email enumeration), but the email won't actually be sent until the domain is authorized.

