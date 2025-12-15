import { queueRepository, QueueItem, QueueItemStatus } from '../repository/queueRepository';
import { creditsRepository } from '../repository/creditsRepository';
import { issueRefund } from '../utils/creditDebit';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/errorHandler';
import { creditsService } from './creditsService';

/**
 * Add generation to queue and deduct credits immediately
 */
export async function addToQueue(
  uid: string,
  data: {
    generationType: string;
    provider: string;
    payload: any;
    creditsCost: number;
    metadata?: Record<string, any>;
  }
): Promise<{ queueId: string; queuePosition: number }> {
  try {
    // Ensure user is initialized
    await creditsService.ensureUserInit(uid);

    // Check if user has enough credits
    const creditBalance = await creditsRepository.readUserCredits(uid);
    if (creditBalance < data.creditsCost) {
      throw new ApiError('Insufficient credits', 402);
    }

    // Get current queue to calculate position
    const existingQueue = await queueRepository.getUserQueueItems(uid, 'queued');
    const queuePosition = existingQueue.length + 1;

    // Create queue item
    const queueId = await queueRepository.createQueueItem(uid, {
      queuePosition,
      status: 'queued',
      generationType: data.generationType,
      provider: data.provider,
      payload: data.payload,
      creditsCost: data.creditsCost,
      creditsDeducted: false, // Will be set to true after successful deduction
      metadata: data.metadata || {},
    });

    // Deduct credits immediately using queueId as idempotency key
    const reason = `queue.${data.provider}.${data.generationType}`;
    const debitOutcome = await creditsRepository.writeDebitIfAbsent(
      uid,
      queueId,
      data.creditsCost,
      reason,
      {
        queueId,
        generationType: data.generationType,
        provider: data.provider,
        metadata: data.metadata,
      }
    );

    if (debitOutcome === 'WRITTEN' || debitOutcome === 'SKIPPED') {
      // Mark credits as deducted
      await queueRepository.markCreditsDeducted(uid, queueId);
      logger.info({ uid, queueId, creditsCost: data.creditsCost }, '[Queue] Credits deducted for queue item');
    } else {
      // If debit failed, delete the queue item
      await queueRepository.deleteQueueItem(uid, queueId);
      throw new ApiError('Failed to deduct credits', 500);
    }

    return { queueId, queuePosition };
  } catch (error: any) {
    logger.error({ uid, error: error.message }, '[Queue] Failed to add to queue');
    throw error;
  }
}

/**
 * Get queue item status
 */
export async function getQueueItemStatus(
  uid: string,
  queueId: string
): Promise<QueueItem | null> {
  return await queueRepository.getQueueItem(uid, queueId);
}

/**
 * Get user's queue items
 */
export async function getUserQueue(
  uid: string,
  status?: QueueItemStatus
): Promise<QueueItem[]> {
  return await queueRepository.getUserQueueItems(uid, status);
}

/**
 * Cancel queue item and refund credits
 */
export async function cancelQueueItem(
  uid: string,
  queueId: string
): Promise<{ refunded: boolean }> {
  try {
    const item = await queueRepository.getQueueItem(uid, queueId);
    
    if (!item) {
      throw new ApiError('Queue item not found', 404);
    }

    // Only allow cancellation of queued or processing items
    if (item.status !== 'queued' && item.status !== 'processing') {
      throw new ApiError('Cannot cancel item in this status', 400);
    }

    // Update status to cancelled
    await queueRepository.updateQueueItemStatus(uid, queueId, {
      status: 'cancelled',
      completedAt: Date.now(),
    });

    // Refund credits if they were deducted
    let refunded = false;
    if (item.creditsDeducted && item.creditsCost > 0) {
      const refundOutcome = await issueRefund(
        uid,
        queueId,
        item.creditsCost,
        `queue.cancel.${item.provider}.${item.generationType}`,
        {
          queueId,
          originalReason: `queue.${item.provider}.${item.generationType}`,
        }
      );
      refunded = refundOutcome === 'WRITTEN';
      logger.info({ uid, queueId, refunded, creditsCost: item.creditsCost }, '[Queue] Refunded credits for cancelled item');
    }

    return { refunded };
  } catch (error: any) {
    logger.error({ uid, queueId, error: error.message }, '[Queue] Failed to cancel queue item');
    throw error;
  }
}

/**
 * Mark queue item as failed and refund credits
 */
export async function markQueueItemFailed(
  uid: string,
  queueId: string,
  error: string
): Promise<void> {
  try {
    const item = await queueRepository.getQueueItem(uid, queueId);
    
    if (!item) {
      logger.warn({ uid, queueId }, '[Queue] Item not found for failure marking');
      return;
    }

    // Update status to failed
    await queueRepository.updateQueueItemStatus(uid, queueId, {
      status: 'failed',
      error,
      completedAt: Date.now(),
    });

    // Refund credits if they were deducted
    if (item.creditsDeducted && item.creditsCost > 0) {
      const refundOutcome = await issueRefund(
        uid,
        queueId,
        item.creditsCost,
        `queue.failed.${item.provider}.${item.generationType}`,
        {
          queueId,
          error,
          originalReason: `queue.${item.provider}.${item.generationType}`,
        }
      );
      logger.info({ uid, queueId, refunded: refundOutcome === 'WRITTEN', creditsCost: item.creditsCost }, '[Queue] Refunded credits for failed item');
    }
  } catch (error: any) {
    logger.error({ uid, queueId, error: error.message }, '[Queue] Failed to mark item as failed');
    // Don't throw - failure marking shouldn't block other operations
  }
}

/**
 * Mark queue item as completed
 */
export async function markQueueItemCompleted(
  uid: string,
  queueId: string,
  result: any,
  historyId?: string
): Promise<void> {
  try {
    await queueRepository.updateQueueItemStatus(uid, queueId, {
      status: 'completed',
      result,
      historyId,
      completedAt: Date.now(),
    });
    logger.info({ uid, queueId, historyId }, '[Queue] Marked item as completed');
  } catch (error: any) {
    logger.error({ uid, queueId, error: error.message }, '[Queue] Failed to mark item as completed');
    throw error;
  }
}

/**
 * Update queue item status (for processing)
 */
export async function updateQueueItemStatus(
  uid: string,
  queueId: string,
  status: QueueItemStatus,
  updates?: {
    error?: string;
    result?: any;
    historyId?: string;
    startedAt?: number;
  }
): Promise<void> {
  try {
    const updateData: any = { status };
    
    if (status === 'processing' && !updates?.startedAt) {
      updateData.startedAt = Date.now();
    } else if (updates?.startedAt) {
      updateData.startedAt = updates.startedAt;
    }
    
    if (updates?.error) updateData.error = updates.error;
    if (updates?.result) updateData.result = updates.result;
    if (updates?.historyId) updateData.historyId = updates.historyId;
    
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updateData.completedAt = Date.now();
    }

    await queueRepository.updateQueueItemStatus(uid, queueId, updateData);
  } catch (error: any) {
    logger.error({ uid, queueId, error: error.message }, '[Queue] Failed to update queue item status');
    throw error;
  }
}

/**
 * Cleanup old queue items
 */
export async function cleanupOldQueueItems(uid: string): Promise<number> {
  return await queueRepository.cleanupOldQueueItems(uid, 24); // 24 hours
}

// Export service object
export const queueService = {
  addToQueue,
  getQueueItemStatus,
  getUserQueue,
  cancelQueueItem,
  markQueueItemFailed,
  markQueueItemCompleted,
  updateQueueItemStatus,
  cleanupOldQueueItems,
};

