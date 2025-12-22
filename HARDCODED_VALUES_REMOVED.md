# Hardcoded Environment Variables Removed

This document lists all hardcoded environment variables that have been removed and replaced with proper environment variable usage.

## Summary

All statically typed/hardcoded environment variables have been removed from the `api-gateway-services-wildmind` codebase and replaced with environment variable references. The following variables are now configurable via environment variables.

## New Environment Variables Added

### API Base URLs
- `MINIMAX_API_BASE` - MiniMax API base URL (default: `https://api.minimax.io/v1`)
- `RESEND_API_BASE` - Resend API base URL (default: `https://api.resend.com`)
- `FAL_QUEUE_BASE` - FAL queue API base URL (default: `https://queue.fal.run`)
- `FIREBASE_AUTH_API_BASE` - Firebase Auth API base URL (default: `https://identitytoolkit.googleapis.com/v1`)
- `BFL_API_BASE` - BFL API base URL (default: `https://api.bfl.ai`)

### Zata Storage
- `ZATA_PREFIX` - Zata storage prefix URL (default: `https://idr01.zata.ai/devstoragev1/`)
  - Also checks `NEXT_PUBLIC_ZATA_PREFIX` for compatibility

### SMTP Configuration
- `GMAIL_SMTP_HOST` - Gmail SMTP host (default: `smtp.gmail.com`)
- `GMAIL_SMTP_PORT` - Gmail SMTP port (default: `465`)

### Frontend Domains
- `PRODUCTION_DOMAIN` - Production domain (default: `https://wildmindai.com`)
- `PRODUCTION_WWW_DOMAIN` - Production www domain (default: `https://www.wildmindai.com`)
- `PRODUCTION_STUDIO_DOMAIN` - Production studio domain (default: `https://studio.wildmindai.com`)

### Development URLs
- `DEV_FRONTEND_URL` - Development frontend URL (default: `http://localhost:3000`)
- `DEV_CANVAS_URL` - Development canvas URL (default: `http://localhost:3001`)
- `DEV_BACKEND_URL` - Development backend URL (default: `http://localhost:5001`)

### External Services
- `API_GATEWAY_URL` - API Gateway URL (optional, for CSP)
- `DISPOSABLE_EMAIL_DOMAINS_URL` - Disposable email domains list URL (default: `https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.json`)

## Files Modified

### Core Configuration
1. **`src/config/env.ts`**
   - Added new environment variable definitions
   - All new variables have sensible defaults for backward compatibility

### Application Setup
2. **`src/app/app.ts`**
   - Replaced hardcoded production domains (`wildmindai.com`, `www.wildmindai.com`, `studio.wildmindai.com`)
   - Replaced hardcoded localhost ports (`3000`, `3001`)
   - Now uses `env.productionDomain`, `env.productionWwwDomain`, `env.productionStudioDomain`
   - Now uses `env.devFrontendUrl`, `env.devCanvasUrl`

### Security Middleware
3. **`src/middlewares/security.ts`**
   - Replaced hardcoded API endpoints in CSP (`api.bfl.ai`, `localhost:5001`, etc.)
   - Replaced hardcoded production domains
   - Replaced hardcoded localhost URLs
   - Now uses `env.bflApiBase`, `env.devBackendUrl`, `env.apiGatewayUrl`
   - Now uses `env.productionDomain`, `env.productionWwwDomain`, `env.productionStudioDomain`
   - Now uses `env.devFrontendUrl`, `env.devCanvasUrl`

### Service Files
4. **`src/services/minimaxService.ts`**
   - Replaced hardcoded `MINIMAX_API_BASE` (`https://api.minimax.io/v1`)
   - Now uses `env.minimaxApiBase`

5. **`src/services/auth/authService.ts`**
   - Replaced hardcoded Firebase Auth API URL (`https://identitytoolkit.googleapis.com/v1`)
   - Now uses `env.firebaseAuthApiBase`

