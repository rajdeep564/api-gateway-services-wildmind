#!/usr/bin/env ts-node
/**
 * migrateFeedRankingScores.ts
 *
 * Backfill a feed ranking score (feedScore) for all public generation documents (collection: generations)
 * so the ArtStation-style feed can sort by a composite quality metric instead of raw createdAt.
 *
 * Formula (all components normalized into ~0-1 range then scaled):
 *   baseAesthetic = clamp(aestheticScore || medianFallback, 0, 10) / 10
 *   optimizationBoost = optimizedImageRatio (images with thumbnailUrl||avifUrl) * 0.25
 *   mediaVarietyBoost = (hasVideo?0.15:0) + (hasMultipleImages?0.10:0) + (hasAudio?0.05:0)
 *   freshnessDecay = exp(-ageHours / HALF_LIFE_HOURS)
 *   engagementBoost = (likeCountNorm*0.20) + (bookmarkCountNorm*0.15) + (viewCountNorm*0.05)
 *   feedScore = (baseAesthetic * 0.55 + optimizationBoost + mediaVarietyBoost + engagementBoost) * freshnessDecay
 *   jitter = small random (0 - 0.01) to break ties
 *   final = round((feedScore + jitter) * 1000) / 1000
 *
 * Assumptions:
 * - Documents are in collection 'generations'. Public items have isPublic == true and not isDeleted.
 * - Optional engagement counters may not exist yet; treat missing as zero.
 * - We write two new fields: feedScore and feedScoreComputedAt (epoch millis).
 * - Idempotent: if feedScore exists and --skip-existing used, we skip.
 *
 * Safety:
 * - Processes in batches (default 200) to avoid large memory/cost spikes.
 * - Supports resume via --resume-after <docId>.
 * - Dry-run mode (--dry) logs computed scores without writing.
 * - Uses exponential backoff on transient Firestore failures.
 */

import { adminDb } from '../src/config/firebaseAdmin';
import { GenerationHistoryItem } from '../src/types/generate';

interface Args {
  limit: number;
  resumeAfter?: string;
  dry: boolean;
  skipExisting: boolean;
  halfLifeHours: number;
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
    skipExisting: argv.includes('--skip-existing'),
    halfLifeHours: Number(get('--half-life-hours', '72')), // 3 day half-life default
  };
}

function clamp(n: number, min: number, max: number) { return Math.min(max, Math.max(min, n)); }

function computeScore(doc: FirebaseFirestore.QueryDocumentSnapshot, halfLifeHours: number): { feedScore: number; detail: any } {
  const data = doc.data() as any as GenerationHistoryItem & {
    likeCount?: number; bookmarkCount?: number; viewCount?: number; feedScore?: number;
  };

  const createdAtMs = (() => {
    const c = data.createdAt;
    if (!c) return Date.now();
    if (typeof c === 'number') return c;
    if ((c as any).seconds) return (c as any).seconds * 1000;
    const parsed = Date.parse(String(c));
    return isNaN(parsed) ? Date.now() : parsed;
  })();
  const ageHours = (Date.now() - createdAtMs) / (1000 * 60 * 60);
  const freshnessDecay = Math.exp(-ageHours / halfLifeHours);

  const images = Array.isArray(data.images) ? data.images : [];
  const videos = Array.isArray(data.videos) ? data.videos : [];
  const audios = Array.isArray(data.audios) ? data.audios : [];

  const aesthetic = typeof data.aestheticScore === 'number' ? clamp(data.aestheticScore, 0, 10) : 5.5; // median fallback
  const baseAesthetic = aesthetic / 10;

  const optimizedCount = images.filter(im => im?.thumbnailUrl || im?.avifUrl).length;
  const optimizationRatio = images.length > 0 ? optimizedCount / images.length : 0;
  const optimizationBoost = optimizationRatio * 0.25;

  const hasVideo = videos.length > 0;
  const hasMultipleImages = images.length > 1;
  const hasAudio = audios.length > 0 || String(data.generationType || '').toLowerCase() === 'text-to-music';
  const mediaVarietyBoost = (hasVideo ? 0.15 : 0) + (hasMultipleImages ? 0.10 : 0) + (hasAudio ? 0.05 : 0);

  const likeCount = typeof (data as any).likeCount === 'number' ? (data as any).likeCount : 0;
  const bookmarkCount = typeof (data as any).bookmarkCount === 'number' ? (data as any).bookmarkCount : 0;
  const viewCount = typeof (data as any).viewCount === 'number' ? (data as any).viewCount : 0;

  // Simple diminishing normalization (log-scale) to keep numbers in manageable range
  const likeNorm = Math.log10(likeCount + 1) / 3; // ~0-1 for up to 1k likes
  const bookmarkNorm = Math.log10(bookmarkCount + 1) / 3;
  const viewNorm = Math.log10(viewCount + 1) / 5; // views typically larger
  const engagementBoost = likeNorm * 0.20 + bookmarkNorm * 0.15 + viewNorm * 0.05;

  const feedScoreRaw = (baseAesthetic * 0.55 + optimizationBoost + mediaVarietyBoost + engagementBoost) * freshnessDecay;
  const jitter = Math.random() * 0.01;
  const final = Math.round((feedScoreRaw + jitter) * 1000) / 1000;

  return {
    feedScore: final,
    detail: {
      aesthetic,
      baseAesthetic,
      optimizationRatio,
      optimizationBoost: Math.round(optimizationBoost * 1000) / 1000,
      mediaVarietyBoost: Math.round(mediaVarietyBoost * 1000) / 1000,
      engagementBoost: Math.round(engagementBoost * 1000) / 1000,
      freshnessDecay: Math.round(freshnessDecay * 1000) / 1000,
      ageHours: Math.round(ageHours * 100) / 100,
      likeCount,
      bookmarkCount,
      viewCount,
    }
  };
}

