# Workers Explanation

This document explains how each background worker in the system functions.

## Overview

Workers are background processes that handle asynchronous tasks, data synchronization, caching, and maintenance operations. They run independently from the main API server and can be executed as:
- Standalone Node.js processes
- Cloud Functions (scheduled or triggered)
- Cron jobs
- Manual API endpoints

---

## 1. Mirror Queue Worker (`mirrorQueueWorker.ts`)

### Purpose
Synchronizes user generation history with a public "mirror" collection for fast public queries. This creates a denormalized copy optimized for public browsing.

### How It Works

#### Architecture
```
User Action → Generation History (source of truth)
                ↓
            Mirror Queue (task queue)
                ↓
        Mirror Queue Worker (processes tasks)
                ↓
        Public Generations Mirror (optimized for queries)
```

#### Workflow

1. **Polling Loop**
   - Continuously polls Firestore `mirrorQueue` collection for pending tasks
   - Default poll interval: 2.5 seconds
   - Uses exponential backoff when queue is empty (up to 15 seconds)

2. **Task Processing**
   - Fetches batch of pending tasks (default: 12 tasks)
   - Processes tasks in parallel pools (default: 4 concurrent)
   - Each task is "claimed" to prevent duplicate processing

3. **Operation Types**

   **a) `upsert` Operation**
   - Full document merge from generation history
   - Fetches fresh data from `generationHistory` if snapshot not provided
   - Handles `createdBy` metadata (user info)
   - Skips if item is marked as deleted
   
   **b) `update` Operation**
   - Partial updates to existing mirror document
   - **Smart merging**: Preserves optimization fields (thumbnailUrl, avifUrl) when updating images/videos
   - Merges new data with existing to avoid losing optimized URLs
   
   **c) `remove` Operation**
   - Deletes document from public mirror
   - Used when generation is deleted or made private

4. **Error Handling**
   - Failed tasks are marked with error message
   - Tasks with < 5 attempts can be retried
   - Logs errors for monitoring

5. **Graceful Shutdown**
   - Handles SIGINT/SIGTERM signals
   - Stops processing new tasks but completes current batch

### Key Features
- ✅ Concurrency control (prevents overwhelming Firestore)
- ✅ Exponential backoff (saves resources when queue is empty)
- ✅ Task claiming (prevents duplicate processing by multiple workers)
- ✅ Smart merging (preserves optimization fields)
- ✅ Deletion safety (checks for deleted items before upserting)

### Configuration
```typescript
POLL_INTERVAL_MS = 2500ms        // How often to check for tasks
PROMISE_POOL_SIZE = 4            // Concurrent task processing
BATCH_LIMIT = 12                  // Max tasks per poll
MAX_BACKOFF_MS = 15000ms          // Max delay when queue empty
```

---

## 2. Mirror Worker (`mirrorWorker.ts`)

### Purpose
Alternative implementation of mirror queue processing. Can be used as:
- Cloud Function trigger (onCreate on mirrorQueue)
- Scheduled cron job
- Standalone worker

### How It Works

Similar to `mirrorQueueWorker.ts` but designed for event-driven processing:

1. **Task Processing Function** (`processMirrorTask`)
   - Processes a single task by ID
   - Claims task to prevent duplicates
   - Handles upsert/update/remove operations
   - **Critical**: Checks if item is deleted before upserting (safety check)

2. **Batch Processing** (`processPendingTasks`)
   - Polls for pending tasks
   - Processes sequentially (to avoid overwhelming Firestore)
   - Continues even if individual tasks fail

### Key Differences from `mirrorQueueWorker.ts`
- More modular (can be called from Cloud Functions)
- Sequential processing (safer for Firestore)
- Better error handling with structured logging
- Can be triggered on-demand via API

---

## 3. Signup Image Cache Worker (`signupImageCacheWorker.ts`)

### Purpose
Refreshes the signup page image cache every 24 hours to ensure fresh, high-scored images are always available for instant loading.

### How It Works

1. **Initial Refresh**
   - Runs immediately on startup
   - Fetches high-scored public images
   - Stores in cache collection

2. **Scheduled Refresh**
   - Runs every 24 hours
   - Refreshes entire cache with new images
   - Ensures signup page always has fresh content

3. **Graceful Shutdown**
   - Handles SIGINT/SIGTERM
   - Completes current refresh before shutting down

### Why It's Needed
- Signup page needs to load quickly
- Pre-fetching images improves user experience
- Regular refresh ensures content stays relevant

### Configuration
```typescript
REFRESH_INTERVAL_MS = 24 hours
```

---

## 4. Canvas Media GC Worker (`canvas/mediaGCWorker.ts`)

### Purpose
Garbage collects (deletes) unreferenced Canvas media files to save storage costs.

### How It Works

