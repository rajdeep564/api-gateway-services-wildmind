#!/usr/bin/env ts-node
/**
 * normalizeGenerationFormat.ts
 *
 * Normalizes the format of generation documents in the 'generations' collection
 * to match the format saved during real generation.
 *
 * Key normalizations:
 * - Converts updatedAt from Firestore timestamp objects to ISO strings
 * - Ensures createdAt is an ISO string (if it's a timestamp)
 * - Ensures consistent field structure
 * - Only processes public, non-deleted generations
 *
 * Usage:
 *   npx ts-node scripts/normalizeGenerationFormat.ts [--batch 200] [--dry] [--resume-after <docId>]
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { adminDb } from '../src/config/firebaseAdmin';

interface Args {
  limit: number;
  resumeAfter?: string;
  dry: boolean;
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
  };
}

function toIsoString(value: any): string | null {
  if (!value) return null;
  
  // Already an ISO string
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value;
  }
  
  // Firestore timestamp object
  if (value && typeof value === 'object') {
    // Check for Firestore Timestamp format
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate().toISOString();
      } catch (e) {
        console.warn('[normalizeGenerationFormat] Failed to convert timestamp with toDate():', e);
      }
    }
    
    // Check for raw Firestore timestamp format { _seconds, _nanoseconds }
    if (typeof value._seconds === 'number') {
      try {
        const seconds = value._seconds;
        const nanoseconds = value._nanoseconds || 0;
        const date = new Date(seconds * 1000 + nanoseconds / 1000000);
        return date.toISOString();
      } catch (e) {
        console.warn('[normalizeGenerationFormat] Failed to convert raw timestamp:', e);
      }
    }
    
    // Check for seconds property (number)
    if (typeof value.seconds === 'number') {
      try {
        const date = new Date(value.seconds * 1000);
        return date.toISOString();
      } catch (e) {
        console.warn('[normalizeGenerationFormat] Failed to convert seconds timestamp:', e);
      }
    }
  }
  
  // Try parsing as date
  if (typeof value === 'number') {
    try {
      return new Date(value).toISOString();
    } catch (e) {
      console.warn('[normalizeGenerationFormat] Failed to convert number timestamp:', e);
    }
  }
  
  // Try Date.parse
  try {
    const parsed = Date.parse(String(value));
    if (!isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  } catch (e) {
    // Ignore
  }
  
  return null;
}

function normalizeDocument(data: any): { needsUpdate: boolean; normalized: any } {
  const normalized: any = { ...data };
  let needsUpdate = false;
  
  // Normalize updatedAt
  if (data.updatedAt) {
    const normalizedUpdatedAt = toIsoString(data.updatedAt);
    if (normalizedUpdatedAt) {
      // Check if it's different from current value
      const currentIsString = typeof data.updatedAt === 'string';
      const currentIsTimestamp = data.updatedAt && typeof data.updatedAt === 'object' && 
        (data.updatedAt._seconds !== undefined || data.updatedAt.seconds !== undefined || typeof data.updatedAt.toDate === 'function');
      
      if (!currentIsString || (currentIsString && data.updatedAt !== normalizedUpdatedAt)) {
        normalized.updatedAt = normalizedUpdatedAt;
        if (currentIsTimestamp) {
          needsUpdate = true;
        }
      }
    }
  } else {
    // If updatedAt is missing, set it to createdAt or current time
    if (data.createdAt) {
      const createdAtIso = toIsoString(data.createdAt);
      if (createdAtIso) {
        normalized.updatedAt = createdAtIso;
        needsUpdate = true;
      }
    } else {
      normalized.updatedAt = new Date().toISOString();
      needsUpdate = true;
    }
  }
  
  // Normalize createdAt (ensure it's an ISO string)
  if (data.createdAt) {
    const normalizedCreatedAt = toIsoString(data.createdAt);
    if (normalizedCreatedAt) {
      const currentIsString = typeof data.createdAt === 'string';
      const currentIsTimestamp = data.createdAt && typeof data.createdAt === 'object' && 
        (data.createdAt._seconds !== undefined || data.createdAt.seconds !== undefined || typeof data.createdAt.toDate === 'function');
      
      if (!currentIsString || (currentIsString && data.createdAt !== normalizedCreatedAt)) {
        normalized.createdAt = normalizedCreatedAt;
        if (currentIsTimestamp) {
          needsUpdate = true;
        }
      }
    }
  } else {
    // If createdAt is missing, use updatedAt or current time
    if (normalized.updatedAt) {
      normalized.createdAt = normalized.updatedAt;
      needsUpdate = true;
    } else {
      normalized.createdAt = new Date().toISOString();
      needsUpdate = true;
    }
  }
  
  // Ensure id field exists (should match document ID)
  if (!normalized.id) {
    needsUpdate = true;
  }
  
  // Ensure isDeleted is boolean (default to false)
  if (typeof normalized.isDeleted !== 'boolean') {
    normalized.isDeleted = false;
    needsUpdate = true;
  }
  
  // Ensure isPublic is boolean
  if (typeof normalized.isPublic !== 'boolean') {
    normalized.isPublic = false;
    needsUpdate = true;
  }
  
  // Ensure arrays exist
  if (!Array.isArray(normalized.images)) {
    normalized.images = [];
    needsUpdate = true;
  }
  
  if (!Array.isArray(normalized.videos)) {
    normalized.videos = [];
    needsUpdate = true;
  }
  
  if (!Array.isArray(normalized.tags)) {
    normalized.tags = [];
    needsUpdate = true;
  }
  
  return { needsUpdate, normalized };
}

async function run() {
  const args = parseArgs();
  console.log('[normalizeGenerationFormat] Starting', args);
  console.log('');

  const col = adminDb.collection('generations');
  // Query only by isPublic to avoid composite index requirement
  // We'll filter isDeleted in memory and sort by createdAt in memory
  let q: FirebaseFirestore.Query = col.where('isPublic', '==', true);
  
  if (args.resumeAfter) {
    try {
      const resumeSnap = await col.doc(args.resumeAfter).get();
      if (resumeSnap.exists) {
        q = q.startAfter(resumeSnap);
        console.log('[normalizeGenerationFormat] Resuming after', args.resumeAfter);
      }
    } catch (e) {
      console.warn('[normalizeGenerationFormat] Could not apply resume-after cursor', e);
    }
  }

  let processed = 0;
  let totalUpdated = 0;
  let skipped = 0;
  let errors = 0;
  let lastDocId: string | undefined;
  const batchLimit = args.limit;
  let done = false;

  while (!done) {
    const snap = await q.limit(batchLimit * 2).get(); // Fetch more to account for filtering
    if (snap.empty) {
      console.log('[normalizeGenerationFormat] No more documents. Finished.');
      break;
    }

    // Filter out deleted documents and sort by createdAt in memory
    const validDocs = snap.docs
      .filter(doc => {
        const data = doc.data();
        return data.isDeleted !== true; // Only process non-deleted
      })
      .sort((a, b) => {
        // Sort by createdAt descending
        const aCreated = toIsoString(a.data().createdAt);
        const bCreated = toIsoString(b.data().createdAt);
        if (!aCreated || !bCreated) return 0;
        return bCreated.localeCompare(aCreated);
      })
      .slice(0, batchLimit); // Limit to batch size after filtering

    if (validDocs.length === 0) {
      // If all docs in this batch were deleted, continue to next batch
      const last = snap.docs[snap.docs.length - 1];
      q = col.where('isPublic', '==', true).startAfter(last);
      if (snap.size < batchLimit * 2) {
        done = true;
      }
      continue;
    }

    const batch = adminDb.batch();
    let batchUpdateCount = 0;

    for (const doc of validDocs) {
      lastDocId = doc.id;
      const data = doc.data();
      
      try {
        const { needsUpdate, normalized } = normalizeDocument(data);
        
        // Set id to match document ID
        normalized.id = doc.id;
        
        if (needsUpdate) {
          processed++;
          console.log(`[normalizeGenerationFormat] Doc ${doc.id}:`);
          console.log(`  createdAt: ${data.createdAt} -> ${normalized.createdAt}`);
          console.log(`  updatedAt: ${data.updatedAt} -> ${normalized.updatedAt}`);
          
          if (!args.dry) {
            batch.set(doc.ref, normalized, { merge: true });
            batchUpdateCount++;
            totalUpdated++;
          } else {
            console.log(`  [DRY RUN] Would update document`);
          }
        } else {
          skipped++;
          if (processed % 100 === 0) {
            console.log(`[normalizeGenerationFormat] Doc ${doc.id}: Already normalized, skipping`);
          }
        }
      } catch (err: any) {
        errors++;
        console.error(`[normalizeGenerationFormat] Error processing doc ${doc.id}:`, err?.message || err);
      }
    }

    if (!args.dry && batchUpdateCount > 0) {
      let attempt = 0;
      const maxAttempts = 5;
      while (true) {
        try {
          await batch.commit();
          console.log(`[normalizeGenerationFormat] Committed batch: ${batchUpdateCount} updates`);
          break;
        } catch (e: any) {
          attempt++;
          if (attempt >= maxAttempts) {
            console.error('[normalizeGenerationFormat] Batch commit failed permanently', e);
            throw e;
          }
          const backoffMs = attempt * 750;
          console.warn('[normalizeGenerationFormat] Batch commit failed, retrying', { attempt, backoffMs, error: e?.message });
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }
    }

    // Prepare next page using last doc from snapshot (not filtered)
    const last = snap.docs[snap.docs.length - 1];
    q = col.where('isPublic', '==', true).startAfter(last);
    
    if (snap.size < batchLimit * 2) {
      done = true; // last page fetched
    }
  }

  console.log('');
  console.log('[normalizeGenerationFormat] Complete', { 
    processed, 
    updated: args.dry ? 0 : totalUpdated, 
    skipped, 
    errors,
    lastDocId 
  });
}

run().catch(err => {
  console.error('[normalizeGenerationFormat] Fatal error', err);
  process.exit(1);
});

