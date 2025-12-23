/**
 * Rate Limiting Middleware (WebSocket-Friendly)
 * 
 * Different limits for different endpoint types:
 * - WebSocket traffic: Not rate limited
 * - Generation endpoints: 30 requests/min
 * - Auth endpoints: 5 attempts/15min
 * - Global: 300 requests/min
 */

import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { getRedisClient, isRedisEnabled } from '../config/redisClient';

// Global rate limiter - fallback for all routes
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute per IP
  message: {
    status: 'error',
    message: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(isRedisEnabled() && {
    store: new RedisStore({
      sendCommand: (...args: string[]) => getRedisClient()!.sendCommand(args),
      prefix: 'rl:global:'
    })
  }),
  skip: (req) => {
    // Skip all GET requests (read-only operations like feed, scroll, polling)
    if (req.method === 'GET') return true;
    // Skip WebSocket upgrade requests
    return req.headers.upgrade === 'websocket';
  }
});

// Auth endpoints - strict limit to prevent brute force
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: {
    status: 'error',
    message: 'Too many authentication attempts, please try again in 15 minutes'
  },
  skipSuccessfulRequests: true, // Don't count successful logins
  ...(isRedisEnabled() && {
    store: new RedisStore({
      sendCommand: (...args: string[]) => getRedisClient()!.sendCommand(args),
      prefix: 'rl:auth:'
    })
  })
});

// Generation endpoints - moderate limit
export const generationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 generations per minute
  message: {
    status: 'error',
    message: 'Generation rate limit exceeded, please slow down'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip GET requests (e.g. checking status) if applied here
    if (req.method === 'GET') return true;
    return false;
  },
  // Note: Using default keyGenerator which properly handles IPv6
  ...(isRedisEnabled() && {
    store: new RedisStore({
      sendCommand: (...args: string[]) => getRedisClient()!.sendCommand(args),
      prefix: 'rl:gen:'
    })
  })
});

// API endpoints - standard limit
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // INCREASED: 1000 requests per minute
  message: {
    status: 'error',
    message: 'API rate limit exceeded'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip all GET requests (read-only operations like feed, scroll, polling, navigation)
    if (req.method === 'GET') return true;
    return false;
  },
  // Note: Using default keyGenerator which properly handles IPv6
  ...(isRedisEnabled() && {
    store: new RedisStore({
      sendCommand: (...args: string[]) => getRedisClient()!.sendCommand(args),
      prefix: 'rl:api:'
    })
  })
});

// Polling endpoints - Very high limit (5000 req/min) for status checks
// effectively disabled for polling
export const pollingLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5000, // INCREASED: 5000 requests per minute
  message: {
    status: 'error',
    message: 'Polling rate limit exceeded'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Note: Using default keyGenerator which properly handles IPv6
  ...(isRedisEnabled() && {
    store: new RedisStore({
      sendCommand: (...args: string[]) => getRedisClient()!.sendCommand(args),
      prefix: 'rl:poll:'
    })
  }),
  skip: (req) => {
    // Skip all GET requests (polling is usually GET)
    if (req.method === 'GET') return true;
    // Skip WebSocket upgrade requests
    return req.headers.upgrade === 'websocket';
  }
});



console.log('[Rate Limiter] Initialized with Redis:', isRedisEnabled() ? 'ENABLED' : 'DISABLED (in-memory)');
