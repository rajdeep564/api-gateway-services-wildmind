/**
 * IP Firewall Middleware
 * 
 * Blocks malicious IPs based on:
 * - Redis blocklist
 * - Failed authentication attempts
 * - Suspicious activity patterns
 */

import { Request, Response, NextFunction } from 'express';
import { getRedisClient, isRedisEnabled } from '../config/redisClient';

/**
 * Check if IP is blocked
 */
export const ipFirewall = async (req: Request, res: Response, next: NextFunction) => {
  // Skip if Redis is not available
  if (!isRedisEnabled()) {
    return next();
  }

  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const redis = getRedisClient();
    if (!redis) return next();

    // Check if IP is in blocklist
    const isBlocked = await redis.get(`blocked:ip:${ip}`);
    
    if (isBlocked) {
      console.warn(`[IP Firewall] ❌ Blocked IP attempted access: ${ip}`);
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. Your IP has been temporarily blocked.'
      });
    }

    // Check failed authentication attempts
    const failedAttempts = await redis.get(`failed:auth:${ip}`);
    const attempts = parseInt(failedAttempts || '0');

    if (attempts >= 10) {
      // Block IP for 1 hour after 10 failed attempts
      await redis.setEx(`blocked:ip:${ip}`, 3600, '1');
      console.warn(`[IP Firewall] 🚫 Auto-blocked IP after ${attempts} failed attempts: ${ip}`);
      
      return res.status(403).json({
        status: 'error',
        message: 'Too many failed authentication attempts. IP blocked for 1 hour.'
      });
    }

    next();
  } catch (error) {
    // Don't block if Redis is down
    console.error('[IP Firewall] Error:', error);
    next();
  }
};

/**
 * Track failed authentication attempt
 */
export const trackFailedAuth = async (ip: string): Promise<void> => {
  if (!isRedisEnabled()) return;

  try {
    const redis = getRedisClient();
    if (!redis) return;
    
    await redis.incr(`failed:auth:${ip}`);
    await redis.expire(`failed:auth:${ip}`, 900); // 15 minutes TTL
    
    const attempts = await redis.get(`failed:auth:${ip}`);
    console.warn(`[IP Firewall] Failed auth from ${ip}: ${attempts} attempts`);
  } catch (error) {
    console.error('[IP Firewall] Error tracking failed auth:', error);
  }
};

/**
 * Clear failed authentication attempts (on successful login)
 */
export const clearFailedAuth = async (ip: string): Promise<void> => {
  if (!isRedisEnabled()) return;

  try {
    const redis = getRedisClient();
    if (!redis) return;
    
    await redis.del(`failed:auth:${ip}`);
  } catch (error) {
    console.error('[IP Firewall] Error clearing failed auth:', error);
  }
};

/**
 * Manually block an IP
 */
export const blockIP = async (ip: string, durationSeconds: number = 3600): Promise<void> => {
  if (!isRedisEnabled()) return;

  try {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.setEx(`blocked:ip:${ip}`, durationSeconds, '1');
    console.warn(`[IP Firewall] 🔒 Manually blocked IP: ${ip} for ${durationSeconds}s`);
  } catch (error) {
    console.error('[IP Firewall] Error blocking IP:', error);
  }
};

/**
 * Unblock an IP
 */
export const unblockIP = async (ip: string): Promise<void> => {
  if (!isRedisEnabled()) return;

  try {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.del(`blocked:ip:${ip}`);
    await redis.del(`failed:auth:${ip}`);
    console.log(`[IP Firewall] ✅ Unblocked IP: ${ip}`);
  } catch (error) {
    console.error('[IP Firewall] Error unblocking IP:', error);
  }
};

console.log('[IP Firewall] Initialized with Redis:', isRedisEnabled() ? 'ENABLED' : 'DISABLED');
