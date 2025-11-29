import { adminDb, admin } from '../config/firebaseAdmin';
import { GenerationHistoryItem } from '../types/generate';
import { generationHistoryRepository } from './generationHistoryRepository';

interface CreatedBy {
  uid: string;
  username?: string;
  displayName?: string;
  photoURL?: string;
}

export async function upsertFromHistory(uid: string, historyId: string, historyDoc: GenerationHistoryItem, createdBy: CreatedBy): Promise<void> {
  // CRITICAL: If item is deleted or not public, remove it from mirror instead of upserting
  if ((historyDoc as any)?.isDeleted === true) {
    console.log('[Mirror][Upsert] Item is deleted - removing from mirror instead of upserting:', { historyId, uid });
    await remove(historyId);
    return;
  }
  
  if ((historyDoc as any)?.isPublic !== true) {
    console.log('[Mirror][Upsert] Item is not public - removing from mirror instead of upserting:', { historyId, uid, isPublic: (historyDoc as any)?.isPublic });
    await remove(historyId);
    return;
  }
  
  try {
    // eslint-disable-next-line no-console
    const imgs: any[] = Array.isArray((historyDoc as any)?.images) ? ((historyDoc as any).images as any[]) : [];
    const optimizedCount = imgs.filter((im: any) => im?.thumbnailUrl || im?.avifUrl).length;
    const sample = imgs.length > 0 ? imgs[0] : null;
    console.log('[Mirror][Upsert]', {
      historyId,
      uid,
      isPublic: (historyDoc as any)?.isPublic,
      visibility: (historyDoc as any)?.visibility,
      generationType: (historyDoc as any)?.generationType,
      images: imgs.length,
      imagesWithOptimized: optimizedCount,
      sampleFirstHasThumbnail: !!(sample && sample.thumbnailUrl),
      sampleFirstHasAvif: !!(sample && sample.avifUrl),
      sampleFirstThumbnail: sample && typeof sample.thumbnailUrl === 'string' ? sample.thumbnailUrl : undefined,
      sampleFirstAvif: sample && typeof sample.avifUrl === 'string' ? sample.avifUrl : undefined,
    });
  } catch {}
  // Defensive: if the provided historyDoc lacks optimized fields, try to fetch a fresh copy
  // CRITICAL: Also check if the fresh copy is deleted - if so, remove from mirror instead
  try {
    const imgs: any[] = Array.isArray((historyDoc as any)?.images) ? ((historyDoc as any).images as any[]) : [];
    const hasOptimized = imgs.some((im: any) => im?.thumbnailUrl || im?.avifUrl);
    if (!hasOptimized && uid && historyId) {
      try {
        const fresh = await generationHistoryRepository.get(uid, historyId);
        if (fresh) {
          // CRITICAL: Check if fresh copy is deleted - if so, remove from mirror instead of upserting
          if ((fresh as any)?.isDeleted === true) {
            console.log('[Mirror][Upsert] Fresh history doc is deleted - removing from mirror instead of upserting:', { historyId, uid });
            await remove(historyId);
            return;
          }
          
          // Check if fresh copy has optimized fields
          if (Array.isArray((fresh as any).images)) {
            const freshHasOpt = (fresh as any).images.some((im: any) => im?.thumbnailUrl || im?.avifUrl);
            if (freshHasOpt) {
              historyDoc = fresh as GenerationHistoryItem;
              try { console.log('[Mirror][Upsert] Replacing stale snapshot with fresh history doc (contains optimized fields) ', { historyId, uid }); } catch {}
            }
          }
        }
      } catch (e) {
        // ignore fresh read errors
      }
    }
  } catch {}
  const ref = adminDb.collection('generations').doc(historyId);
  await ref.set({
    ...historyDoc,
    createdBy,
    uid,
    id: historyId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(historyDoc.createdAt ? { createdAt: historyDoc.createdAt } : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
  }, { merge: true });
}

/**
 * Remove undefined values from an object recursively
 * Firestore doesn't allow undefined values
 */
function removeUndefinedValues(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedValues(item));
  }
  
  const cleaned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = removeUndefinedValues(value);
    }
  }
  return cleaned;
}

export async function updateFromHistory(uid: string, historyId: string, updates: Partial<GenerationHistoryItem>): Promise<void> {
  // CRITICAL: If item is being marked as deleted or not public, remove it from mirror instead of updating
  if ((updates as any)?.isDeleted === true) {
    console.log('[Mirror][Update] Item is being marked as deleted - removing from mirror instead of updating:', { historyId, uid });
    await remove(historyId);
    return;
  }
  
  // If isPublic is explicitly set to false, remove from mirror
  if ((updates as any)?.isPublic === false) {
    console.log('[Mirror][Update] Item is being marked as not public - removing from mirror instead of updating:', { historyId, uid });
    await remove(historyId);
    return;
  }
  
  try {
    // eslint-disable-next-line no-console
    const imgs: any[] = Array.isArray((updates as any)?.images) ? ((updates as any).images as any[]) : [];
    const optimizedCount = imgs.filter((im: any) => im?.thumbnailUrl || im?.avifUrl).length;
    const sample = imgs.length > 0 ? imgs[0] : null;
    console.log('[Mirror][Update]', {
      historyId,
      uid,
      isPublic: (updates as any)?.isPublic,
      visibility: (updates as any)?.visibility,
      generationType: (updates as any)?.generationType,
      images: imgs.length || undefined,
      imagesWithOptimized: imgs.length ? optimizedCount : undefined,
      sampleFirstHasThumbnail: !!(sample && sample.thumbnailUrl),
      sampleFirstHasAvif: !!(sample && sample.avifUrl),
      sampleFirstThumbnail: sample && typeof sample.thumbnailUrl === 'string' ? sample.thumbnailUrl : undefined,
      sampleFirstAvif: sample && typeof sample.avifUrl === 'string' ? sample.avifUrl : undefined,
    });
  } catch {}
  const ref = adminDb.collection('generations').doc(historyId);
  
  // Remove undefined values before saving to Firestore
  const cleanedUpdates = removeUndefinedValues(updates);
  
  await ref.set({
    ...cleanedUpdates,
    uid,
    id: historyId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  } as any, { merge: true });
}

export async function remove(historyId: string): Promise<void> {
  console.log('[Mirror][Remove] Starting removal from public mirror:', { historyId, timestamp: new Date().toISOString() });
  
  try {
    const ref = adminDb.collection('generations').doc(historyId);
    
    // Check if document exists before deleting
    const doc = await ref.get();
    if (!doc.exists) {
      console.log('[Mirror][Remove] Document does not exist in mirror (already deleted or never existed):', historyId);
      return;
    }
    
    await ref.delete();
    console.log('[Mirror][Remove] ✅ Successfully deleted from public mirror repository:', historyId);
  } catch (e: any) {
    console.error('[Mirror][Remove] ❌ Failed to delete from mirror:', {
      historyId,
      error: e?.message || e,
      stack: e?.stack,
    });
    throw e; // Re-throw to allow caller to handle
  }
}

export const generationsMirrorRepository = {
  upsertFromHistory,
  updateFromHistory,
  remove,
};

