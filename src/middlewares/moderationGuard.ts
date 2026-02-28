/**
 * Moderation Guard Middleware
 *
 * Enforces admin-panel moderation decisions at the API gateway level:
 *   - Banned users  → 403 permanently blocked
 *   - Suspended users → 403 with reason and optional expiry
 *   - Blocked IPs   → 403 from Firestore blockedIPs collection
 *   - Blocked Devices → 403 from Firestore blockedDevices collection
 *
 * Short-lived Redis cache (5 min) avoids Firestore on every request.
 * Cache is keyed per-uid so it reacts within 5 min of admin action.
 *
 * Usage: Place AFTER requireAuth (uid must already be set on req).
 */

import { Request, Response, NextFunction } from "express";
import { adminDb, admin } from "../config/firebaseAdmin";
import {
  redisGetSafe,
  redisSetSafe,
  redisDelSafe,
} from "../config/redisClient";

// Cache TTL in seconds — moderation changes take effect within this window
const MODERATION_CACHE_TTL = 5 * 60; // 5 minutes

interface ModerationStatus {
  isBanned: boolean;
  banReason?: string;
  isSuspended: boolean;
  suspendReason?: string;
  suspendedUntil?: string; // ISO date
  isUnderReview?: boolean;
  checkedAt: number; // epoch ms
}

function moderationCacheKey(uid: string) {
  return `mod:status:${uid}`;
}

function ipBlockCacheKey(ip: string) {
  return `mod:ip:${ip}`;
}

function deviceBlockCacheKey(deviceId: string) {
  return `mod:device:${deviceId}`;
}

/**
 * Get (or fetch) the moderation status for a user, with Redis caching.
 */
async function getModerationStatus(uid: string): Promise<ModerationStatus> {
  // Try Redis cache first
  const cacheKey = moderationCacheKey(uid);
  try {
    const cached = await redisGetSafe<ModerationStatus>(cacheKey);
    if (cached) return cached;
  } catch {
    // Cache miss or error — fall through to Firestore
  }

  // Fetch from Firestore
  const snap = await adminDb.collection("users").doc(uid).get();
  const data = snap.data() || {};

  const status: ModerationStatus = {
    isBanned: !!data.isBanned,
    banReason: data.banReason,
    isSuspended: !!data.isSuspended,
    suspendReason: data.suspendReason,
    suspendedUntil: data.suspendedUntil,
    isUnderReview: !!data.isUnderReview,
    checkedAt: Date.now(),
  };

  // Cache result for MODERATION_CACHE_TTL seconds
  try {
    await redisSetSafe(cacheKey, status, MODERATION_CACHE_TTL);
  } catch {
    // Non-fatal
  }

  return status;
}

/**
 * Check if an IP is blocked in the Firestore blockedIPs collection.
 * Also caches result in Redis for MODERATION_CACHE_TTL seconds.
 */
async function isIPBlocked(
  ip: string,
): Promise<{ blocked: boolean; reason?: string }> {
  const cacheKey = ipBlockCacheKey(ip);
  try {
    const cached = await redisGetSafe<{ blocked: boolean; reason?: string }>(
      cacheKey,
    );
    if (cached !== null) return cached;
  } catch {
    // Cache miss
  }

  const snap = await adminDb
    .collection("blockedIPs")
    .where("ip", "==", ip)
    .where("isBlocked", "==", true)
    .limit(1)
    .get();

  const result = {
    blocked: !snap.empty,
    reason: snap.empty ? undefined : snap.docs[0].data()?.reason,
  };

  try {
    await redisSetSafe(cacheKey, result, MODERATION_CACHE_TTL);
  } catch {
    // Non-fatal
  }

  return result;
}

/**
 * Check if a device is blocked in the Firestore blockedDevices collection.
 */
async function isDeviceBlocked(
  deviceId: string,
): Promise<{ blocked: boolean; reason?: string }> {
  const cacheKey = deviceBlockCacheKey(deviceId);
  try {
    const cached = await redisGetSafe<{ blocked: boolean; reason?: string }>(
      cacheKey,
    );
    if (cached !== null) return cached;
  } catch {
    // Cache miss
  }

  const snap = await adminDb
    .collection("blockedDevices")
    .where("deviceId", "==", deviceId)
    .where("isBlocked", "==", true)
    .limit(1)
    .get();

  const result = {
    blocked: !snap.empty,
    reason: snap.empty ? undefined : snap.docs[0].data()?.reason,
  };

  try {
    await redisSetSafe(cacheKey, result, MODERATION_CACHE_TTL);
  } catch {
    // Non-fatal
  }

  return result;
}

/**
 * Invalidate cached moderation status for a user (call this after admin actions).
 * This forces the gateway to re-check Firestore on the next request.
 */
export async function invalidateModerationCache(uid: string): Promise<void> {
  try {
    await redisDelSafe(moderationCacheKey(uid));
    console.log("[MOD] Moderation cache invalidated for uid:", uid);
  } catch {
    // Non-fatal
  }
}

/**
 * Invalidate cached IP block status (call after admin blocks/unblocks an IP).
 */
export async function invalidateIPBlockCache(ip: string): Promise<void> {
  try {
    await redisDelSafe(ipBlockCacheKey(ip));
    console.log("[MOD] IP block cache invalidated for ip:", ip);
  } catch {
    // Non-fatal
  }
}

/**
 * Invalidate cached device block status (call after admin blocks/unblocks a device).
 */
export async function invalidateDeviceBlockCache(
  deviceId: string,
): Promise<void> {
  try {
    await redisDelSafe(deviceBlockCacheKey(deviceId));
    console.log("[MOD] Device block cache invalidated for deviceId:", deviceId);
  } catch {
    // Non-fatal
  }
}

