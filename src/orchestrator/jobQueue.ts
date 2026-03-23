/**
 * WildMind AI Orchestrator — Job Queue
 *
 * Manages async job submission and processing using BullMQ.
 *
 * In production (Redis available):  Uses BullMQ for reliable async processing.
 * In development (no Redis):        Falls back to inline synchronous execution.
 *
 * BullMQ features used:
 * - Automatic retries (3 attempts, exponential backoff)
 * - Concurrency control (configurable, default: 5)
 * - Job deduplication (jobId used as BullMQ job ID)
 * - Dead letter queue (jobs retained on failure for debugging)
 */

import type { OrchestratorJobPayload } from "./types/orchestratorTypes";

const QUEUE_NAME = "wildmind-orchestrator";

// Lazily import BullMQ to avoid errors when it isn't installed in dev
let _Queue: any = null;
let _queueInstance: any = null;

async function getQueue(): Promise<any | null> {
  if (!process.env.REDIS_URL) return null;

  if (_queueInstance) return _queueInstance;

  try {
    const { Queue } = await import("bullmq");
    _queueInstance = new Queue(QUEUE_NAME, {
      connection: { url: process.env.REDIS_URL },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2_000, // 2s → 4s → 8s
        },
        removeOnComplete: { count: 100, age: 3600 }, // keep last 100 completed, max 1h
        removeOnFail: { count: 50, age: 86400 }, // keep last 50 failed for 24h
      },
    });

    console.log(`[JobQueue] BullMQ queue "${QUEUE_NAME}" initialized`);
    return _queueInstance;
  } catch (err: any) {
    console.error("[JobQueue] Failed to initialize BullMQ:", err?.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Inline executor (dev / no-Redis fallback)
// ---------------------------------------------------------------------------

async function executeInline(payload: OrchestratorJobPayload): Promise<void> {
  console.log(
    `[JobQueue] ⚠️ No Redis — executing job ${payload.jobId} inline (synchronous)`,
  );
  // Lazy import to avoid circular dependency
  const { OrchestratorAgent } = await import("./orchestratorAgent");
  const agent = new OrchestratorAgent();
  await agent.execute(payload);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enqueue an orchestration job.
 *
 * If BullMQ (Redis) is available: adds to queue and returns immediately.
 * Otherwise: executes inline and returns after completion.
 *
 * @returns The BullMQ job ID (same as payload.jobId) or "inline" if no queue.
 */
export async function enqueueOrchestrationJob(
  payload: OrchestratorJobPayload,
): Promise<string> {
  const queue = await getQueue();

  if (queue) {
    const job = await queue.add("orchestrate", payload, {
      jobId: payload.jobId, // ensures deduplication
    });
    console.log(`[JobQueue] ✅ Enqueued job ${payload.jobId} to BullMQ`);
    return job.id as string;
  }

  // Inline fallback — run without await so the HTTP response can still return
  setImmediate(() => executeInline(payload));
  return "inline";
}

/**
 * Gracefully close the BullMQ queue connection.
 * Call this during server shutdown.
 */
export async function closeQueue(): Promise<void> {
  if (_queueInstance) {
    await _queueInstance.close();
    _queueInstance = null;
    console.log("[JobQueue] Queue connection closed");
  }
}
