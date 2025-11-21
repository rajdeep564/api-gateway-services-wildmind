#!/usr/bin/env ts-node
/**
 * deleteBrokenImagesFromPublic.ts
 *
 * Deletes items from the public 'generations' collection that have broken image/video URLs
 * (AccessDenied errors). These items appear because the delete functionality wasn't working properly.
 *
 * Usage:
 *   npx ts-node scripts/deleteBrokenImagesFromPublic.ts [--batch 50] [--dry] [--resume-after <docId>] [--limit 1000]
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { adminDb } from '../src/config/firebaseAdmin';
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
    batch: Number(get('--batch', '50')),
    resumeAfter: get('--resume-after'),
    dry: argv.includes('--dry'),
    limit: get('--limit') ? Number(get('--limit')) : undefined,
    concurrency: Number(get('--concurrency', '10')),
  };
}

/**
 * Check if a URL is broken (returns AccessDenied or XML error)
 */
async function checkUrlBroken(url: string, timeout = 2000): Promise<{ broken: boolean; reason?: string; details?: any }> {
  if (!url) {
    return { broken: false, reason: 'no_url' };
  }

  // Quick string check first
  if (url.includes('AccessDenied') || url.includes('<Error>') || url.includes('Error>')) {
    return { broken: true, reason: 'error_in_url_string', details: { url } };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'WildMind-BrokenImage-Checker/1.0' },
    }).finally(() => clearTimeout(timeoutId));

    const status = response.status;
    const contentType = response.headers.get('content-type') || '';

    // Check status code
    if (status === 403 || status === 404) {
      return { broken: true, reason: `http_${status}`, details: { status, contentType, url } };
    }

    // Check content-type - if XML, likely an error response
    if (contentType.includes('xml') || contentType.includes('text/xml') || contentType === 'application/xml') {
      // For XML responses, check if it's an error (read first 200 bytes only)
      try {
        const textController = new AbortController();
        const textTimeout = setTimeout(() => textController.abort(), timeout);

        const textResponse = await fetch(url, {
          method: 'GET',
          signal: textController.signal,
          headers: { 'User-Agent': 'WildMind-BrokenImage-Checker/1.0', 'Range': 'bytes=0-200' },
        }).finally(() => clearTimeout(textTimeout));

        const text = await textResponse.text();

        if (text.includes('<Error>') || text.includes('<Code>AccessDenied</Code>') || text.includes('AccessDenied')) {
          return { broken: true, reason: 'xml_error_response', details: { status, contentType, text: text.substring(0, 200), url } };
        }
      } catch (textError: any) {
        // If we can't read, assume it's OK to avoid false positives
        return { broken: false, reason: 'xml_read_failed', details: { error: textError?.message } };
      }
    }

    return { broken: !response.ok, reason: response.ok ? 'ok' : 'not_ok', details: { status, contentType, ok: response.ok } };
  } catch (error: any) {
    // On timeout or network error, assume not broken (don't delete to avoid false positives)
    return { broken: false, reason: 'check_error', details: { error: error?.message || error?.name } };
  }
}

/**
 * Check if an item has broken media URLs
 */
async function checkItemBroken(doc: any): Promise<{ broken: boolean; url?: string; reason?: string; details?: any }> {
  const data = doc.data();
  const itemId = doc.id;

  // Get primary media URL (first image or video)
  let primaryUrl: string | null = null;

  if (Array.isArray(data.images) && data.images.length > 0) {
    primaryUrl = data.images[0]?.url || data.images[0]?.originalUrl || null;
  } else if (Array.isArray(data.videos) && data.videos.length > 0) {
    primaryUrl = data.videos[0]?.url || data.videos[0]?.originalUrl || null;
  }

  if (!primaryUrl) {
    // No media URL to check - assume not broken
    return { broken: false, reason: 'no_primary_url' };
  }

  const checkResult = await checkUrlBroken(primaryUrl);
  return {
    broken: checkResult.broken,
    url: primaryUrl,
    reason: checkResult.reason,
    details: checkResult.details,
  };
}

