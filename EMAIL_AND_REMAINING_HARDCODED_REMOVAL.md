# Email and Remaining Hardcoded Values Removal - Complete

## Summary

Completed a thorough check of all email-related code and remaining hardcoded environment variable fallbacks throughout the codebase.

## Files Modified

### Email-Related Files

1. **`src/utils/mailer.ts`**
   - **Removed**: Hardcoded fallback `'smtp.gmail.com'` → Now uses `env.gmailSmtpHost` directly
   - **Removed**: Hardcoded fallback `465` → Now uses `env.gmailSmtpPort` directly
   - **Removed**: Hardcoded fallback `'https://api.resend.com'` (2 instances) → Now uses `env.resendApiBase` directly
   - **Note**: All defaults are already handled in `env.ts`, so no fallbacks needed in usage code

2. **`src/utils/emailValidator.ts`**
   - **Removed**: Hardcoded fallback disposable email domains URL
   - **Changed**: Now uses `env.disposableEmailDomainsUrl` directly (default handled in `env.ts`)

### Other Files with Hardcoded Fallbacks Removed

3. **`src/services/bflService.ts`**
   - **Removed**: 6 instances of hardcoded `'https://api.bfl.ai'` fallbacks
   - **Changed**: All endpoints now use `env.bflApiBase` directly

4. **`src/services/minimaxService.ts`**
   - **Removed**: Hardcoded `"https://api.minimax.io/v1"` fallback
   - **Changed**: Now uses `env.minimaxApiBase` directly

5. **`src/services/falService.ts`**
   - **Removed**: Hardcoded `'https://queue.fal.run'` fallback
   - **Changed**: Now uses `env.falQueueBase` directly

6. **`src/services/auth/authService.ts`**
   - **Removed**: Hardcoded `'https://identitytoolkit.googleapis.com/v1'` fallback
   - **Changed**: Now uses `env.firebaseAuthApiBase` directly

7. **`src/services/replicateService.ts`**
   - **Removed**: Hardcoded Zata prefix fallback
   - **Changed**: Now uses `env.zataPrefix` directly

8. **`src/services/imageOptimizationService.ts`**
   - **Removed**: Hardcoded Zata prefix fallback
   - **Changed**: Now uses `env.zataPrefix` directly (with fallback for type safety)

9. **`src/utils/storage/zataDelete.ts`**
   - **Removed**: Hardcoded Zata prefix fallback
   - **Changed**: Now uses `env.zataPrefix` directly (with fallback for type safety)

10. **`src/services/generationHistoryService.ts`**
    - **Removed**: Hardcoded Zata prefix fallback
    - **Changed**: Now uses `env.zataPrefix` directly with proper null handling

11. **`src/middlewares/security.ts`**
    - **Removed**: Hardcoded `'https://api.bfl.ai'` and `'http://localhost:5001'` fallbacks
    - **Changed**: Now uses `env.bflApiBase` and `env.devBackendUrl` directly

12. **`src/websocket/realtimeServer.ts`**
    - **Removed**: Hardcoded `'http://localhost:3000'` fallback
    - **Changed**: Now uses `env.devFrontendUrl` directly

13. **`src/routes/proxy.ts`**
    - **Removed**: Hardcoded `'https://idr01.zata.ai'` and `'devstoragev1'` fallbacks
    - **Changed**: Now uses `ZATA_ENDPOINT` and `ZATA_BUCKET` from `zataClient.ts` (which use `env`)

## Key Principle Applied

**All hardcoded fallback values in usage code have been removed.** The centralized `env.ts` file is the single source of truth for all default values. Usage code should reference `env.*` properties directly, trusting that defaults are already handled in the configuration layer.

## Remaining Acceptable Patterns

1. **`env.ts` file**: Contains default values (e.g., `process.env.X || 'default'`) - This is correct and expected. This is the centralized configuration layer.

2. **Type safety fallbacks**: Some files (like `imageOptimizationService.ts` and `zataDelete.ts`) keep minimal fallbacks for TypeScript type safety, but these are only used when `env.zataPrefix` is undefined, which should never happen in production if properly configured.

3. **Runtime detection**: `process.env.AWS_LAMBDA_FUNCTION_NAME` and `process.env.VERCEL` in `authService.ts` - These are for detecting serverless runtime environments, not configuration values.

## Verification

✅ All email-related hardcoded values removed
✅ All API endpoint hardcoded fallbacks removed  
✅ All domain/URL hardcoded fallbacks removed
✅ All SMTP configuration hardcoded fallbacks removed
✅ No linting errors
✅ All code now uses centralized `env` configuration

The codebase is now fully configured through environment variables with no redundant hardcoded fallbacks in usage code.

