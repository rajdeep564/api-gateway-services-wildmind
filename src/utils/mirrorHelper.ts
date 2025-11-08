import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { generationsMirrorRepository } from '../repository/generationsMirrorRepository';
import { authRepository } from '../repository/auth/authRepository';
import { GenerationHistoryItem } from '../types/generate';

interface CreatedBy {
  uid: string;
  username?: string;
  displayName?: string;
  photoURL?: string;
}

/**
 * Robust mirror sync utility that ensures generations always appear in public repository
 * Retries on failure and logs detailed error information for debugging
 */
export async function syncToMirror(
  uid: string,
  historyId: string,
  retries = 3
): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Fetch fresh data from authoritative history
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (!fresh) {
        console.error(`[MirrorSync] History not found: ${historyId} for user ${uid}`);
        return false;
      }

      // Fetch creator info
      let createdBy: CreatedBy;
      if ((fresh as any).createdBy && (fresh as any).createdBy.uid) {
        // Use existing createdBy if available
        createdBy = (fresh as any).createdBy as CreatedBy;
      } else {
        // Fetch from auth repository
        const creator = await authRepository.getUserById(uid);
        createdBy = {
          uid,
          username: creator?.username,
          displayName: (creator as any)?.displayName,
          photoURL: creator?.photoURL,
        };
      }

      // Sync to mirror repository
      await generationsMirrorRepository.upsertFromHistory(
        uid,
        historyId,
        fresh,
        createdBy
      );

      console.log(`[MirrorSync] ✅ Success (attempt ${attempt}/${retries}): historyId=${historyId}, uid=${uid}, isPublic=${(fresh as any)?.isPublic}, type=${fresh.generationType}`);
      return true;
    } catch (error: any) {
      console.error(
        `[MirrorSync] ❌ Failed (attempt ${attempt}/${retries}): historyId=${historyId}, uid=${uid}`,
        error?.message || error
      );

      if (attempt === retries) {
        // Last attempt failed - log detailed error
        console.error(`[MirrorSync] ⚠️  FINAL FAILURE after ${retries} attempts:`, {
          historyId,
          uid,
          error: error?.message,
          stack: error?.stack,
        });
        return false;
      }

      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
    }
  }

  return false;
}

/**
 * Update mirror with partial data (for status updates, error states, etc.)
 */
export async function updateMirror(
  uid: string,
  historyId: string,
  updates: Partial<GenerationHistoryItem>,
  retries = 2
): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await generationsMirrorRepository.updateFromHistory(uid, historyId, updates);
      console.log(`[MirrorUpdate] ✅ Success: historyId=${historyId}, status=${updates.status}`);
      return true;
    } catch (error: any) {
      console.error(
        `[MirrorUpdate] Failed (attempt ${attempt}/${retries}): historyId=${historyId}`,
        error?.message || error
      );

      if (attempt === retries) {
        console.error(`[MirrorUpdate] FINAL FAILURE:`, { historyId, uid, updates, error: error?.message });
        return false;
      }

      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }

  return false;
}

/**
 * Ensure mirror sync after background operations (e.g., Zata uploads)
 * Use this in setImmediate/background tasks to guarantee eventual consistency
 */
export async function ensureMirrorSync(
  uid: string,
  historyId: string,
  maxRetries = 5
): Promise<void> {
  const success = await syncToMirror(uid, historyId, maxRetries);
  if (!success) {
    // Log to external monitoring/alerting system if available
    console.error(`[MirrorSync] ⚠️⚠️⚠️  CRITICAL: Failed to sync generation ${historyId} for user ${uid} after ${maxRetries} attempts`);
  }
}
