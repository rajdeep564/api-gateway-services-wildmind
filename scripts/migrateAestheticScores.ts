#!/usr/bin/env node
/**
 * Migration: Backfill aesthetic scores for all images and videos in generationHistory + public mirror.
 * Skips generationType 'text-to-music'. Supports dry-run and batching.
 *
 * Usage:
 *   ts-node scripts/migrateAestheticScores.ts --limitPerUser=200 --concurrency=3 --dry-run
 *   npm run migrate:aesthetic-scores -- --rescore --continueOnError
 */
import 'dotenv/config';
import { adminDb } from '../src/config/firebaseAdmin';
import { aestheticScoreService } from '../src/services/aestheticScoreService';
import { generationHistoryRepository } from '../src/repository/generationHistoryRepository';
import { generationsMirrorRepository } from '../src/repository/generationsMirrorRepository';
import { mirrorQueueRepository } from '../src/repository/mirrorQueueRepository';
import { GenerationHistoryItem, ImageMedia, VideoMedia } from '../src/types/generate';
// Use CommonJS-compatible imports to avoid ESM loader cycle issues when run with ts-node/register.
const minimist = require('minimist');
const pLimit = require('p-limit');

interface Args {
  limitPerUser?: number;
  concurrency?: number;
  dryRun?: boolean;
  rescore?: boolean; // if true re-score even existing assets
  continueOnError?: boolean;
  users?: string; // comma-separated list of specific user IDs
  fast?: boolean; // fast mode uses collectionGroup traversal
  assetConcurrency?: number; // concurrency for scoring individual assets
  maxItems?: number; // cap total processed items (for partial runs)
}

const args: Args = minimist(process.argv.slice(2));
const limitPerUser = Number(args.limitPerUser || 500);
const concurrency = Number(args.concurrency || 3);
const dryRun = Boolean(args.dryRun);
const rescore = Boolean(args.rescore);
const continueOnError = Boolean(args.continueOnError);
const filterUsers: string[] = typeof args.users === 'string' && args.users.trim().length > 0 ? args.users.split(',').map(s => s.trim()).filter(Boolean) : [];
const fastMode = Boolean(args.fast);
const assetConcurrency = Number(args.assetConcurrency || 4);
const maxItemsGlobal = typeof args.maxItems === 'number' ? args.maxItems : (args.maxItems ? Number(args.maxItems) : undefined);

const limit = pLimit(concurrency);

interface MigrationStats {
  usersVisited: number;
  itemsVisited: number;
  itemsUpdated: number;
  imagesScored: number;
  videosScored: number;
  errors: number;
}
const stats: MigrationStats = { usersVisited: 0, itemsVisited: 0, itemsUpdated: 0, imagesScored: 0, videosScored: 0, errors: 0 };

function log(...parts: any[]) { console.log('[MIGRATE_AESTHETIC]', ...parts); }
function warn(...parts: any[]) { console.warn('[MIGRATE_AESTHETIC][WARN]', ...parts); }
function err(...parts: any[]) { console.error('[MIGRATE_AESTHETIC][ERROR]', ...parts); }

function needsScoring(item: GenerationHistoryItem): boolean {
  if (item.generationType === 'text-to-music') return false; // skip music
  if (item.status !== 'completed') return false;
  const imgs = item.images || [];
  const vids = item.videos || [];
  if (rescore) return (imgs.length + vids.length) > 0; // force scoring
  const missingImg = imgs.some(im => typeof im.aestheticScore !== 'number');
  const missingVid = vids.some(v => typeof v.aestheticScore !== 'number');
  const missingAggregate = typeof item.aestheticScore !== 'number';
  return missingImg || missingVid || missingAggregate;
}

const assetLimit = pLimit(assetConcurrency);

