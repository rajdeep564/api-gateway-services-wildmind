import { adminDb, admin } from '../config/firebaseAdmin';
import { GenerationHistoryItem } from '../types/generate';

export interface MirrorQueueTask {
  op: 'upsert' | 'update' | 'remove';
  uid: string;
  historyId: string;
  itemSnapshot?: GenerationHistoryItem;
  updates?: Partial<GenerationHistoryItem>;
  createdAt: FirebaseFirestore.FieldValue;
  attempts: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  processedAt?: FirebaseFirestore.FieldValue;
}

/**
 * Lightweight Firestore-based queue for async mirror operations.
 * Workers listen to onCreate events or poll pending tasks.
 */

export async function enqueueUpsert(payload: {
  uid: string;
  historyId: string;
  itemSnapshot?: GenerationHistoryItem;
}): Promise<void> {
  const col = adminDb.collection('mirrorQueue');
  await col.add({
    op: 'upsert',
    uid: payload.uid,
    historyId: payload.historyId,
    itemSnapshot: payload.itemSnapshot || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    attempts: 0,
    status: 'pending',
  } as Partial<MirrorQueueTask>);
}

export async function enqueueUpdate(payload: {
  uid: string;
  historyId: string;
  updates: Partial<GenerationHistoryItem>;
}): Promise<void> {
  const col = adminDb.collection('mirrorQueue');
  await col.add({
    op: 'update',
    uid: payload.uid,
    historyId: payload.historyId,
    updates: payload.updates,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    attempts: 0,
    status: 'pending',
  } as Partial<MirrorQueueTask>);
}

export async function enqueueRemove(payload: {
  historyId: string;
}): Promise<void> {
  const col = adminDb.collection('mirrorQueue');
  await col.add({
    op: 'remove',
    uid: '',
    historyId: payload.historyId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    attempts: 0,
    status: 'pending',
  } as Partial<MirrorQueueTask>);
}

/**
 * Poll pending tasks (for worker that doesn't use onCreate trigger).
 * Returns up to `limit` tasks that are pending or stale (processing > 5 min).
 */
export async function pollPendingTasks(limit = 10): Promise<Array<{ id: string; task: MirrorQueueTask }>> {
  const col = adminDb.collection('mirrorQueue');
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
  
  // Get pending or stale processing tasks
  const snap = await col
    .where('status', 'in', ['pending', 'processing'])
    .where('attempts', '<', 5)
    .orderBy('attempts', 'asc')
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get();
  
  return snap.docs.map((doc) => ({
    id: doc.id,
    task: doc.data() as MirrorQueueTask,
  }));
}

/**
 * Mark task as processing (claim it).
 */
export async function claimTask(taskId: string): Promise<boolean> {
  const ref = adminDb.collection('mirrorQueue').doc(taskId);
  try {
    await adminDb.runTransaction(async (t) => {
      const doc = await t.get(ref);
      if (!doc.exists) throw new Error('Task not found');
      const data = doc.data() as MirrorQueueTask;
      if (data.status === 'processing' || data.status === 'completed') {
        throw new Error('Task already claimed or completed');
      }
      t.update(ref, {
        status: 'processing',
        attempts: admin.firestore.FieldValue.increment(1),
      });
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark task as completed and delete it (or keep for audit).
 */
export async function markCompleted(taskId: string): Promise<void> {
  const ref = adminDb.collection('mirrorQueue').doc(taskId);
  // Option 1: delete completed tasks to keep queue small
  await ref.delete();
  
  // Option 2: mark completed and have a separate cleanup job
  // await ref.update({
  //   status: 'completed',
  //   processedAt: admin.firestore.FieldValue.serverTimestamp(),
  // });
}

/**
 * Mark task as failed with error.
 */
export async function markFailed(taskId: string, error: string): Promise<void> {
  const ref = adminDb.collection('mirrorQueue').doc(taskId);
  await ref.update({
    status: 'failed',
    error,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export const mirrorQueueRepository = {
  enqueueUpsert,
  enqueueUpdate,
  enqueueRemove,
  pollPendingTasks,
  claimTask,
  markCompleted,
  markFailed,
};
