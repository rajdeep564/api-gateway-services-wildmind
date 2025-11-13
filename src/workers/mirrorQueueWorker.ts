/**
 * Mirror Queue Worker
 * Continuously polls Firestore mirrorQueue collection for pending tasks
 * and applies them to the public generations mirror.
 *
 * Ops:
 *  - upsert: full history snapshot -> generations doc (merge)
 *  - update: partial updates -> generations doc (merge)
 *  - remove: delete generations doc
 *
 * Features:
 *  - Concurrency control via PROMISE_POOL_SIZE
 *  - Exponential backoff on empty queue
 *  - Graceful shutdown (SIGINT/SIGTERM)
 *  - Visibility logging and optimized counts
 *  - Safety: attempts < 5 enforced by poll query
 */
import 'dotenv/config';
import { generationsMirrorRepository } from '../repository/generationsMirrorRepository';
import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { pollPendingTasks, claimTask, markCompleted, markFailed } from '../repository/mirrorQueueRepository';
import { GenerationHistoryItem } from '../types/generate';

const POLL_INTERVAL_MS = Number(process.env.MIRROR_QUEUE_POLL_INTERVAL_MS || 2500);
const EMPTY_BACKOFF_MULTIPLIER = 1.4; // multiply delay when queue empty
const MAX_BACKOFF_MS = 15000;
const PROMISE_POOL_SIZE = Number(process.env.MIRROR_QUEUE_CONCURRENCY || 4);
const BATCH_LIMIT = Number(process.env.MIRROR_QUEUE_BATCH_LIMIT || 12);
let running = true;
let emptyCycles = 0;

process.on('SIGINT', () => { console.log('[MirrorWorker] SIGINT received, shutting down...'); running = false; });
process.on('SIGTERM', () => { console.log('[MirrorWorker] SIGTERM received, shutting down...'); running = false; });

async function processTask(id: string, task: any) {
  try {
    const claimed = await claimTask(id);
    if (!claimed) {
      // another worker picked it
      return;
    }
    if (task.op === 'upsert') {
      const snapshot: GenerationHistoryItem | undefined = task.itemSnapshot;
      let item: GenerationHistoryItem | null = snapshot || null;
      if (!item) {
        // fetch fresh
        item = await generationHistoryRepository.get(task.uid, task.historyId);
        if (!item) throw new Error('History item missing for upsert');
      }
      // Derive createdBy fallback (history may already include it) - keep stable shape
      const createdBy = (item as any).createdBy || { uid: task.uid, username: null, displayName: null, photoURL: null };
      await generationsMirrorRepository.upsertFromHistory(task.uid, task.historyId, item, createdBy);
      console.log('[MirrorWorker][Upsert] OK', { historyId: task.historyId, uid: task.uid });
    } else if (task.op === 'update') {
      const updates = task.updates || {};
      // DO NOT allow destructive overwrites of images/videos arrays without merging optimization fields.
      // If updates contain images/videos we merge with existing to preserve thumbnailUrl/avifUrl.
      if (updates.images || updates.videos) {
        const existing = await generationHistoryRepository.get(task.uid, task.historyId);
        if (existing) {
          if (updates.images && existing.images) {
            const byId = new Map(existing.images.map((im: any) => [im.id, im]));
            const merged = (updates.images as any[]).map(im => ({ ...byId.get(im.id), ...im }));
            updates.images = merged as any;
          }
          if (updates.videos && existing.videos) {
            const byIdV = new Map(existing.videos.map((vd: any) => [vd.id, vd]));
            const mergedV = (updates.videos as any[]).map(vd => ({ ...byIdV.get(vd.id), ...vd }));
            updates.videos = mergedV as any;
          }
        }
      }
      await generationsMirrorRepository.updateFromHistory(task.uid, task.historyId, updates);
      console.log('[MirrorWorker][Update] OK', { historyId: task.historyId, uid: task.uid });
    } else if (task.op === 'remove') {
      await generationsMirrorRepository.remove(task.historyId);
      console.log('[MirrorWorker][Remove] OK', { historyId: task.historyId });
    } else {
      throw new Error(`Unknown op: ${task.op}`);
    }
    await markCompleted(id);
  } catch (e: any) {
    console.error('[MirrorWorker] Task failed', { id, historyId: task.historyId, err: e?.message });
    try { await markFailed(id, e?.message || 'failed'); } catch {}
  }
}

async function loop() {
  console.log('[MirrorWorker] Starting loop', { POLL_INTERVAL_MS, PROMISE_POOL_SIZE, BATCH_LIMIT });
  while (running) {
    try {
      const tasks = await pollPendingTasks(BATCH_LIMIT);
      if (!tasks.length) {
        emptyCycles++;
        const backoff = Math.min(POLL_INTERVAL_MS * Math.pow(EMPTY_BACKOFF_MULTIPLIER, emptyCycles), MAX_BACKOFF_MS);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      emptyCycles = 0;
      // process in pools
      for (let i = 0; i < tasks.length; i += PROMISE_POOL_SIZE) {
        const slice = tasks.slice(i, i + PROMISE_POOL_SIZE);
        await Promise.all(slice.map(t => processTask(t.id, t.task)));
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    } catch (e: any) {
      console.error('[MirrorWorker] Loop error', e?.message || e);
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  console.log('[MirrorWorker] Exiting loop');
}

loop().catch(e => {
  console.error('[MirrorWorker] Fatal start error', e);
  process.exit(1);
});