6. **`src/services/falService.ts`**
   - Replaced hardcoded FAL queue URL (`https://queue.fal.run`)
   - Now uses `env.falQueueBase`

7. **`src/services/generationHistoryService.ts`**
   - Replaced hardcoded Zata prefix (`https://idr01.zata.ai/devstoragev1/`)
   - Now uses `env.zataPrefix`

8. **`src/services/replicateService.ts`**
   - Replaced hardcoded Zata prefix
   - Now uses `env.zataPrefix`

9. **`src/services/imageOptimizationService.ts`**
   - Replaced hardcoded Zata prefixes array
   - Now uses `env.zataPrefix` to dynamically generate prefix variations

### Utility Files
10. **`src/utils/mailer.ts`**
    - Replaced hardcoded Gmail SMTP host (`smtp.gmail.com`)
    - Replaced hardcoded Gmail SMTP port (`465`)
    - Replaced hardcoded Resend API URL (`https://api.resend.com/emails`)
    - Now uses `env.gmailSmtpHost`, `env.gmailSmtpPort`
    - Now uses `env.resendApiBase`

11. **`src/utils/emailValidator.ts`**
    - Replaced hardcoded disposable email domains URL
    - Now uses `env.disposableEmailDomainsUrl`

12. **`src/utils/storage/zataDelete.ts`**
    - Replaced hardcoded Zata prefix
    - Now uses `env.zataPrefix`

### WebSocket
13. **`src/websocket/realtimeServer.ts`**
    - Replaced hardcoded localhost base URL
    - Now uses `env.devFrontendUrl` as default base

## Migration Guide

To use custom values, set the following environment variables in your `.env` file or deployment platform:

```bash
# API Base URLs (optional - defaults provided)
MINIMAX_API_BASE=https://api.minimax.io/v1
RESEND_API_BASE=https://api.resend.com
FAL_QUEUE_BASE=https://queue.fal.run
FIREBASE_AUTH_API_BASE=https://identitytoolkit.googleapis.com/v1
BFL_API_BASE=https://api.bfl.ai

# Zata Storage (optional - defaults provided)
ZATA_PREFIX=https://idr01.zata.ai/devstoragev1/

# SMTP Configuration (optional - defaults provided)
GMAIL_SMTP_HOST=smtp.gmail.com
GMAIL_SMTP_PORT=465

# Frontend Domains (optional - defaults provided)
PRODUCTION_DOMAIN=https://wildmindai.com
PRODUCTION_WWW_DOMAIN=https://www.wildmindai.com
PRODUCTION_STUDIO_DOMAIN=https://studio.wildmindai.com

# Development URLs (optional - defaults provided)
DEV_FRONTEND_URL=http://localhost:3000
DEV_CANVAS_URL=http://localhost:3001
DEV_BACKEND_URL=http://localhost:5001

# External Services (optional)
API_GATEWAY_URL=https://api-gateway-services-wildmind.onrender.com
DISPOSABLE_EMAIL_DOMAINS_URL=https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.json
```

## Backward Compatibility

All new environment variables have default values that match the previously hardcoded values. This ensures:
- **No breaking changes** - Existing deployments will continue to work without modification
- **Gradual migration** - You can set environment variables only when needed
- **Easy testing** - Default values allow local development without configuration

## Benefits

1. **Flexibility** - All URLs and endpoints are now configurable
2. **Environment-specific configuration** - Different values for dev/staging/production
3. **Security** - No hardcoded secrets or sensitive URLs in code
4. **Maintainability** - Centralized configuration in `env.ts`
5. **Testability** - Easy to mock or override values for testing

## Notes

- The default port in `env.ts` (`5000`) remains as a fallback but should be set via `PORT` environment variable
- All domain checks now dynamically use the configured production domain instead of hardcoded `wildmindai.com`
- CORS and security middleware now respect environment-specific configurations