1. **Criteria for Deletion**
   - `referencedByCount === 0` (not used by any project)
   - Media is older than TTL (default: 30 days)
   - Must meet both conditions

2. **Process**
   - Finds all unreferenced media older than TTL
   - Deletes file from Zata storage
   - Removes media record from Firestore
   - Processes in batches (default: 100 items)

3. **Safety Features**
   - Dry run mode (preview what would be deleted)
   - Age check (won't delete recent media)
   - Reference count check (won't delete if still referenced)
   - Continues even if individual deletions fail

### Use Cases
- Scheduled daily cleanup
- Manual cleanup via API
- Storage cost optimization

### Configuration
```typescript
ttlDays = 30           // Media must be 30+ days old
batchSize = 100        // Process 100 items per run
dryRun = false         // Actually delete (true = preview only)
```

---

## 5. Canvas Snapshot Worker (`canvas/snapshotWorker.ts`)

### Purpose
Creates periodic snapshots of Canvas projects to enable fast project loading and recovery.

### How It Works

1. **When Snapshots Are Created**
   - After N operations since last snapshot (default: 100 ops)
   - OR after N hours since last snapshot (default: 24 hours)
   - Whichever comes first

2. **Snapshot Contents**
   - All current elements in the project
   - Current operation index
   - Metadata (version, timestamp)

3. **Process**
   - Queries projects that might need snapshots
   - Checks if snapshot criteria are met
   - Fetches all elements for the project
   - Creates snapshot document
   - Updates project with snapshot info

4. **Benefits**
   - Fast project loading (load from snapshot + recent ops)
   - Recovery from corruption
   - Historical state preservation

### Configuration
```typescript
maxOpsSinceSnapshot = 100    // Create after 100 ops
maxTimeSinceSnapshot = 24    // Create after 24 hours
batchSize = 50               // Process 50 projects per run
```

---

## Worker Execution Patterns

### Pattern 1: Continuous Polling
```typescript
while (running) {
  const tasks = await pollTasks();
  await processTasks(tasks);
  await sleep(interval);
}
```
**Used by**: `mirrorQueueWorker.ts`, `signupImageCacheWorker.ts`

### Pattern 2: Event-Driven
```typescript
export async function processTask(taskId, task) {
  // Process single task
}
```
**Used by**: `mirrorWorker.ts` (can be Cloud Function trigger)

### Pattern 3: Scheduled Batch
```typescript
export async function processBatch(config) {
  // Process multiple items
  // Return results
}
```
**Used by**: `mediaGCWorker.ts`, `snapshotWorker.ts`

---

## Error Handling

All workers implement:
- ✅ Try-catch blocks around critical operations
- ✅ Error logging with context
- ✅ Graceful degradation (continue processing other items)
- ✅ Retry logic (for queue-based workers)
- ✅ Graceful shutdown (SIGINT/SIGTERM handlers)

---

## Monitoring & Debugging

### Logs to Watch
- Task processing success/failure
- Queue sizes and processing rates
- Error messages with context
- Performance metrics (duration, counts)

### Health Checks
- Workers should log startup messages
- Regular "heartbeat" logs during processing
- Error rates should be monitored

### Common Issues
1. **Queue backing up**: Increase concurrency or add more workers
2. **High error rate**: Check Firestore permissions, data integrity
3. **Memory leaks**: Monitor worker memory usage over time
4. **Stuck tasks**: Check for tasks with high attempt counts

---

## Deployment

### Standalone Process
```bash
node dist/workers/mirrorQueueWorker.js
```

### Cloud Function
```typescript
exports.processMirrorQueue = functions.firestore
  .document('mirrorQueue/{taskId}')
  .onCreate(async (snap, context) => {
    await processMirrorTask(context.params.taskId, snap.data());
  });
```

### Scheduled Job
```typescript
exports.scheduledSnapshot = functions.pubsub
  .schedule('every 6 hours')
  .onRun(async () => {
    await processSnapshots();
  });
```

---

## Summary

| Worker | Purpose | Frequency | Key Feature |
|--------|---------|-----------|-------------|
| `mirrorQueueWorker` | Sync history → mirror | Continuous (2.5s) | Smart merging, concurrency control |
| `mirrorWorker` | Alternative mirror processor | Event-driven | Modular, Cloud Function ready |
| `signupImageCacheWorker` | Refresh signup images | Every 24h | Pre-caching for fast loading |
| `mediaGCWorker` | Cleanup unused media | Scheduled/Manual | Storage cost optimization |
| `snapshotWorker` | Create project snapshots | On-demand/Scheduled | Fast loading, recovery |

All workers are designed to be:
- **Resilient**: Handle errors gracefully
- **Scalable**: Can run multiple instances
- **Observable**: Comprehensive logging
- **Maintainable**: Clear code structure

