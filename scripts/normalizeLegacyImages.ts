#!/usr/bin/env ts-node
/**
 * normalizeLegacyImages: Backfill generationHistory documents converting legacy string image arrays
 * into structured ImageMedia objects with ids. Preserves existing optimization fields.
 *
 * Usage:
 *   ts-node scripts/normalizeLegacyImages.ts --limitPerUser=300
 *   npm run migrate:normalize-images -- --dry-run
 */
import 'dotenv/config';
import { adminDb } from '../src/config/firebaseAdmin';
import minimist from 'minimist';

interface Args { limitPerUser?: number; dryRun?: boolean; users?: string; }
const raw: any = minimist(process.argv.slice(2));
const args: Args = {
  limitPerUser: raw.limitPerUser ? Number(raw.limitPerUser) : 500,
  dryRun: Boolean(raw.dryRun),
  users: typeof raw.users === 'string' ? raw.users : undefined,
};
const limitPerUser = args.limitPerUser || 500;
const dryRun = args.dryRun || false;
const filterUsers = args.users ? args.users.split(',').map((s) => s.trim()).filter(Boolean) : [];

function log(...parts: any[]) { console.log('[NORMALIZE_LEGACY_IMAGES]', ...parts); }
function warn(...parts: any[]) { console.warn('[NORMALIZE_LEGACY_IMAGES][WARN]', ...parts); }
function err(...parts: any[]) { console.error('[NORMALIZE_LEGACY_IMAGES][ERROR]', ...parts); }

interface Stats { usersVisited: number; itemsVisited: number; itemsUpdated: number; skipped: number; errors: number; };
const stats: Stats = { usersVisited: 0, itemsVisited: 0, itemsUpdated: 0, skipped: 0, errors: 0 };

function normalizeImages(images: any[], historyId: string): any[] {
  if (!Array.isArray(images)) return [];
  let changed = false;
  const out = images.map((im: any, index: number) => {
    if (typeof im === 'string') {
      changed = true;
      return {
        id: `${historyId}-img-${index}`,
        url: im,
        originalUrl: im,
        optimized: false,
      };
    }
    if (im && typeof im === 'object') {
      const needsId = !im.id;
      const needsUrlWrap = !im.url && im.originalUrl;
      if (needsId || needsUrlWrap) changed = true;
      return {
        id: im.id || `${historyId}-img-${index}`,
        url: im.url || im.originalUrl,
        originalUrl: im.originalUrl || im.url,
        storagePath: im.storagePath,
        avifUrl: im.avifUrl,
        thumbnailUrl: im.thumbnailUrl,
        blurDataUrl: im.blurDataUrl,
        optimized: im.optimized || false,
        optimizedAt: im.optimizedAt,
        aestheticScore: im.aestheticScore,
        width: im.width,
        height: im.height,
        size: im.size,
      };
    }
    return im;
  });
  return { out, changed } as any;
}

async function processUser(uid: string) {
  stats.usersVisited++;
  log('User start', { uid });
  const col = adminDb.collection('generationHistory').doc(uid).collection('items');
  let lastCreatedAt: number | undefined;
  while (true) {
    let q: FirebaseFirestore.Query = col.orderBy('createdAt', 'desc');
    if (lastCreatedAt) {
      try {
        // convert millis to Timestamp for cursor
        const ts = (adminDb as any).firestore?.Timestamp?.fromMillis
          ? (adminDb as any).firestore.Timestamp.fromMillis(lastCreatedAt)
          : undefined;
        if (ts) q = q.startAfter(ts);
      } catch {}
    }
    const snap = await q.limit(limitPerUser).get();
    if (snap.empty) break;
    const docs = snap.docs;
    for (const d of docs) {
      stats.itemsVisited++;
      const data = d.data();
      const historyId = d.id;
      const images = (data as any).images || [];
      const hasLegacy = images.some((im: any) => typeof im === 'string' || (im && typeof im === 'object' && !im.id));
      if (!hasLegacy) {
        stats.skipped++;
        continue;
      }
      try {
        const { out, changed } = normalizeImages(images, historyId) as any;
        if (!changed) {
          stats.skipped++;
          continue;
        }
        if (dryRun) {
          log('DRY-RUN would update', { uid, historyId, legacyCount: images.length });
        } else {
          await d.ref.update({ images: out, updatedAt: new Date() });
          stats.itemsUpdated++;
          log('UPDATED', { uid, historyId, newCount: out.length });
        }
      } catch (e: any) {
        stats.errors++;
        err('Failed normalize', { uid, historyId, err: e?.message });
      }
    }
    const last = docs[docs.length - 1];
    const createdAt = (last.data() as any)?.createdAt;
    if (createdAt) {
      try {
        const ms = typeof createdAt === 'string' ? new Date(createdAt).getTime() : (createdAt?.toDate ? createdAt.toDate().getTime() : NaN);
        if (!Number.isNaN(ms)) lastCreatedAt = ms;
      } catch {}
    }
    if (docs.length < limitPerUser) break;
  }
  log('User done', { uid });
}

async function main() {
  log('START', { limitPerUser, dryRun, filterUsersCount: filterUsers.length });
  const userDocs = await adminDb.collection('generationHistory').listDocuments();
  const allUids = userDocs.map(d => d.id);
  const target = filterUsers.length ? allUids.filter(u => filterUsers.includes(u)) : allUids;
  for (const uid of target) {
    await processUser(uid);
  }
  log('COMPLETE', stats);
  if (dryRun) log('Dry-run complete. Re-run without --dry-run to persist updates.');
}

main().catch(e => { err('Fatal', e?.message || e); process.exit(1); });
