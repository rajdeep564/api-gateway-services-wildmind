# Required Environment Variables

This list contains all environment variables that must be set in your `.env` file or deployment platform (Render.com).

## Core Configuration
- `NODE_ENV`: `production` or `development`
- `PORT`: Port to run the server on (e.g., `5000`)
- `LOG_LEVEL`: `info`, `debug`, `warn`, or `error`

## Authentication & Security
- `COOKIE_DOMAIN`: The domain for session cookies (e.g., `.wildmindai.com`). **CRITICAL for cross-subdomain auth.**
- `FRONTEND_ORIGIN`: The main frontend URL (e.g., `https://www.wildmindai.com`)
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins (e.g., `https://www.wildmindai.com,https://studio.wildmindai.com,http://localhost:3000`)
- `REVOKE_FIREBASE_TOKENS`: `true` or `false`. Whether to revoke Firebase refresh tokens on login.
- `AUTH_STRICT_REVOCATION`: `true` or `false`. Whether to strictly check for token revocation on every request.

## Firebase (Required)
- `FIREBASE_API_KEY`: Web API Key
- `FIREBASE_AUTH_DOMAIN`: Auth Domain
- `FIREBASE_PROJECT_ID`: Project ID
- `FIREBASE_STORAGE_BUCKET`: Storage Bucket
- `FIREBASE_MESSAGING_SENDER_ID`: Sender ID
- `FIREBASE_APP_ID`: App ID
- `FIREBASE_SERVICE_ACCOUNT`: JSON string of the service account key

## Storage (Zata/S3)
- `ZATA_ENDPOINT`: S3-compatible endpoint (e.g., `https://idr01.zata.ai`)
- `ZATA_BUCKET`: Bucket name
- `ZATA_REGION`: Region (e.g., `us-east-1`)
- `ZATA_ACCESS_KEY_ID`: Access Key
- `ZATA_SECRET_ACCESS_KEY`: Secret Key
- `ZATA_FORCE_PATH_STYLE`: `true` or `false`

## Redis (Caching)
- `REDIS_URL`: Connection string (e.g., `redis://user:pass@host:port`)
- `REDIS_PREFIX`: Key prefix (default: `sess:app:`)
- `REDIS_DEBUG`: `true` or `false`

## AI Services (API Keys)
- `BFL_API_KEY`: Black Forest Labs API Key
- `FAL_KEY`: Fal.ai API Key
- `REPLICATE_API_KEY`: Replicate API Key
- `GOOGLE_GENAI_API_KEY`: Google Gemini API Key
- `RUNWAY_API_KEY`: RunwayML API Key
- `MINIMAX_API_KEY`: Minimax API Key
- `MINIMAX_GROUP_ID`: Minimax Group ID

## Email (SMTP)
- `SMTP_HOST`: SMTP Server Host
- `SMTP_PORT`: SMTP Port
- `SMTP_USER`: SMTP Username
- `SMTP_PASS`: SMTP Password
- `SMTP_FROM`: From email address
- `EMAIL_USER`: (Legacy) Email user
- `EMAIL_APP_PASSWORD`: (Legacy) App password
- `RESEND_API_KEY`: Resend.com API Key (if used)
- `OTP_EMAIL_AWAIT`: `true` or `false`. Wait for email sending before responding?

## Local Services (Optional)
- `SCORE_LOCAL`: URL for local scoring service
- `PROMPT_ENHANCER_URL`: URL for prompt enhancer service
