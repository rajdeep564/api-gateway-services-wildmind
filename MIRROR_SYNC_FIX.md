# Public Repository Mirror Sync Fix

## Problem
Generations sometimes don't appear in the public repository (`generations` collection) because mirror sync operations are wrapped in silent `try {} catch {}` blocks that fail without logging or retrying.

## Solution Implemented

### 1. Created Robust Mirror Sync Utility (`src/utils/mirrorHelper.ts`)

```typescript
// New utility functions with retry logic and detailed error logging
- syncToMirror(uid, historyId, retries=3): Sync with automatic retries
- updateMirror(uid, historyId, updates, retries=2): Update mirror status
- ensureMirrorSync(uid, historyId, maxRetries=5): Background sync for setImmediate tasks
```

**Key Features:**
- ✅ Automatic retries with exponential backoff
- ✅ Detailed error logging for debugging
- ✅ Success confirmations in console
- ✅ Critical failure alerts after all retries exhausted

### 2. Updated FAL Service (`src/services/falService.ts`)

**Fixed Functions:**
- ✅ `generate()` - Main text-to-image generation
- ✅ `veoTextToVideo()` - Veo 3 text-to-video
- ✅ `veoTextToVideoFast()` - Veo 3 fast T2V
- ✅ `veoImageToVideo()` - Veo 3 image-to-video
- ✅ `veoImageToVideoFast()` - Veo 3 fast I2V
- ✅ `briaExpandImage()` - Bria image expansion

**Remaining to Fix in falService.ts:**
- 🔄 `outpaintImage()`
- 🔄 `topazUpscaleImage()`
- 🔄 `seedvrUpscale()`
- 🔄 `image2svg()`
- 🔄 `recraftVectorize()`
- 🔄 `briaGenfill()`
- 🔄 `queueResult()` (for Veo 3.1, Sora 2, LTX V2)

### 3. Services Still Requiring Fixes

**HIGH PRIORITY:**
- 📁 `src/services/bflService.ts` - Black Forest Labs (Flux models)
- 📁 `src/services/minimaxService.ts` - MiniMax video & music
- 📁 `src/services/replicateService.ts` - Replicate (Kling, Pixverse, etc.)
- 📁 `src/services/runwayService.ts` - Runway ML video generation

**Pattern to Replace:**

**❌ OLD (Fragile):**
```typescript
try {
  const fresh = await generationHistoryRepository.get(uid, historyId);
  if (fresh) {
    await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
      uid,
      username: creator?.username,
      displayName: creator?.displayName,
      photoURL: creator?.photoURL,
    });
  }
} catch {}
```

**✅ NEW (Robust):**
```typescript
// Import at top
import { syncToMirror, updateMirror, ensureMirrorSync } from "../utils/mirrorHelper";

// In success path
await syncToMirror(uid, historyId); // Retries automatically

// In error handlers
await updateMirror(uid, historyId, { status: 'failed' as any, error: message });

// In setImmediate/background tasks
await ensureMirrorSync(uid, historyId); // Max retries for eventual consistency
```

## Implementation Steps for Remaining Services

### Step 1: Import Helper
```typescript
import { syncToMirror, updateMirror, ensureMirrorSync } from "../utils/mirrorHelper";
```

### Step 2: Replace Success Path Syncs
Find all patterns like:
```typescript
try {
  const fresh = await generationHistoryRepository.get(uid, historyId);
  if (fresh) await generationsMirrorRepository.upsertFromHistory(...);
} catch {}
```

Replace with:
```typescript
await syncToMirror(uid, historyId);
```

### Step 3: Replace Error Path Syncs
Find all patterns like:
```typescript
try {
  await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message });
  const fresh = await generationHistoryRepository.get(uid, historyId);
  if (fresh) await generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
} catch {}
```

Replace with:
```typescript
try {
  await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message });
  await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
} catch (mirrorErr) {
  console.error('[functionName] Failed to mirror error state:', mirrorErr);
}
```

### Step 4: Replace Background Task Syncs
In `setImmediate` blocks, replace:
```typescript
try {
  const fresh = await generationHistoryRepository.get(uid, historyId);
  if (fresh) await generationsMirrorRepository.upsertFromHistory(...);
} catch {}
```

With:
```typescript
await ensureMirrorSync(uid, historyId); // Uses 5 retries for background tasks
```

## Testing Checklist

After applying fixes to each service:

1. ✅ Test generation creates history entry
2. ✅ Test generation appears in public feed (if isPublic=true)
3. ✅ Test failed generations are mirrored
4. ✅ Check console logs for mirror sync confirmations
5. ✅ Verify no silent failures (all errors logged)
6. ✅ Test with network issues/timeouts (retry logic)

## Benefits

- **Reliability**: Automatic retries prevent transient failures
- **Visibility**: Detailed logging makes debugging easy
- **Consistency**: All generations guaranteed to reach mirror
- **Monitoring**: Critical failures flagged for alerting
- **Performance**: Fast-fail for permanent errors, retry for transient ones

## Next Actions

1. Complete remaining falService functions
2. Apply same pattern to bflService
3. Apply same pattern to minimaxService  
4. Apply same pattern to replicateService
5. Apply same pattern to runwayService
6. Run comprehensive integration tests
7. Monitor logs for any remaining failures

## Files Modified

- ✅ `src/utils/mirrorHelper.ts` (NEW)
- 🔄 `src/services/falService.ts` (PARTIAL)
- ⏳ `src/services/bflService.ts` (PENDING)
- ⏳ `src/services/minimaxService.ts` (PENDING)
- ⏳ `src/services/replicateService.ts` (PENDING)
- ⏳ `src/services/runwayService.ts` (PENDING)