async function scoreImagesMerge(images: ImageMedia[]): Promise<ImageMedia[]> {
  if (!images || images.length === 0) return images || [];
  if (rescore) {
    // Parallel limit scoring to avoid flooding external API
    const scored = await Promise.all(images.map(img => assetLimit(async () => {
      const res = await aestheticScoreService.scoreImage(img.url);
      if (res) return { ...img, aestheticScore: typeof res.score === 'number' ? res.score : img.aestheticScore, aesthetic: { score: res.score, raw_output: res.raw_output } };
      return img;
    })));
    return scored;
  }
  // Only score those missing to reduce calls
  const need = images.filter(im => typeof im.aestheticScore !== 'number');
  if (need.length === 0) return images;
  const scoredSubset = await Promise.all(need.map(img => assetLimit(async () => {
    const res = await aestheticScoreService.scoreImage(img.url);
    if (res) return { ...img, aestheticScore: typeof res.score === 'number' ? res.score : img.aestheticScore, aesthetic: { score: res.score, raw_output: res.raw_output } };
    return img;
  })));
  const map = new Map(scoredSubset.map(im => [im.id, im.aestheticScore]));
  return images.map(im => map.has(im.id) ? { ...im, aestheticScore: map.get(im.id) } : im);
}

async function scoreVideosMerge(videos: VideoMedia[]): Promise<VideoMedia[]> {
  if (!videos || videos.length === 0) return videos || [];
  if (rescore) {
    const scored = await Promise.all(videos.map(v => assetLimit(async () => {
      const res = await aestheticScoreService.scoreVideo(v.url);
      if (res) return { ...v, aestheticScore: typeof res.average_score === 'number' ? res.average_score : v.aestheticScore, aesthetic: { average_score: res.average_score, frame_scores: res.frame_scores, raw_outputs: res.raw_outputs, frames_sampled: res.frames_sampled } };
      return v;
    })));
    return scored;
  }
  const need = videos.filter(v => typeof v.aestheticScore !== 'number');
  if (need.length === 0) return videos;
  const scoredSubset = await Promise.all(need.map(v => assetLimit(async () => {
    const res = await aestheticScoreService.scoreVideo(v.url);
    if (res) return { ...v, aestheticScore: typeof res.average_score === 'number' ? res.average_score : v.aestheticScore, aesthetic: { average_score: res.average_score, frame_scores: res.frame_scores, raw_outputs: res.raw_outputs, frames_sampled: res.frames_sampled } };
    return v;
  })));
  const map = new Map(scoredSubset.map(v => [v.id, v.aestheticScore]));
  return videos.map(v => map.has(v.id) ? { ...v, aestheticScore: map.get(v.id) } : v);
}

async function processItem(uid: string, item: GenerationHistoryItem) {
  stats.itemsVisited++;
  if (maxItemsGlobal && stats.itemsVisited > maxItemsGlobal) return;
  if (!needsScoring(item)) return; // skip
  try {
    const originalImages = item.images || [];
    const originalVideos = item.videos || [];
    const updatedImages = await scoreImagesMerge(originalImages);
    const updatedVideos = await scoreVideosMerge(originalVideos);
    const highest = aestheticScoreService.getHighestScore([
      ...updatedImages,
      ...updatedVideos,
    ]);

    const imagesScoredCount = updatedImages.filter(im => typeof im.aestheticScore === 'number').length - originalImages.filter(im => typeof im.aestheticScore === 'number').length;
    const videosScoredCount = updatedVideos.filter(v => typeof v.aestheticScore === 'number').length - originalVideos.filter(v => typeof v.aestheticScore === 'number').length;
    stats.imagesScored += Math.max(0, imagesScoredCount);
    stats.videosScored += Math.max(0, videosScoredCount);

    if (dryRun) {
      log('DRY-RUN item would update', { uid, id: item.id, newlyScoredImages: imagesScoredCount, newlyScoredVideos: videosScoredCount, highest });
      return;
    }

    const updates: Partial<GenerationHistoryItem> = {
      images: updatedImages,
      videos: updatedVideos,
      aestheticScore: highest,
    } as any;
    // Persist to history first
    await generationHistoryRepository.update(uid, item.id, updates);
    // Fetch fresh snapshot so mirror queue upsert matches real generation behavior
    let fresh: GenerationHistoryItem | null = null;
    try {
      const ref = await generationHistoryRepository.get(uid, item.id);
      fresh = ref as any;
    } catch {}
    // Enqueue mirror queue task (preferred) falling back to direct update if queue fails
    try {
      if (fresh) {
        await mirrorQueueRepository.enqueueUpsert({ uid, historyId: item.id, itemSnapshot: fresh });
      } else {
        await mirrorQueueRepository.enqueueUpdate({ uid, historyId: item.id, updates });
      }
    } catch (mqErr: any) {
      const mqMsg = (mqErr && typeof mqErr === 'object' && 'message' in mqErr) ? (mqErr as any).message : String(mqErr);
      warn('Mirror queue enqueue failed, falling back to direct mirror update', { id: item.id, error: mqMsg });
      try { await generationsMirrorRepository.updateFromHistory(uid, item.id, updates); } catch {}
    }
    stats.itemsUpdated++;
    log('UPDATED item', { uid, id: item.id, highest, imagesScoredCount, videosScoredCount });
  } catch (e: any) {
    stats.errors++;
    if (!continueOnError) throw e;
    err('Failed item', { uid, id: item.id, error: e?.message });
  }
}

