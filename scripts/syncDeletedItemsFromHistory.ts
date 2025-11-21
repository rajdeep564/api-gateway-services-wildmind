#!/usr/bin/env ts-node
/**
 * syncDeletedItemsFromHistory.ts
 *
 * Syncs deleted items from user history to the public mirror repository.
 * Finds items in the public 'generations' collection that should be deleted
 * because they are marked as deleted in the user's history.
 *
 * This fixes the issue where deleted items still appear in ArtStation feed.
 *
 * Usage:
 *   npx ts-node scripts/syncDeletedItemsFromHistory.ts [--batch 100] [--dry] [--resume-after <docId>] [--limit 1000]
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { adminDb } from '../src/config/firebaseAdmin';
import { generationHistoryRepository } from '../src/repository/generationHistoryRepository';
import { generationsMirrorRepository } from '../src/repository/generationsMirrorRepository';
import pLimit from 'p-limit';

interface Args {
  batch: number;
  resumeAfter?: string;
  dry: boolean;
  limit?: number;
  concurrency: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, def?: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : def;
  };
  return {
    batch: Number(get('--batch', '100')),
    resumeAfter: get('--resume-after'),
    dry: argv.includes('--dry'),
    limit: get('--limit') ? Number(get('--limit')) : undefined,
    concurrency: Number(get('--concurrency', '10')),
  };
}

/**
 * Check if an item in the public mirror should be deleted by checking the user's history
 */
async function shouldDeleteFromMirror(
  mirrorDoc: FirebaseFirestore.QueryDocumentSnapshot
): Promise<{ shouldDelete: boolean; reason?: string; historyData?: any }> {
  const mirrorData = mirrorDoc.data();
  const historyId = mirrorDoc.id;
  const uid = mirrorData.uid;

  if (!uid) {
    return { shouldDelete: false, reason: 'no_uid' };
  }

  try {
    // Fetch the corresponding item from user's history
    const historyItem = await generationHistoryRepository.get(uid, historyId);

    if (!historyItem) {
      // Item doesn't exist in history - might be orphaned, but don't delete to be safe
      return { shouldDelete: false, reason: 'not_in_history' };
    }

    // Check if item is deleted in history
    const isDeletedInHistory = (historyItem as any)?.isDeleted === true;
    const isPublicInHistory = (historyItem as any)?.isPublic === true;

    if (isDeletedInHistory) {
      return {
        shouldDelete: true,
        reason: 'deleted_in_history',
        historyData: { isDeleted: true, isPublic: isPublicInHistory },
      };
    }

    // Also check if item is not public in history (shouldn't be in mirror)
    if (!isPublicInHistory) {
      return {
        shouldDelete: true,
        reason: 'not_public_in_history',
        historyData: { isDeleted: isDeletedInHistory, isPublic: false },
      };
    }

    return { shouldDelete: false, reason: 'valid_item' };
  } catch (error: any) {
    console.error(`[syncDeletedItemsFromHistory] Error checking history for ${historyId}:`, error?.message || error);
    return { shouldDelete: false, reason: 'check_error', historyData: { error: error?.message } };
  }
}

async function run() {
  const args = parseArgs();
  const col = adminDb.collection('generations');

  console.log('[syncDeletedItemsFromHistory] Starting script with args:', args);
  console.log(`[syncDeletedItemsFromHistory] Mode: ${args.dry ? 'DRY RUN (no deletions)' : 'LIVE (will delete)'}`);

  let processed = 0;
  let deleted = 0;
  let skipped = 0;
  let errors = 0;
  let lastDocId: string | undefined = args.resumeAfter;

  const limiter = pLimit(args.concurrency);

  while (true) {
    let query: FirebaseFirestore.Query = col
      .where('isPublic', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(args.batch);

    if (lastDocId) {
      const lastDoc = await col.doc(lastDocId).get();
      if (lastDoc.exists) {
        query = query.startAfter(lastDoc);
      } else {
        console.warn(`[syncDeletedItemsFromHistory] Resume doc ${lastDocId} not found, starting from beginning`);
        lastDocId = undefined;
      }
    }

    const snap = await query.get();

    if (snap.empty) {
      console.log('[syncDeletedItemsFromHistory] No more documents to process');
      break;
    }

    console.log(`[syncDeletedItemsFromHistory] Processing batch of ${snap.docs.length} documents...`);

    // Check all items in parallel
    const checkResults = await Promise.allSettled(
      snap.docs.map((doc) =>
        limiter(async () => {
          try {
            const result = await shouldDeleteFromMirror(doc);
            return { doc, result };
          } catch (error: any) {
            console.error(`[syncDeletedItemsFromHistory] Error checking item ${doc.id}:`, error?.message || error);
            return { doc, result: { shouldDelete: false, reason: 'check_error', historyData: { error: error?.message } } };
          }
        })
      )
    );

    // Process results and delete items that should be deleted
    for (const checkResult of checkResults) {
      if (checkResult.status === 'fulfilled') {
        const { doc, result } = checkResult.value;
        processed++;

        if (result.shouldDelete) {
          console.log(`[syncDeletedItemsFromHistory] Found item to delete: ${doc.id}`, {
            reason: result.reason,
            historyData: result.historyData,
            mirrorData: {
              isDeleted: doc.data().isDeleted,
              isPublic: doc.data().isPublic,
              uid: doc.data().uid,
            },
          });

          if (!args.dry) {
            try {
              await generationsMirrorRepository.remove(doc.id);
              deleted++;
              console.log(`[syncDeletedItemsFromHistory] ✅ Deleted item from mirror: ${doc.id}`);
            } catch (error: any) {
              errors++;
              console.error(`[syncDeletedItemsFromHistory] ❌ Failed to delete ${doc.id}:`, error?.message || error);
            }
          } else {
            deleted++;
            console.log(`[syncDeletedItemsFromHistory] [DRY RUN] Would delete: ${doc.id}`);
          }
        } else {
          skipped++;
          if (result.reason !== 'valid_item') {
            console.log(`[syncDeletedItemsFromHistory] Skipped ${doc.id}: ${result.reason}`);
          }
        }
      } else {
        errors++;
        console.error(`[syncDeletedItemsFromHistory] Check failed:`, checkResult.reason);
      }
    }

    // Update last doc ID for pagination
    if (snap.docs.length > 0) {
      lastDocId = snap.docs[snap.docs.length - 1].id;
    }

    // Check if we've reached the limit
    if (args.limit && processed >= args.limit) {
      console.log(`[syncDeletedItemsFromHistory] Reached limit of ${args.limit} items`);
      break;
    }

    // If we got fewer docs than batch size, we're done
    if (snap.docs.length < args.batch) {
      break;
    }

    // Small delay to avoid overwhelming the system
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log('\n[syncDeletedItemsFromHistory] ========== SUMMARY ==========');
  console.log(`[syncDeletedItemsFromHistory] Processed: ${processed}`);
  console.log(`[syncDeletedItemsFromHistory] Deleted: ${deleted}`);
  console.log(`[syncDeletedItemsFromHistory] Skipped (valid items): ${skipped}`);
  console.log(`[syncDeletedItemsFromHistory] Errors: ${errors}`);
  console.log(`[syncDeletedItemsFromHistory] Last processed doc ID: ${lastDocId || 'N/A'}`);
  console.log(`[syncDeletedItemsFromHistory] Mode: ${args.dry ? 'DRY RUN' : 'LIVE'}`);
  console.log('[syncDeletedItemsFromHistory] ============================\n');

  process.exit(0);
}

run().catch((error) => {
  console.error('[syncDeletedItemsFromHistory] Fatal error:', error);
  process.exit(1);
});

