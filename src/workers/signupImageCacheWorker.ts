/**
 * Signup Image Cache Worker
 * 
 * Background job that refreshes the signup image cache every 24 hours.
 * This ensures the signup page always has fresh, high-scored images ready for instant loading.
 * 
 * Run this as a separate process or schedule it via cron/Cloud Scheduler.
 */

import 'dotenv/config';
import { signupImageCache } from '../repository/signupImageCache';

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let running = true;

process.on('SIGINT', () => {
  console.log('[SignupImageCacheWorker] SIGINT received, shutting down...');
  running = false;
});

process.on('SIGTERM', () => {
  console.log('[SignupImageCacheWorker] SIGTERM received, shutting down...');
  running = false;
});

async function refreshCache() {
  try {
    console.log('[SignupImageCacheWorker] Starting cache refresh...');
    const startTime = Date.now();
    
    const count = await signupImageCache.refreshSignupImageCache();
    
    const duration = Date.now() - startTime;
    console.log(`[SignupImageCacheWorker] ✅ Cache refreshed successfully in ${duration}ms`, {
      imagesCached: count,
      nextRefreshIn: `${REFRESH_INTERVAL_MS / (60 * 60 * 1000)} hours`,
    });
  } catch (error: any) {
    console.error('[SignupImageCacheWorker] ❌ Cache refresh failed:', {
      message: error?.message,
      stack: error?.stack?.substring(0, 500),
    });
  }
}

async function loop() {
  console.log('[SignupImageCacheWorker] Starting worker', {
    refreshInterval: `${REFRESH_INTERVAL_MS / (60 * 60 * 1000)} hours`,
  });
  
  // Refresh immediately on startup
  await refreshCache();
  
  // Then refresh every 24 hours
  while (running) {
    await new Promise(resolve => setTimeout(resolve, REFRESH_INTERVAL_MS));
    if (running) {
      await refreshCache();
    }
  }
  
  console.log('[SignupImageCacheWorker] Exiting worker');
}

// Start the worker
loop().catch((error) => {
  console.error('[SignupImageCacheWorker] Fatal error:', error);
  process.exit(1);
});