async function run() {
  const args = parseArgs();
  const col = adminDb.collection('generations');

  console.log('[deleteBrokenImagesFromPublic] Starting script with args:', args);
  console.log(`[deleteBrokenImagesFromPublic] Mode: ${args.dry ? 'DRY RUN (no deletions)' : 'LIVE (will delete)'}`);

  let processed = 0;
  let deleted = 0;
  let skipped = 0;
  let errors = 0;
  let lastDocId: string | undefined = args.resumeAfter;

  const limiter = pLimit(args.concurrency);

  while (true) {
    let query: FirebaseFirestore.Query = col
      .where('isPublic', '==', true)
      .where('isDeleted', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(args.batch);

    if (lastDocId) {
      const lastDoc = await col.doc(lastDocId).get();
      if (lastDoc.exists) {
        query = query.startAfter(lastDoc);
      } else {
        console.warn(`[deleteBrokenImagesFromPublic] Resume doc ${lastDocId} not found, starting from beginning`);
        lastDocId = undefined;
      }
    }

    const snap = await query.get();

    if (snap.empty) {
      console.log('[deleteBrokenImagesFromPublic] No more documents to process');
      break;
    }

    console.log(`[deleteBrokenImagesFromPublic] Processing batch of ${snap.docs.length} documents...`);

    // Check all items in parallel
    const checkResults = await Promise.allSettled(
      snap.docs.map((doc) =>
        limiter(async () => {
          try {
            const result = await checkItemBroken(doc);
            return { doc, result };
          } catch (error: any) {
            console.error(`[deleteBrokenImagesFromPublic] Error checking item ${doc.id}:`, error?.message || error);
            return { doc, result: { broken: false, reason: 'check_error', details: { error: error?.message } } };
          }
        })
      )
    );

    // Process results and delete broken items
    for (const checkResult of checkResults) {
      if (checkResult.status === 'fulfilled') {
        const { doc, result } = checkResult.value;
        processed++;

        if (result.broken) {
          console.log(`[deleteBrokenImagesFromPublic] Found broken item: ${doc.id}`, {
            url: result.url,
            reason: result.reason,
            details: result.details,
          });

          if (!args.dry) {
            try {
              await col.doc(doc.id).delete();
              deleted++;
              console.log(`[deleteBrokenImagesFromPublic] ✅ Deleted broken item: ${doc.id}`);
            } catch (error: any) {
              errors++;
              console.error(`[deleteBrokenImagesFromPublic] ❌ Failed to delete ${doc.id}:`, error?.message || error);
            }
          } else {
            deleted++;
            console.log(`[deleteBrokenImagesFromPublic] [DRY RUN] Would delete: ${doc.id}`);
          }
        } else {
          skipped++;
        }
      } else {
        errors++;
        console.error(`[deleteBrokenImagesFromPublic] Check failed:`, checkResult.reason);
      }
    }

    // Update last doc ID for pagination
    if (snap.docs.length > 0) {
      lastDocId = snap.docs[snap.docs.length - 1].id;
    }

    // Check if we've reached the limit
    if (args.limit && processed >= args.limit) {
      console.log(`[deleteBrokenImagesFromPublic] Reached limit of ${args.limit} items`);
      break;
    }

    // If we got fewer docs than batch size, we're done
    if (snap.docs.length < args.batch) {
      break;
    }

    // Small delay to avoid overwhelming the system
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log('\n[deleteBrokenImagesFromPublic] ========== SUMMARY ==========');
  console.log(`[deleteBrokenImagesFromPublic] Processed: ${processed}`);
  console.log(`[deleteBrokenImagesFromPublic] Deleted: ${deleted}`);
  console.log(`[deleteBrokenImagesFromPublic] Skipped (not broken): ${skipped}`);
  console.log(`[deleteBrokenImagesFromPublic] Errors: ${errors}`);
  console.log(`[deleteBrokenImagesFromPublic] Last processed doc ID: ${lastDocId || 'N/A'}`);
  console.log(`[deleteBrokenImagesFromPublic] Mode: ${args.dry ? 'DRY RUN' : 'LIVE'}`);
  console.log('[deleteBrokenImagesFromPublic] ============================\n');

  process.exit(0);
}

run().catch((error) => {
  console.error('[deleteBrokenImagesFromPublic] Fatal error:', error);
  process.exit(1);
});

