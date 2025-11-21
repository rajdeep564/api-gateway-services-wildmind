import { mirrorQueueRepository } from '../repository/mirrorQueueRepository';
import { generationsMirrorRepository } from '../repository/generationsMirrorRepository';
import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { authRepository } from '../repository/auth/authRepository';
import { logger } from '../utils/logger';

/**
 * Mirror Queue Worker
 * 
 * Processes mirror queue tasks asynchronously with retry logic.
 * Can be run as:
 * 1. Cloud Function onCreate trigger on mirrorQueue collection
 * 2. Scheduled cron job that polls pending tasks
 * 3. Standalone worker process
 */

export async function processMirrorTask(taskId: string, task: any): Promise<void> {
  const { op, uid, historyId, itemSnapshot, updates } = task;
  
  logger.info({ taskId, op, uid, historyId }, '[MirrorWorker] Processing task');
  
  try {
    // Claim the task
    const claimed = await mirrorQueueRepository.claimTask(taskId);
    if (!claimed) {
      logger.warn({ taskId }, '[MirrorWorker] Task already claimed or completed');
      return;
    }
    
    if (op === 'upsert') {
      // Prefer the freshest item from generationHistory to avoid writing pre-optimized snapshots.
      // If a fresh read fails, fall back to the snapshot provided in the task (if any).
      let item = itemSnapshot;
      try {
        if (uid && historyId) {
          const fresh = await generationHistoryRepository.get(uid, historyId);
          if (fresh) {
            // CRITICAL: If fresh item is deleted, remove from mirror instead of upserting
            if ((fresh as any)?.isDeleted === true) {
              logger.info({ historyId, uid }, '[MirrorWorker] Fresh item is deleted - removing from mirror instead of upserting');
              await generationsMirrorRepository.remove(historyId);
              await mirrorQueueRepository.markCompleted(taskId);
              return;
            }
            item = fresh;
          }
        }
      } catch (e) {
        // Non-blocking: we'll fall back to the provided snapshot below.
      }

      if (!item) {
        throw new Error('Item not found for upsert operation');
      }

      // CRITICAL: Double-check item snapshot is not deleted before upserting
      if ((item as any)?.isDeleted === true) {
        logger.info({ historyId, uid }, '[MirrorWorker] Item snapshot is deleted - removing from mirror instead of upserting');
        await generationsMirrorRepository.remove(historyId);
        await mirrorQueueRepository.markCompleted(taskId);
        return;
      }

      // Get creator metadata
      const creator = await authRepository.getUserById(uid);

      await generationsMirrorRepository.upsertFromHistory(uid, historyId, item, {
        uid,
        username: creator?.username,
        displayName: (creator as any)?.displayName,
        photoURL: creator?.photoURL,
      });
      
    } else if (op === 'update') {
      if (!updates) {
        throw new Error('Updates not provided for update operation');
      }
      
      await generationsMirrorRepository.updateFromHistory(uid, historyId, updates);
      
    } else if (op === 'remove') {
      await generationsMirrorRepository.remove(historyId);
      
    } else {
      throw new Error(`Unknown operation: ${op}`);
    }
    
    // Mark completed and delete from queue
    await mirrorQueueRepository.markCompleted(taskId);
    logger.info({ taskId, op }, '[MirrorWorker] Task completed successfully');
    
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error';
    logger.error({ taskId, error: errorMessage }, '[MirrorWorker] Task failed');
    
    // Mark failed if max attempts reached
    if (task.attempts >= 4) {
      await mirrorQueueRepository.markFailed(taskId, errorMessage);
    }
    
    throw error;
  }
}

/**
 * Poll and process pending tasks in batch.
 * Call this from a scheduled job (e.g., every 30 seconds).
 */
export async function processPendingTasks(batchSize = 10): Promise<void> {
  logger.info({ batchSize }, '[MirrorWorker] Polling for pending tasks');
  
  const tasks = await mirrorQueueRepository.pollPendingTasks(batchSize);
  
  if (tasks.length === 0) {
    logger.debug('[MirrorWorker] No pending tasks');
    return;
  }
  
  logger.info({ count: tasks.length }, '[MirrorWorker] Processing tasks');
  
  // Process tasks sequentially to avoid overwhelming Firestore
  for (const { id, task } of tasks) {
    try {
      await processMirrorTask(id, task);
    } catch (error) {
      // Continue processing other tasks even if one fails
      logger.error({ taskId: id, error }, '[MirrorWorker] Task processing error');
    }
  }
}

export const mirrorWorker = {
  processMirrorTask,
  processPendingTasks,
};
