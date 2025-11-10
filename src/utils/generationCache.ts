import { getRedisClient } from '../config/redisClient';
import { GenerationHistoryItem } from '../types/generate';

const CACHE_TTL = 60 * 5; // 5 minutes cache for generation items
const LIST_CACHE_TTL = 60 * 2; // 2 minutes for list results

function getClient() {
  return getRedisClient();
}

/**
 * Cache key generators
 */
function getItemCacheKey(uid: string, historyId: string): string {
  return `gen:item:${uid}:${historyId}`;
}

function getListCacheKey(uid: string, params: any): string {
  const { limit = 20, nextCursor, status, generationType, search } = params;
  const typeKey = Array.isArray(generationType) ? generationType.sort().join(',') : (generationType || 'all');
  const searchKey = search ? `:search:${search.substring(0, 20)}` : '';
  return `gen:list:${uid}:${limit}:${nextCursor || 'start'}:${status || 'all'}:${typeKey}${searchKey}`;
}

/**
 * Get cached generation item
 */
export async function getCachedItem(uid: string, historyId: string): Promise<GenerationHistoryItem | null> {
  try {
    const client = getClient();
    if (!client) {
      console.log('[generationCache] ❌ No Redis client available');
      return null;
    }
    const key = getItemCacheKey(uid, historyId);
    const cached = await client.get(key);
    if (!cached) {
      console.log(`[generationCache] ⚠️  CACHE MISS: ${key}`);
      return null;
    }
    console.log(`[generationCache] ✅ CACHE HIT: ${key}`);
    return JSON.parse(cached) as GenerationHistoryItem;
  } catch (error) {
    console.warn('[generationCache] getCachedItem error:', error);
    return null;
  }
}

/**
 * Cache generation item
 */
export async function setCachedItem(uid: string, historyId: string, item: GenerationHistoryItem): Promise<void> {
  try {
    const client = getClient();
    if (!client) {
      console.log('[generationCache] ❌ No Redis client available for caching');
      return;
    }
    const key = getItemCacheKey(uid, historyId);
    await client.setEx(key, CACHE_TTL, JSON.stringify(item));
    console.log(`[generationCache] 💾 CACHED: ${key} (TTL: ${CACHE_TTL}s)`);
  } catch (error) {
    console.warn('[generationCache] setCachedItem error:', error);
  }
}

/**
 * Invalidate single item cache
 */
export async function invalidateItem(uid: string, historyId: string): Promise<void> {
  try {
    const client = getClient();
    if (!client) return;
    const key = getItemCacheKey(uid, historyId);
    await client.del(key);
    // Also invalidate all list caches for this user
    await invalidateUserLists(uid);
  } catch (error) {
    console.warn('[generationCache] invalidateItem error:', error);
  }
}

/**
 * Get cached list results
 */
export async function getCachedList(uid: string, params: any): Promise<any | null> {
  try {
    const client = getClient();
    if (!client) {
      console.log('[generationCache] ❌ No Redis client available');
      return null;
    }
    const key = getListCacheKey(uid, params);
    const cached = await client.get(key);
    if (!cached) {
      console.log(`[generationCache] ⚠️  LIST CACHE MISS: ${key}`);
      return null;
    }
    console.log(`[generationCache] ✅ LIST CACHE HIT: ${key}`);
    return JSON.parse(cached);
  } catch (error) {
    console.warn('[generationCache] getCachedList error:', error);
    return null;
  }
}

/**
 * Cache list results
 */
export async function setCachedList(uid: string, params: any, result: any): Promise<void> {
  try {
    const client = getClient();
    if (!client) {
      console.log('[generationCache] ❌ No Redis client available for list caching');
      return;
    }
    const key = getListCacheKey(uid, params);
    await client.setEx(key, LIST_CACHE_TTL, JSON.stringify(result));
    console.log(`[generationCache] 💾 LIST CACHED: ${key} (TTL: ${LIST_CACHE_TTL}s, items: ${result.items?.length || 0})`);
  } catch (error) {
    console.warn('[generationCache] setCachedList error:', error);
  }
}

/**
 * Invalidate all list caches for a user (used when new generation is created or updated)
 */
export async function invalidateUserLists(uid: string): Promise<void> {
  try {
    const client = getClient();
    if (!client) return;
    const pattern = `gen:list:${uid}:*`;
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      // Delete keys one by one or in batch
      if (keys.length === 1) {
        await client.del(keys[0]);
      } else {
        // Use multi for batch delete
        const multi = client.multi();
        keys.forEach(key => multi.del(key));
        await multi.exec();
      }
    }
  } catch (error) {
    console.warn('[generationCache] invalidateUserLists error:', error);
  }
}

/**
 * Batch get multiple items (for list optimization)
 */
export async function getCachedItemsBatch(uid: string, historyIds: string[]): Promise<Map<string, GenerationHistoryItem>> {
  const result = new Map<string, GenerationHistoryItem>();
  
  if (historyIds.length === 0) return result;
  
  try {
    const client = getClient();
    if (!client) return result;
    const keys = historyIds.map(id => getItemCacheKey(uid, id));
    const values = await client.mGet(keys);
    
    values.forEach((value: string | null, index: number) => {
      if (value) {
        try {
          result.set(historyIds[index], JSON.parse(value));
        } catch {}
      }
    });
  } catch (error) {
    console.warn('[generationCache] getCachedItemsBatch error:', error);
  }
  
  return result;
}

/**
 * Batch set multiple items
 */
export async function setCachedItemsBatch(uid: string, items: GenerationHistoryItem[]): Promise<void> {
  if (items.length === 0) return;
  
  try {
    const client = getClient();
    if (!client) return;
    
    // Use multi for batch operations
    const multi = client.multi();
    
    items.forEach(item => {
      const key = getItemCacheKey(uid, item.id);
      multi.setEx(key, CACHE_TTL, JSON.stringify(item));
    });
    
    await multi.exec();
  } catch (error) {
    console.warn('[generationCache] setCachedItemsBatch error:', error);
  }
}
