import { adminDb } from '../config/firebaseAdmin';
import { logger } from '../utils/logger';

export type QueueItemStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface QueueItem {
  id: string;
  queuePosition: number;
  status: QueueItemStatus;
  generationType: string;
  provider: string;
  payload: any;
  historyId?: string;
  creditsCost: number;
  creditsDeducted: boolean;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: any;
  metadata?: Record<string, any>;
}

/**
 * Create a queue item
 */
export async function createQueueItem(
  uid: string,
  item: Omit<QueueItem, 'id' | 'createdAt'>
): Promise<string> {
  try {
    const col = adminDb.collection('users').doc(uid).collection('queue');
    const docRef = await col.add({
      ...item,
      createdAt: Date.now(),
    });
    
    logger.info({ uid, queueId: docRef.id, generationType: item.generationType }, '[Queue] Created queue item');
    return docRef.id;
  } catch (error: any) {
    logger.error({ uid, error: error.message }, '[Queue] Failed to create queue item');
    throw error;
  }
}

/**
 * Get queue item by ID
 */
export async function getQueueItem(uid: string, queueId: string): Promise<QueueItem | null> {
  try {
    const docRef = adminDb.collection('users').doc(uid).collection('queue').doc(queueId);
    const snap = await docRef.get();
    
    if (!snap.exists) {
      return null;
    }
    
    return {
      id: snap.id,
      ...snap.data(),
    } as QueueItem;
  } catch (error: any) {
    logger.error({ uid, queueId, error: error.message }, '[Queue] Failed to get queue item');
    return null;
  }
}

/**
 * Get all queue items for a user
 */
export async function getUserQueueItems(
  uid: string,
  status?: QueueItemStatus
): Promise<QueueItem[]> {
  try {
    let query = adminDb.collection('users').doc(uid).collection('queue').orderBy('createdAt', 'asc');
    
    if (status) {
      query = query.where('status', '==', status) as any;
    }
    
    const snap = await query.get();
    return snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as QueueItem[];
  } catch (error: any) {
    logger.error({ uid, error: error.message }, '[Queue] Failed to get user queue items');
    return [];
  }
}

/**
 * Get next queued item for processing
 */
export async function getNextQueueItem(uid: string): Promise<QueueItem | null> {
  try {
    const query = adminDb
      .collection('users')
      .doc(uid)
      .collection('queue')
      .where('status', '==', 'queued')
      .orderBy('createdAt', 'asc')
      .limit(1);
    
    const snap = await query.get();
    
    if (snap.empty) {
      return null;
    }
    
    const doc = snap.docs[0];
    return {
      id: doc.id,
      ...doc.data(),
    } as QueueItem;
  } catch (error: any) {
    logger.error({ uid, error: error.message }, '[Queue] Failed to get next queue item');
    return null;
  }
}

/**
 * Update queue item status
 */
export async function updateQueueItemStatus(
  uid: string,
  queueId: string,
  updates: {
    status?: QueueItemStatus;
    error?: string;
    result?: any;
    historyId?: string;
    startedAt?: number;
    completedAt?: number;
  }
): Promise<void> {
  try {
    const docRef = adminDb.collection('users').doc(uid).collection('queue').doc(queueId);
    const updateData: any = {};
    
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.error !== undefined) updateData.error = updates.error;
    if (updates.result !== undefined) updateData.result = updates.result;
    if (updates.historyId !== undefined) updateData.historyId = updates.historyId;
    if (updates.startedAt !== undefined) updateData.startedAt = updates.startedAt;
    if (updates.completedAt !== undefined) updateData.completedAt = updates.completedAt;
    
    await docRef.update(updateData);
    logger.info({ uid, queueId, updates }, '[Queue] Updated queue item status');
  } catch (error: any) {
    logger.error({ uid, queueId, error: error.message }, '[Queue] Failed to update queue item status');
    throw error;
  }
}

/**
 * Mark credits as deducted
 */
export async function markCreditsDeducted(uid: string, queueId: string): Promise<void> {
  try {
    const docRef = adminDb.collection('users').doc(uid).collection('queue').doc(queueId);
    await docRef.update({ creditsDeducted: true });
    logger.info({ uid, queueId }, '[Queue] Marked credits as deducted');
  } catch (error: any) {
    logger.error({ uid, queueId, error: error.message }, '[Queue] Failed to mark credits deducted');
    throw error;
  }
}

/**
 * Delete queue item
 */
export async function deleteQueueItem(uid: string, queueId: string): Promise<void> {
  try {
    const docRef = adminDb.collection('users').doc(uid).collection('queue').doc(queueId);
    await docRef.delete();
    logger.info({ uid, queueId }, '[Queue] Deleted queue item');
  } catch (error: any) {
    logger.error({ uid, queueId, error: error.message }, '[Queue] Failed to delete queue item');
    throw error;
  }
}

/**
 * Clean up old completed items (older than specified hours)
 */
export async function cleanupOldQueueItems(uid: string, olderThanHours: number = 24): Promise<number> {
  try {
    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
    const query = adminDb
      .collection('users')
      .doc(uid)
      .collection('queue')
      .where('status', 'in', ['completed', 'failed', 'cancelled'])
      .where('completedAt', '<', cutoffTime);
    
    const snap = await query.get();
    const batch = adminDb.batch();
    let count = 0;
    
    snap.docs.forEach(doc => {
      batch.delete(doc.ref);
      count++;
    });
    
    if (count > 0) {
      await batch.commit();
      logger.info({ uid, deletedCount: count }, '[Queue] Cleaned up old queue items');
    }
    
    return count;
  } catch (error: any) {
    logger.error({ uid, error: error.message }, '[Queue] Failed to cleanup old queue items');
    return 0;
  }
}

// Export repository object
export const queueRepository = {
  createQueueItem,
  getQueueItem,
  getUserQueueItems,
  getNextQueueItem,
  updateQueueItemStatus,
  markCreditsDeducted,
  deleteQueueItem,
  cleanupOldQueueItems,
};