async function processUser(uid: string) {
  stats.usersVisited++;
  log('User start', { uid });
  const itemsCol = adminDb.collection('generationHistory').doc(uid).collection('items');
  // We fetch more than limitPerUser to account for filtering; rely on iteration until exhaustion.
  let lastCreatedAt: number | undefined;
  let page = 0;
  while (true) {
    let q: FirebaseFirestore.Query = itemsCol.orderBy('createdAt', 'desc');
    if (lastCreatedAt) {
      try {
        const ts = (global as any).admin?.firestore?.Timestamp?.fromMillis
          ? (global as any).admin.firestore.Timestamp.fromMillis(lastCreatedAt)
          : undefined;
        if (ts) q = q.startAfter(ts);
      } catch {}
    }
  const snap = await q.limit(limitPerUser).get();
    if (snap.empty) break;
    const items: GenerationHistoryItem[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    for (const item of items) {
      await processItem(uid, item);
    }
    page++;
    const last = items[items.length - 1];
    const createdAtStr = (last as any)?.createdAt;
    if (createdAtStr) {
      const ms = new Date(createdAtStr).getTime();
      if (!Number.isNaN(ms)) lastCreatedAt = ms;
    }
    if (items.length < limitPerUser) break; // final page
  }
  log('User done', { uid });
}

async function fastTraverseAllUsers() {
  log('Fast mode collectionGroup traversal start');
  const cg = adminDb.collectionGroup('items');
  // We cannot query missing fields, so fetch completed items and filter generationType
  let processed = 0;
  const batchSize = limitPerUser; // reuse limitPerUser as chunk size
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    let q: FirebaseFirestore.Query = cg.where('status', '==', 'completed').orderBy('createdAt', 'desc');
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.limit(batchSize).get();
    if (snap.empty) break;
    const docs = snap.docs;
    for (const d of docs) {
      if (maxItemsGlobal && stats.itemsVisited >= maxItemsGlobal) break;
      const data = d.data() as any;
      const generationType = data.generationType;
      if (generationType === 'text-to-music') continue;
      const pathParts = d.ref.path.split('/');
      // path: generationHistory/{uid}/items/{historyId}
      const uidIndex = pathParts.indexOf('generationHistory') + 1;
      const uid = pathParts[uidIndex];
      const historyId = d.id;
      await processItem(uid, { id: historyId, ...data } as GenerationHistoryItem);
      processed++;
    }
    lastDoc = docs[docs.length - 1];
    if (maxItemsGlobal && stats.itemsVisited >= maxItemsGlobal) break;
    if (docs.length < batchSize) break;
  }
  log('Fast mode traversal done', { processed });
}

async function main() {
  log('START', { limitPerUser, concurrency, assetConcurrency, dryRun, rescore, fastMode, maxItemsGlobal, continueOnError, filterUsersCount: filterUsers.length });
  const root = adminDb.collection('generationHistory');
  const userDocs = await root.listDocuments();
  const allUids = userDocs.map(d => d.id);
  const targetUids = filterUsers.length ? allUids.filter(u => filterUsers.includes(u)) : allUids;
  log('Users discovered', { total: allUids.length, target: targetUids.length });

  if (fastMode && !filterUsers.length) {
    await fastTraverseAllUsers();
  } else {
    await Promise.all(targetUids.map(uid => limit(() => processUser(uid))));
  }

  log('COMPLETE', stats);
  if (dryRun) {
    log('Dry-run complete. Re-run without --dry-run to persist updates.');
  }
}

main().catch(e => {
  err('Migration failed', e?.message || e);
  console.error(e);
  process.exit(1);
});
