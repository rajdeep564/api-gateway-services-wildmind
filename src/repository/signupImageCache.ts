import { adminDb, admin } from '../config/firebaseAdmin';

/**
 * Signup Image Cache Repository
 * 
 * Stores pre-computed high-scored image URLs for instant signup page loading.
 * This collection is refreshed every 24 hours by a background job.
 */

const COLLECTION_NAME = 'signup_image_cache';

export interface SignupImageCacheItem {
  imageUrl: string;
  prompt?: string;
  generationId?: string;
  creator?: {
    username?: string;
    photoURL?: string;
  };
  cachedAt: Date;
}

/**
 * Get a random image from the cache (instant - < 100ms, no database queries)
 * Returns a DIFFERENT random image on each call for true randomization
 */
export async function getRandomSignupImage(): Promise<SignupImageCacheItem | null> {
  try {
    const col = adminDb.collection(COLLECTION_NAME);
    
    // Get all cached images
    const snapshot = await col.get();
    
    if (snapshot.empty) {
      console.warn('[signupImageCache] No cached images found');
      return null;
    }
    
    // Get all documents
    const docs = snapshot.docs;
    
    if (docs.length === 0) {
      return null;
    }
    
    // TRUE RANDOMIZATION: Pick a different random index each time
    // This ensures every request gets a different image
    const randomIndex = Math.floor(Math.random() * docs.length);
    const randomDoc = docs[randomIndex];
    const data = randomDoc.data();
    
    const result: SignupImageCacheItem = {
      imageUrl: data.imageUrl,
      prompt: data.prompt,
      generationId: data.generationId,
      creator: data.creator,
      cachedAt: data.cachedAt?.toDate() || new Date(),
    };
    
    return result;
  } catch (error) {
    console.error('[signupImageCache] Error getting random image:', error);
    return null;
  }
}

/**
 * Refresh the cache with new high-scored images
 * This should be called by a background job every 24 hours
 */
export async function refreshSignupImageCache(): Promise<number> {
  try {
    console.log('[signupImageCache] Starting cache refresh...');
    
    // Import the repository to fetch high-scored images
    const { publicGenerationsRepository } = await import('./publicGenerationsRepository');
    
    // Fetch 100 random high-scored images for better variety
    // More images = more randomization, less chance of seeing same image
    const images = await publicGenerationsRepository.getRandomHighScoredImages(100);
    
    if (images.length === 0) {
      console.warn('[signupImageCache] No high-scored images found to cache');
      return 0;
    }
    
    // Enrich creator info
    for (const image of images) {
      if (image.creator && image.generationId) {
        try {
          const item = await publicGenerationsRepository.getPublicById(image.generationId);
          if (item?.createdBy?.uid && !image.creator.photoURL) {
            const { authRepository } = await import('./auth/authRepository');
            const user = await authRepository.getUserById(item.createdBy.uid);
            if (user?.photoURL) {
              image.creator.photoURL = user.photoURL;
            }
            if (user?.username && !image.creator.username) {
              image.creator.username = user.username;
            }
          }
        } catch (enrichError) {
          // Non-fatal: continue without enrichment
          console.warn('[signupImageCache] Failed to enrich creator info:', enrichError);
        }
      }
    }
    
    // Clear existing cache in batches (Firestore limit: 500 operations per batch)
    const col = adminDb.collection(COLLECTION_NAME);
    const existingSnapshot = await col.get();
    const BATCH_SIZE = 500; // Firestore batch limit
    
    if (existingSnapshot.size > 0) {
      const docs = existingSnapshot.docs;
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = adminDb.batch();
        const batchDocs = docs.slice(i, i + BATCH_SIZE);
        
        batchDocs.forEach((doc) => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
      }
      console.log(`[signupImageCache] Cleared ${existingSnapshot.size} old cached images`);
    }
    
    // Add new images to cache in batches
    const now = new Date();
    
    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = adminDb.batch();
      const batchImages = images.slice(i, i + BATCH_SIZE);
      
      batchImages.forEach((image) => {
        const docRef = col.doc();
        batch.set(docRef, {
          imageUrl: image.imageUrl,
          prompt: image.prompt || null,
          generationId: image.generationId || null,
          creator: image.creator || null,
          cachedAt: admin.firestore.Timestamp.fromDate(now),
        });
      });
      
      await batch.commit();
      console.log(`[signupImageCache] Cached batch ${Math.floor(i / BATCH_SIZE) + 1} (${batchImages.length} images)`);
    }
    
    console.log(`[signupImageCache] ✅ Cached ${images.length} new images total`);
    
    return images.length;
  } catch (error) {
    console.error('[signupImageCache] Error refreshing cache:', error);
    throw error;
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{ count: number; oldestCache?: Date; newestCache?: Date }> {
  try {
    const col = adminDb.collection(COLLECTION_NAME);
    const snapshot = await col.orderBy('cachedAt', 'desc').get();
    
    if (snapshot.empty) {
      return { count: 0 };
    }
    
    const docs = snapshot.docs;
    const newest = docs[0].data().cachedAt?.toDate();
    const oldest = docs[docs.length - 1].data().cachedAt?.toDate();
    
    return {
      count: docs.length,
      newestCache: newest,
      oldestCache: oldest,
    };
  } catch (error) {
    console.error('[signupImageCache] Error getting cache stats:', error);
    return { count: 0 };
  }
}

export const signupImageCache = {
  getRandomSignupImage,
  refreshSignupImageCache,
  getCacheStats,
};

