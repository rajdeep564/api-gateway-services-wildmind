#!/usr/bin/env ts-node
/**
 * scoreMissingAesthetics.ts
 *
 * Purpose: Score only images/videos that are missing `aestheticScore` in
 * `generationHistory` items. Skips items that are already scored (both item-level
 * and per-asset). Shows skipped counts and processed counts. Supports dry-run
 * and batching.
 *
 * Usage examples:
 *   npx ts-node scripts/scoreMissingAesthetics.ts --limitPerUser=200 --concurrency=3 --dry-run
 *   npx ts-node scripts/scoreMissingAesthetics.ts --limitPerUser=200 --concurrency=3
 */
import 'dotenv/config';
import { adminDb } from '../src/config/firebaseAdmin';
import { aestheticScoreService } from '../src/services/aestheticScoreService';
import { generationHistoryRepository } from '../src/repository/generationHistoryRepository';
import { mirrorQueueRepository } from '../src/repository/mirrorQueueRepository';
import { generationsMirrorRepository } from '../src/repository/generationsMirrorRepository';
import { GenerationHistoryItem, ImageMedia, VideoMedia } from '../src/types/generate';
// Use CommonJS-compatible imports to avoid ESM loader cycle issues when run with ts-node/register.
const minimist = require('minimist');
const pLimit = require('p-limit');

interface Args {
  limitPerUser?: number;
  concurrency?: number;
  dryRun?: boolean;
  users?: string; // comma-separated list of specific user IDs
  fast?: boolean; // use collectionGroup traversal
  assetConcurrency?: number;
  maxItems?: number;
}

const args: Args = minimist(process.argv.slice(2));
const limitPerUser = Number(args.limitPerUser || 200);
const concurrency = Number(args.concurrency || 3);
const dryRun = Boolean(args.dryRun || args['dry-run'] || args.dry);
const filterUsers: string[] = typeof args.users === 'string' && args.users.trim().length > 0 ? args.users.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
const fastMode = Boolean(args.fast);
const assetConcurrency = Number(args.assetConcurrency || 4);
const maxItemsGlobal = typeof args.maxItems === 'number' ? args.maxItems : (args.maxItems ? Number(args.maxItems) : undefined);

const limit = pLimit(concurrency);
const assetLimit = pLimit(Math.max(1, assetConcurrency));

interface Stats {
  usersVisited: number;
  itemsVisited: number;
  itemsSkipped: number; // items that already had scores and were skipped
  itemsUpdated: number;
  imagesScored: number;
  videosScored: number;
  errors: number;
}

const stats: Stats = { usersVisited: 0, itemsVisited: 0, itemsSkipped: 0, itemsUpdated: 0, imagesScored: 0, videosScored: 0, errors: 0 };

function log(...parts: any[]) { console.log('[SCORE_MISSING]', ...parts); }
function warn(...parts: any[]) { console.warn('[SCORE_MISSING][WARN]', ...parts); }
function err(...parts: any[]) { console.error('[SCORE_MISSING][ERROR]', ...parts); }

function needsScoring(item: GenerationHistoryItem): boolean {
  if (item.generationType === 'text-to-music') return false; // skip music
  if (item.status !== 'completed') return false;
  const imgs = item.images || [];
  const vids = item.videos || [];
  // If any image or video lacks an aestheticScore, we need scoring
  const missingImg = imgs.some(im => typeof im.aestheticScore !== 'number');
  const missingVid = vids.some(v => typeof v.aestheticScore !== 'number');
  // If the item aggregate is missing but assets have scores, we can still compute later; prefer per-asset scoring only
  return missingImg || missingVid;
}

async function scoreImagesMerge(images: ImageMedia[]): Promise<{ images: ImageMedia[]; newlyScored: number }> {
  if (!images || images.length === 0) return { images: images || [], newlyScored: 0 };
  const toScore = images.filter(im => typeof im.aestheticScore !== 'number');
  if (toScore.length === 0) return { images, newlyScored: 0 };
  const scoredSubset = await Promise.all(toScore.map(im => assetLimit(async () => {
    try {
      const res = await aestheticScoreService.scoreImage(im.url);
      if (res) return { ...im, aestheticScore: typeof res.score === 'number' ? res.score : im.aestheticScore, aesthetic: { score: res.score, raw_output: res.raw_output } } as ImageMedia;
    } catch (e) {
      // don't fail whole run for one asset
      warn('image scoring failed for', im.id, e?.message || e);
    }
    return im;
  })));
  // Map by id
  const map = new Map(scoredSubset.map((im: ImageMedia) => [im.id, im]));
  const merged = images.map(im => map.has(im.id) ? map.get(im.id) as ImageMedia : im);
  const newly = scoredSubset.filter(im => typeof im.aestheticScore === 'number').length;
  return { images: merged, newlyScored: newly };
}

