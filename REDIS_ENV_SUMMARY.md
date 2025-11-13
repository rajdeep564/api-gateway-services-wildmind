# Redis Environment Variables - Where They're Needed

## ✅ Only Required in API Gateway Service

**You only need Redis environment variables in the `api-gateway-services-wildmind` folder.**

## Why?

Redis is a **backend-only** service. The architecture is:

```
Frontend (wildmindcanvas) 
    ↓ HTTP requests
API Gateway (api-gateway-services-wildmind)
    ↓ Uses Redis directly
Redis Server
```

The frontend apps (`wildmindcanvas` and `wild`) **do NOT** connect to Redis directly. They:
- Make HTTP requests to the API Gateway
- The API Gateway uses Redis internally for:
  - Session caching
  - Canvas presence tracking
  - Generation caching

## Environment Variables Needed

### ✅ API Gateway Service (`api-gateway-services-wildmind/.env`)

```env
# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=sess:app:
REDIS_DEBUG=false
```

### ❌ Canvas Frontend (`wildmindcanvas`) - NOT NEEDED

The Canvas frontend does not need Redis environment variables. It communicates with Redis through the API Gateway endpoints.

### ❌ Main Frontend (`wild`) - NOT NEEDED

The main WildMind frontend does not need Redis environment variables. It also communicates through the API Gateway.

## Where Redis is Used in API Gateway

1. **Session Storage** (`src/utils/sessionStore.ts`)
   - Caches user sessions
   - Uses `REDIS_PREFIX` for key namespacing

2. **Canvas Presence** (`src/websocket/canvasPresenceServer.ts`)
   - Tracks user presence in Canvas projects
   - Uses keys like: `presence:{projectId}:{userId}`

3. **Generation Cache** (`src/utils/generationCache.ts`)
   - Caches generation results
   - Improves performance for repeated requests

4. **Auth Middleware** (`src/middlewares/authMiddleware.ts`)
   - Uses Redis for session validation

## Verification

To verify Redis is working:

```bash
# 1. Check API Gateway logs for Redis connection
# Should see: [Redis] Connected

# 2. Test Canvas presence endpoint
curl -X POST http://localhost:5001/api/canvas/projects/{projectId}/presence \
  -H "Cookie: app_session=..." \
  -H "Content-Type: application/json" \
  -d '{"x": 100, "y": 200}'

# 3. Check Redis directly
docker exec -it wildmind-redis redis-cli
> KEYS *
> GET presence:project-123:user-456
```

## Summary

✅ **Add Redis env vars to**: `api-gateway-services-wildmind/.env`  
❌ **Do NOT add to**: `wildmindcanvas/.env` or `wild/.env`

The frontend apps are completely unaware of Redis - they just call API endpoints that use Redis internally.

