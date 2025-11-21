#!/usr/bin/env ts-node
/**
 * backfillAestheticScores.ts
 *
 * Scores images/videos for public, non-deleted generations that are missing aesthetic data.
 * Reuses aestheticScoreService to compute scores and persists them back onto the document.
 *
 * Usage:
 *   ts-node scripts/backfillAestheticScores.ts --batch 200 --assetConcurrency 4 --dry
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { adminDb } from '../src/config/firebaseAdmin';
import { GenerationHistoryItem, ImageMedia, VideoMedia } from '../src/types/generate';
import { aestheticScoreService } from '../src/services/aestheticScoreService';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pLimit = require('p-limit');

interface Args {
  limit: number;
  resumeAfter?: string;
  dry: boolean;
  assetConcurrency: number;
  force: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, def?: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : def;
  };
  return {
    limit: Number(get('--batch', '200')),
    resumeAfter: get('--resume-after'),
    dry: argv.includes('--dry'),
    assetConcurrency: Number(get('--assetConcurrency', '4')),
    force: argv.includes('--force'),
  };
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

type ScoreResult = {
  hasUpdates: boolean;
  updates?: Partial<GenerationHistoryItem>;
};

async function scoreDocument(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  assetConcurrency: number,
  force: boolean
): Promise<ScoreResult> {
  const data = doc.data() as GenerationHistoryItem & { isDeleted?: boolean };

  // Skip if deleted
  if (data.isDeleted) {
    return { hasUpdates: false };
  }

  let images = Array.isArray(data.images) ? data.images : [];
  let videos = Array.isArray(data.videos) ? data.videos : [];

  const hasDocScore = typeof data.aestheticScore === 'number';
  const assetsNeedScore =
    images.some((img: any) => typeof img?.aestheticScore !== 'number') ||
    videos.some((vid: any) => typeof vid?.aestheticScore !== 'number');

  if (!force && hasDocScore && !assetsNeedScore) {
    return { hasUpdates: false };
  }

  const limiter = pLimit(Math.max(1, assetConcurrency));

  const imagesToScore = images.filter((img: any) => force || typeof img?.aestheticScore !== 'number');
  if (imagesToScore.length > 0) {
    const scoredImages = await Promise.all(
      imagesToScore.map((img: ImageMedia) =>
        limiter(async () => {
          try {
            const res = await aestheticScoreService.scoreImage(img.url);
            if (res) {
              return {
                ...img,
                aestheticScore: typeof res.score === 'number' ? res.score : img.aestheticScore,
                aesthetic: { score: res.score, raw_output: res.raw_output },
              } as ImageMedia;
            }
          } catch (e) {
            console.warn('[backfillAestheticScores] Image scoring failed', doc.id, img.id, e);
          }
          return img;
        })
      )
    );
    const map = new Map(scoredImages.map((im) => [im.id, im]));
    images = images.map((img: ImageMedia) => map.get(img.id) || img);
  }

  const videosToScore = videos.filter((vid: any) => force || typeof vid?.aestheticScore !== 'number');
  if (videosToScore.length > 0) {
    const scoredVideos = await Promise.all(
      videosToScore.map((vid: VideoMedia) =>
        limiter(async () => {
          try {
            const res = await aestheticScoreService.scoreVideo(vid.url);
            if (res) {
              const avg = typeof res.average_score === 'number' ? res.average_score : undefined;
              return {
                ...vid,
                aestheticScore: avg ?? vid.aestheticScore,
                aesthetic: {
                  average_score: res.average_score,
                  frame_scores: res.frame_scores,
                  raw_outputs: res.raw_outputs,
                  frames_sampled: res.frames_sampled,
                },
              } as VideoMedia;
            }
          } catch (e) {
            console.warn('[backfillAestheticScores] Video scoring failed', doc.id, vid.id, e);
          }
          return vid;
        })
      )
    );
    const map = new Map(scoredVideos.map((vid) => [vid.id, vid]));
    videos = videos.map((vid: VideoMedia) => map.get(vid.id) || vid);
  }

  const allScores = [
    ...images.map((img: any) => img?.aestheticScore).filter((score: any): score is number => typeof score === 'number'),
    ...videos.map((vid: any) => vid?.aestheticScore).filter((score: any): score is number => typeof score === 'number'),
  ];

  const docScore =
    allScores.length > 0
      ? clamp(Math.max(...allScores), 0, 10)
      : hasDocScore
      ? clamp(Number(data.aestheticScore), 0, 10)
      : undefined;

  if (!docScore && allScores.length === 0) {
    return { hasUpdates: false };
  }

  const updates: Partial<GenerationHistoryItem> = {
    images,
    videos,
  };
  if (typeof docScore === 'number') {
    updates.aestheticScore = docScore;
  }

  return { hasUpdates: true, updates };
}

async function run() {
  const args = parseArgs();
  console.log('[backfillAestheticScores] Starting', args);

  const col = adminDb.collection('generations');
  let query: FirebaseFirestore.Query = col.where('isPublic', '==', true).orderBy('createdAt', 'desc');

  if (args.resumeAfter) {
    try {
      const snapshot = await col.doc(args.resumeAfter).get();
      if (snapshot.exists) {
        query = query.startAfter(snapshot);
        console.log('[backfillAestheticScores] Resuming after', args.resumeAfter);
      }
    } catch (e) {
      console.warn('[backfillAestheticScores] Failed to apply resume cursor', e);
    }
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let lastDocId: string | undefined;
  const batchLimit = args.limit;
  let done = false;

  while (!done) {
    const snap = await query.limit(batchLimit).get();
    if (snap.empty) {
      console.log('[backfillAestheticScores] No more documents');
      break;
    }

    const batch = adminDb.batch();
    for (const doc of snap.docs) {
      lastDocId = doc.id;
      processed++;

      const data = doc.data();
      if (data?.isDeleted === true) {
        skipped++;
        continue;
      }

      const { hasUpdates, updates } = await scoreDocument(doc, args.assetConcurrency, args.force);
      if (!hasUpdates || !updates) {
        skipped++;
        continue;
      }

      console.log('[backfillAestheticScores] Updating', doc.id, {
        images: Array.isArray(updates.images) ? updates.images.length : 0,
        videos: Array.isArray(updates.videos) ? updates.videos.length : 0,
        aestheticScore: updates.aestheticScore,
      });

      if (!args.dry) {
        batch.set(doc.ref, updates, { merge: true });
        updated++;
      }
    }

    if (!args.dry && updated > 0) {
      await batch.commit();
    }

    const last = snap.docs[snap.docs.length - 1];
    query = col.where('isPublic', '==', true).orderBy('createdAt', 'desc').startAfter(last);
    if (snap.size < batchLimit) {
      done = true;
    }
  }

  console.log('[backfillAestheticScores] Complete', { processed, updated, skipped, lastDocId });
}

run().catch((err) => {
  console.error('[backfillAestheticScores] Fatal error', err);
  process.exit(1);
});

