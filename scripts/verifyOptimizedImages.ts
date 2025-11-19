#!/usr/bin/env ts-node
/**
 * Verification script: Scan generationHistory for completed items missing thumbnailUrl / avifUrl.
 * Usage:
 *   ts-node scripts/verifyOptimizedImages.ts --limit=200 --users=uid1,uid2
 */
import 'dotenv/config';
import { adminDb } from '../src/config/firebaseAdmin';
import minimist from 'minimist';

interface Args { limit?: number; users?: string; }
const rawArgs: any = minimist(process.argv.slice(2));
const args: Args = {
  limit: rawArgs.limit !== undefined ? Number(rawArgs.limit) : undefined,
  users: typeof rawArgs.users === 'string' ? rawArgs.users : undefined,
};
const perUserLimit = Number(args.limit || 200);
const filterUsers: string[] = args.users && args.users.trim() ? args.users.split(',').map(s => s.trim()).filter(Boolean) : [];

async function scanUser(uid: string) {
  const col = adminDb.collection('generationHistory').doc(uid).collection('items');
  let lastCreatedAt: number | undefined;
  let visited = 0;
  let optimizedImages = 0;
  let optimizedItems = 0;
  let missingThumbImages = 0;
  let missingThumbItems = 0;
  let missingAvifImages = 0;
  while (true) {
    let q = col.orderBy('createdAt', 'desc');
    if (lastCreatedAt) {
      try {
        const ts = (global as any).admin?.firestore?.Timestamp?.fromMillis
          ? (global as any).admin.firestore.Timestamp.fromMillis(lastCreatedAt)
          : undefined;
        if (ts) q = q.startAfter(ts);
      } catch {}
    }
    const snap = await q.limit(perUserLimit).get();
    if (snap.empty) break;
    const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    for (const it of items) {
      visited++;
      if (it.status !== 'completed') continue;
      const images: any[] = Array.isArray(it.images) ? it.images : [];
      const hasAnyThumb = images.some(im => im?.thumbnailUrl);
      const hasAnyAvif = images.some(im => im?.avifUrl);
      if (hasAnyThumb || hasAnyAvif) optimizedItems++;
      if (!hasAnyThumb) missingThumbItems++;
      images.forEach(im => {
        if (im?.thumbnailUrl) optimizedImages++; else missingThumbImages++;
        if (!im?.avifUrl) missingAvifImages++;
      });
    }
    const last = items[items.length - 1];
    const createdAtStr = (last as any)?.createdAt;
    if (createdAtStr) {
      const ms = new Date(createdAtStr).getTime();
      if (!Number.isNaN(ms)) lastCreatedAt = ms;
    }
    if (items.length < perUserLimit) break;
  }
  return { uid, visited, optimizedItems, missingThumbItems, optimizedImages, missingThumbImages, missingAvifImages };
}

async function main() {
  const root = adminDb.collection('generationHistory');
  const userDocs = await root.listDocuments();
  const allUids = userDocs.map(d => d.id);
  const targetUids = filterUsers.length ? allUids.filter(u => filterUsers.includes(u)) : allUids;
  const results = [] as any[];
  for (const uid of targetUids) {
    const r = await scanUser(uid);
    results.push(r);
    console.log('[VERIFY_OPTIMIZED]', r);
  }
  // Aggregate
  const agg = results.reduce((acc, r) => {
    acc.users++;
    acc.visited += r.visited;
    acc.optimizedItems += r.optimizedItems;
    acc.missingThumbItems += r.missingThumbItems;
    acc.optimizedImages += r.optimizedImages;
    acc.missingThumbImages += r.missingThumbImages;
    acc.missingAvifImages += r.missingAvifImages;
    return acc;
  }, { users: 0, visited: 0, optimizedItems: 0, missingThumbItems: 0, optimizedImages: 0, missingThumbImages: 0, missingAvifImages: 0 });
  console.log('[VERIFY_OPTIMIZED][SUMMARY]', agg);
}

main().catch(e => {
  console.error('[VERIFY_OPTIMIZED][ERROR]', e);
  process.exit(1);
});