/**
 * moderationGuard — Express middleware.
 *
 * Must be placed AFTER requireAuth so that req.uid is populated.
 * Blocks banned users, suspended users, blocked IPs, and blocked devices.
 */
export async function moderationGuard(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const uid = (req as any).uid as string | undefined;

  // If no uid, let requireAuth handle it
  if (!uid) return next();

  try {
    // ── 1. Check user ban/suspension status ──────────────────────────────
    let modStatus: ModerationStatus;
    try {
      modStatus = await getModerationStatus(uid);
    } catch (err: any) {
      // Non-fatal: if Firestore is unreachable, allow the request through
      console.error(
        "[MOD] Failed to fetch moderation status (allowing through):",
        err?.message,
      );
      return next();
    }

    if (modStatus.isBanned) {
      console.warn(`[MOD] 🚫 Banned user attempted access: ${uid}`, {
        reason: modStatus.banReason,
      });
      return res.status(403).json({
        status: "error",
        code: "ACCOUNT_BANNED",
        message: "Your account has been permanently banned.",
        reason: modStatus.banReason || "Violation of terms of service.",
      });
    }

    if (modStatus.isSuspended) {
      // Check if suspension has expired
      if (modStatus.suspendedUntil) {
        const suspendedUntilMs = new Date(modStatus.suspendedUntil).getTime();
        if (Date.now() > suspendedUntilMs) {
          // Suspension expired — auto-lift in Firestore and invalidate cache
          console.log(
            `[MOD] Suspension expired for uid: ${uid} — auto-lifting`,
          );
          try {
            await adminDb.collection("users").doc(uid).update({
              isSuspended: false,
              suspendReason: admin.firestore.FieldValue.delete(),
              suspendedUntil: admin.firestore.FieldValue.delete(),
            });
            await invalidateModerationCache(uid);
          } catch {
            // Non-fatal — still allow the request through since time has expired
          }
          // Fall through and allow request
        } else {
          const remainingMs = suspendedUntilMs - Date.now();
          const remainingMinutes = Math.ceil(remainingMs / 60000);
          console.warn(`[MOD] ⏸️ Suspended user attempted access: ${uid}`, {
            until: modStatus.suspendedUntil,
          });
          return res.status(403).json({
            status: "error",
            code: "ACCOUNT_SUSPENDED",
            message: `Your account is suspended. Access will be restored in ${remainingMinutes} minute(s).`,
            reason: modStatus.suspendReason || "Account suspended by admin.",
            suspendedUntil: modStatus.suspendedUntil,
          });
        }
      } else {
        // Indefinite suspension
        console.warn(
          `[MOD] ⏸️ Indefinitely suspended user attempted access: ${uid}`,
        );
        return res.status(403).json({
          status: "error",
          code: "ACCOUNT_SUSPENDED",
          message: "Your account has been suspended. Please contact support.",
          reason: modStatus.suspendReason || "Account suspended by admin.",
        });
      }
    }

    // ── 2. Check IP block (Firestore blockedIPs collection) ───────────────
    const clientIP =
      (req as any).realIP || req.ip || req.socket?.remoteAddress || "unknown";
    if (clientIP && clientIP !== "unknown") {
      try {
        const ipCheck = await isIPBlocked(clientIP);
        if (ipCheck.blocked) {
          console.warn(`[MOD] 🌐 Blocked IP attempted access: ${clientIP}`, {
            uid,
            reason: ipCheck.reason,
          });
          return res.status(403).json({
            status: "error",
            code: "IP_BLOCKED",
            message: "Access denied. Your IP address has been blocked.",
            reason: ipCheck.reason,
          });
        }
      } catch (err: any) {
        // Non-fatal
        console.error(
          "[MOD] Failed to check IP block (allowing through):",
          err?.message,
        );
      }
    }

    // ── 3. Check device block (from x-device-id header) ──────────────────
    const deviceId = req.headers["x-device-id"] as string | undefined;
    if (deviceId) {
      try {
        const deviceCheck = await isDeviceBlocked(deviceId);
        if (deviceCheck.blocked) {
          console.warn(
            `[MOD] 📱 Blocked device attempted access: ${deviceId}`,
            { uid, reason: deviceCheck.reason },
          );
          return res.status(403).json({
            status: "error",
            code: "DEVICE_BLOCKED",
            message: "Access denied. This device has been blocked.",
            reason: deviceCheck.reason,
          });
        }
      } catch (err: any) {
        // Non-fatal
        console.error(
          "[MOD] Failed to check device block (allowing through):",
          err?.message,
        );
      }
    }

    // ── 4. Enforce "Under Review" limits ─────────────────────────────────
    // Allow read-only/base navigation but restrict generation/purchases
    if (modStatus.isUnderReview) {
      const restrictedPrefixes = [
        "/api/generations",
        "/api/credits/execute",
        "/api/video-generations",
        "/api/music",
      ];
      const isRestricted =
        restrictedPrefixes.some((prefix) => req.path.startsWith(prefix)) ||
        req.path.includes("/generate");

      if (isRestricted) {
        console.warn(
          `[MOD] ⚠️ Under-review user attempted restricted action: ${uid} on path ${req.path}`,
        );
        return res.status(403).json({
          status: "error",
          code: "ACCOUNT_UNDER_REVIEW",
          message:
            "Your account is temporarily under review. Some features are limited until the review is complete.",
          reason: "Unusual activity detected.",
        });
      }
    }

    return next();
  } catch (error: any) {
    // Catch-all: if moderation check crashes, let request through (don't break the app)
    console.error(
      "[MOD] Unexpected error in moderationGuard (allowing through):",
      error?.message,
    );
    return next();
  }
}

console.log("[MOD] moderationGuard middleware loaded");
