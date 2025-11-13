# Redis Setup Guide for Canvas Presence

## Quick Start

```bash
# 1. Start Redis with Docker (docker-compose.yml is already created)
docker-compose up -d redis

# 2. Add to your .env file:
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=sess:app:
REDIS_DEBUG=false

# 3. Restart your API Gateway server
npm run dev
```

## Docker Setup

### 1. `docker-compose.yml` is already created in the project root

The file includes:
- Redis 7 Alpine image (lightweight)
- Port 6379 exposed
- Persistent volume for data
- AOF (Append Only File) persistence enabled
- Health checks configured

### 2. Start Redis

```bash
# Start Redis container
docker-compose up -d redis

# Check if Redis is running
docker ps | grep redis

# View Redis logs
docker logs wildmind-redis

# Test Redis connection
docker exec -it wildmind-redis redis-cli ping
# Should return: PONG
```

### 3. Stop Redis

```bash
docker-compose down
# Or to keep data:
docker-compose stop redis
```

## Environment Variables

Add these to your `.env` file in `api-gateway-services-wildmind`:

```env
# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=sess:app:
REDIS_DEBUG=false
```

### Environment Variable Details

- **REDIS_URL** (required if using Redis)
  - Format: `redis://[username]:[password]@[host]:[port]`
  - Local Docker: `redis://localhost:6379`
  - With password: `redis://:password@localhost:6379`
  - With username and password: `redis://username:password@localhost:6379`
  - Production (if using Redis Cloud/Upstash): `redis://default:password@host:port`

- **REDIS_PREFIX** (optional, default: `sess:app:`)
  - Prefix for all Redis keys
  - Used for session storage and other cached data
  - Canvas presence uses keys like: `presence:{projectId}:{userId}`

- **REDIS_DEBUG** (optional, default: `false`)
  - Set to `true` to enable Redis debug logging
  - Useful for troubleshooting connection issues

## Production Setup

### Option 1: Redis Cloud (Managed)

1. Sign up at [Redis Cloud](https://redis.com/try-free/)
2. Create a database
3. Copy the connection URL
4. Set `REDIS_URL` in your production environment

### Option 2: Upstash Redis (Serverless)

1. Sign up at [Upstash](https://upstash.com/)
2. Create a Redis database
3. Copy the REST URL or Redis URL
4. Set `REDIS_URL` in your production environment

### Option 3: Self-Hosted (Docker on Server)

```bash
# On your server
docker run -d \
  --name redis \
  --restart unless-stopped \
  -p 6379:6379 \
  -v redis-data:/data \
  redis:7-alpine \
  redis-server --appendonly yes --requirepass YOUR_PASSWORD

# Then set REDIS_URL=redis://:YOUR_PASSWORD@your-server-ip:6379
```

## Testing Redis Connection

### From Node.js (in your API Gateway)

```typescript
import { getRedisClient, isRedisEnabled } from './config/redisClient';

// Check if Redis is enabled
console.log('Redis enabled:', isRedisEnabled());

// Get client and test
const client = getRedisClient();
if (client) {
  await client.set('test', 'value');
  const value = await client.get('test');
  console.log('Redis test:', value); // Should print: value
}
```

### From Command Line

```bash
# Using redis-cli (if installed locally)
redis-cli -h localhost -p 6379 ping

# Or using Docker
docker exec -it wildmind-redis redis-cli ping
```

## Troubleshooting

### Connection Refused

- Check if Redis container is running: `docker ps | grep redis`
- Verify port 6379 is not blocked by firewall
- Check Redis logs: `docker logs wildmind-redis`

### Authentication Error

- If Redis has a password, include it in `REDIS_URL`: `redis://:password@localhost:6379`
- Check if Redis requires authentication: `docker exec -it wildmind-redis redis-cli CONFIG GET requirepass`

### Redis Not Connecting

- Verify `REDIS_URL` is set correctly in `.env`
- Check `REDIS_DEBUG=true` for detailed logs
- Ensure Redis client is initialized: `getRedisClient()` should not return `null`

## Canvas Presence Usage

The Canvas presence system uses Redis for fast presence lookups:

- **Key format**: `presence:{projectId}:{userId}`
- **TTL**: 5 seconds (automatically expires)
- **Fallback**: If Redis is unavailable, falls back to Firestore

### Example Redis Keys

```
presence:project-123:user-456
presence:project-123:user-789
```

## Performance Notes

- Redis provides sub-millisecond latency for presence lookups
- Firestore fallback adds ~50-200ms latency
- For production with many concurrent users, Redis is recommended
- Presence data is ephemeral (5s TTL), so Redis memory usage is minimal