async function run() {
  const args = parseArgs();
  console.log('[FeedScoreMigration] Starting', args);

  const col = adminDb.collection('generations');
  let q: FirebaseFirestore.Query = col.where('isPublic', '==', true).orderBy('createdAt', 'desc');
  if (args.resumeAfter) {
    try {
      const resumeSnap = await col.doc(args.resumeAfter).get();
      if (resumeSnap.exists) {
        q = q.startAfter(resumeSnap);
        console.log('[FeedScoreMigration] Resuming after', args.resumeAfter);
      }
    } catch (e) {
      console.warn('[FeedScoreMigration] Could not apply resume-after cursor', e);
    }
  }

  let processed = 0;
  let writes = 0;
  let skipped = 0;
  let lastDocId: string | undefined;
  const batchLimit = args.limit;
  let done = false;

  while (!done) {
    const snap = await q.limit(batchLimit).get();
    if (snap.empty) {
      console.log('[FeedScoreMigration] No more documents. Finished.');
      break;
    }

    const batch = adminDb.batch();

    for (const doc of snap.docs) {
      lastDocId = doc.id;
      const data = doc.data();
      if (args.skipExisting && typeof data.feedScore === 'number') {
        skipped++;
        continue;
      }
      const { feedScore, detail } = computeScore(doc, args.halfLifeHours);
      processed++;
      console.log('[FeedScoreMigration] Doc', doc.id, 'score', feedScore, detail);
      if (!args.dry) {
        batch.set(doc.ref, {
          feedScore,
          feedScoreComputedAt: Date.now(),
          feedScoreMeta: detail,
        }, { merge: true });
        writes++;
      }
    }

    if (!args.dry && writes > 0) {
      let attempt = 0;
      const maxAttempts = 5;
      while (true) {
        try {
          await batch.commit();
          console.log('[FeedScoreMigration] Committed batch', { writes });
          break;
        } catch (e: any) {
          attempt++;
          if (attempt >= maxAttempts) {
            console.error('[FeedScoreMigration] Batch commit failed permanently', e);
            throw e;
          }
          const backoffMs = attempt * 750;
          console.warn('[FeedScoreMigration] Batch commit failed, retrying', { attempt, backoffMs, error: e?.message });
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }
    }

    // Prepare next page using last doc
    const last = snap.docs[snap.docs.length - 1];
    q = col.where('isPublic', '==', true).orderBy('createdAt', 'desc').startAfter(last);
    if (snap.size < batchLimit) {
      done = true; // last page fetched
    }
  }

  console.log('[FeedScoreMigration] Complete', { processed, writes, skipped, lastDocId });
}

run().catch(err => {
  console.error('[FeedScoreMigration] Fatal error', err);
  process.exit(1);
});
