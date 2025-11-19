# Snapshot Request Fix

## Problem
Continuous snapshot requests were being made, causing performance issues and unnecessary load.

## Root Cause
The `getSnapshot` endpoint in `snapshotController.ts` was creating snapshots **on-the-fly** every time it was called. This meant:
- Every time a client called `GET /api/canvas/projects/:id/snapshot`, it would:
  1. Query all elements from Firestore
  2. Build a snapshot object
  3. Return it (but not save it)

This was expensive and unnecessary, especially since:
- The `useOpManager` hook calls `getSnapshot()` during initialization
- Multiple clients might be initializing simultaneously
- The sync interval (every 5 seconds) was calling `getOps()`, but if `getSnapshot()` was being called elsewhere, it would trigger snapshot creation

## Solution
Removed the on-the-fly snapshot creation logic from `getSnapshot` endpoint:

### Before:
```typescript
// If no snapshot or requested fromOp is after snapshot, create on-the-fly
if (!snapshot || fromOp > snapshotOpIndex) {
  // Expensive: Query all elements and build snapshot
  const elementsSnap = await elementsRef.get();
  // ... build snapshot
}
```

### After:
```typescript
// Get latest snapshot (don't create on-the-fly - let worker handle it)
let snapshot = await projectRepository.getLatestSnapshot(projectId);

// If no snapshot exists, return empty snapshot and all ops
// Worker will create proper snapshot later
if (!snapshot) {
  snapshot = {
    projectId,
    snapshotOpIndex: -1,
    elements: {},
    metadata: { ... },
  };
}
```

## Benefits
1. **No expensive operations on GET requests** - Just returns existing snapshot
2. **Worker handles snapshot creation** - Snapshots are created by the background worker when needed (every 100 ops or 24 hours)
3. **Better performance** - GET requests are now fast and lightweight
4. **Proper separation of concerns** - Read operations don't trigger write operations

## How Snapshots Are Created Now

1. **Background Worker** (recommended):
   - Triggered via `POST /api/canvas/workers/snapshot`
   - Can be scheduled (Cloud Functions, Cloud Run, cron job)
   - Creates snapshots when:
     - Project has 100+ ops since last snapshot
     - 24+ hours have passed since last snapshot

2. **Manual Creation**:
   - `POST /api/canvas/projects/:id/snapshot`
   - Only owner/editor can create
   - Useful for testing or manual triggers

3. **Automatic on First Load**:
   - If no snapshot exists, client gets empty snapshot + all ops
   - Client replays all ops to build state
   - Worker will create snapshot later for faster future loads

## Testing
- ✅ GET requests are now fast (no element queries)
- ✅ No continuous snapshot creation
- ✅ Worker still creates snapshots when needed
- ✅ Clients can still load projects without snapshots (replay all ops)