async function scoreVideosMerge(videos: VideoMedia[]): Promise<{ videos: VideoMedia[]; newlyScored: number }> {
  if (!videos || videos.length === 0) return { videos: videos || [], newlyScored: 0 };
  const toScore = videos.filter(v => typeof v.aestheticScore !== 'number');
  if (toScore.length === 0) return { videos, newlyScored: 0 };
  const scoredSubset = await Promise.all(toScore.map(v => assetLimit(async () => {
    try {
      const res = await aestheticScoreService.scoreVideo(v.url);
      if (res) {
        const avg = res.average_score;
        return { ...v, aestheticScore: typeof avg === 'number' ? avg : v.aestheticScore, aesthetic: { average_score: res.average_score, frame_scores: res.frame_scores, raw_outputs: res.raw_outputs, frames_sampled: res.frames_sampled } } as VideoMedia;
      }
    } catch (e) {
      warn('video scoring failed for', v.id, e?.message || e);
    }
    return v;
  })));
  const map = new Map(scoredSubset.map((v: VideoMedia) => [v.id, v]));
  const merged = videos.map(v => map.has(v.id) ? map.get(v.id) as VideoMedia : v);
  const newly = scoredSubset.filter(v => typeof v.aestheticScore === 'number').length;
  return { videos: merged, newlyScored: newly };
}

async function processItem(uid: string, item: GenerationHistoryItem) {
  stats.itemsVisited++;
  if (maxItemsGlobal && stats.itemsVisited > maxItemsGlobal) return;
  if (!needsScoring(item)) {
    stats.itemsSkipped++;
    return;
  }
  try {
    const originalImages = item.images || [];
    const originalVideos = item.videos || [];

    const { images: updatedImages, newlyScored: imgs } = await scoreImagesMerge(originalImages);
    const { videos: updatedVideos, newlyScored: vids } = await scoreVideosMerge(originalVideos);

    stats.imagesScored += imgs;
    stats.videosScored += vids;

    if (dryRun) {
      log('DRY-RUN would update', { uid, id: item.id, newlyScoredImages: imgs, newlyScoredVideos: vids });
      return;
    }

    const highest = aestheticScoreService.getHighestScore([ ...updatedImages, ...updatedVideos ]);
    const updates: Partial<GenerationHistoryItem> = {
      images: updatedImages,
      videos: updatedVideos,
      aestheticScore: typeof highest === 'number' ? highest : undefined,
    } as any;

    // Persist to user's history
    await generationHistoryRepository.update(uid, item.id, updates);

    // Try to fetch fresh snapshot to enqueue accurate mirror update
    let fresh: GenerationHistoryItem | null = null;
    try { fresh = await generationHistoryRepository.get(uid, item.id) as any; } catch {}

    try {
      if (fresh) {
        await mirrorQueueRepository.enqueueUpsert({ uid, historyId: item.id, itemSnapshot: fresh });
      } else {
        await mirrorQueueRepository.enqueueUpdate({ uid, historyId: item.id, updates });
      }
    } catch (mqErr: any) {
      warn('Mirror queue enqueue failed, will attempt direct mirror update', { id: item.id, error: (mqErr && mqErr.message) || String(mqErr) });
      try { await generationsMirrorRepository.updateFromHistory(uid, item.id, updates); } catch (e) { warn('Direct mirror update also failed', e?.message || e); }
    }

    stats.itemsUpdated++;
    log('UPDATED', { uid, id: item.id, imgs, vids, highest });
  } catch (e: any) {
    stats.errors++;
    err('Failed item', { uid, id: item.id, error: e?.message });
  }
}

async function processUser(uid: string) {
  stats.usersVisited++;
  log('Processing user', uid);
  const itemsCol = adminDb.collection('generationHistory').doc(uid).collection('items');
  let lastCreatedAt: number | undefined;
  while (true) {
    let q: FirebaseFirestore.Query = itemsCol.orderBy('createdAt', 'desc');
    if (lastCreatedAt) {
      try {
        const ts = (global as any).admin?.firestore?.Timestamp?.fromMillis ? (global as any).admin.firestore.Timestamp.fromMillis(lastCreatedAt) : undefined;
        if (ts) q = q.startAfter(ts);
      } catch {}
    }
    const snap = await q.limit(limitPerUser).get();
    if (snap.empty) break;
    const items: GenerationHistoryItem[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    for (const item of items) {
      await processItem(uid, item);
    }
    const last = items[items.length - 1];
    const createdAtStr = (last as any)?.createdAt;
    if (createdAtStr) {
      const ms = new Date(createdAtStr).getTime();
      if (!Number.isNaN(ms)) lastCreatedAt = ms;
    }
    if (items.length < limitPerUser) break;
    if (maxItemsGlobal && stats.itemsVisited >= maxItemsGlobal) break;
  }
  log('User done', uid);
}

async function fastTraverseAllUsers() {
  log('Fast mode collectionGroup traversal start');
  const cg = adminDb.collectionGroup('items');
  let processed = 0;
  const batchSize = limitPerUser;
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
      if (data.generationType === 'text-to-music') continue;
      const pathParts = d.ref.path.split('/');
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
  log('Fast mode traversal done');
}

async function main() {
  log('START', { limitPerUser, concurrency, assetConcurrency, dryRun, fastMode, maxItemsGlobal, filterUsersCount: filterUsers.length });
  const root = adminDb.collection('generationHistory');
  const userDocs = await root.listDocuments();
  const allUids = userDocs.map(d => d.id);
  const targetUids = filterUsers.length ? allUids.filter(u => filterUsers.includes(u)) : allUids;
  log('Discovered users', { total: allUids.length, target: targetUids.length });

  if (fastMode && !filterUsers.length) {
    await fastTraverseAllUsers();
  } else {
    await Promise.all(targetUids.map(uid => limit(() => processUser(uid))));
  }

  log('COMPLETE', stats);
  if (dryRun) log('Dry-run complete. Re-run without --dry-run to persist updates.');
}

main().catch(e => {
  err('Fatal', e?.message || e);
  console.error(e);
  process.exit(1);
});
