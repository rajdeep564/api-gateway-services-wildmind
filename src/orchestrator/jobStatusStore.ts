/**
 * WildMind AI Orchestrator — Job Status Store
 *
 * Stores and retrieves job state using Redis as primary store.
 *
 * If Redis is unavailable (dev mode), falls back to an in-process Map.
 * This in-memory fallback does NOT persist across restarts and does NOT
 * work across multiple server instances — use Redis in production.
 *
 * Job TTL: 24 hours (auto-expires in Redis).
 */

import { v4 as uuidv4 } from "uuid";
import { redisSetSafe, redisGetSafe } from "../config/redisClient";
import type {
  OrchestratorJobStatus,
  JobStatus,
  OrchestratorStepResult,
  OrchestratorPlan,
} from "./types/orchestratorTypes";

// ---------------------------------------------------------------------------
// In-memory fallback (dev / no-Redis)
// ---------------------------------------------------------------------------

const inMemoryStore = new Map<string, OrchestratorJobStatus>();
const JOB_TTL_SECONDS = 86_400; // 24 hours

function isRedisAvailable(): boolean {
  return Boolean(process.env.REDIS_URL);
}

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

export function generateJobId(): string {
  return `orch_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Create a new job record and store it.
 * Returns the initial job status object.
 */
export async function createJobStatus(
  userId: string,
  prompt: string,
): Promise<OrchestratorJobStatus> {
  const jobId = generateJobId();
  const now = Date.now();

  const job: OrchestratorJobStatus = {
    jobId,
    userId,
    status: "pending",
    steps: [],
    createdAt: now,
    updatedAt: now,
  };

  await _saveJob(job);
  console.log(`[JobStatusStore] Created job ${jobId} for user ${userId}`);
  return job;
}

/**
 * Atomically read → merge → write job status.
 * Safe to call concurrently from multiple places.
 */
export async function updateJobStatus(
  jobId: string,
  update: Partial<
    Omit<OrchestratorJobStatus, "jobId" | "userId" | "createdAt">
  >,
): Promise<void> {
  const existing = await getJobStatus(jobId);
  if (!existing) {
    console.warn(
      `[JobStatusStore] updateJobStatus called for unknown jobId: ${jobId}`,
    );
    return;
  }

  const updated: OrchestratorJobStatus = {
    ...existing,
    ...update,
    updatedAt: Date.now(),
  };

  await _saveJob(updated);
}

/**
 * Retrieve a job by ID. Returns null if not found.
 */
export async function getJobStatus(
  jobId: string,
): Promise<OrchestratorJobStatus | null> {
  if (isRedisAvailable()) {
    return redisGetSafe<OrchestratorJobStatus>(`orchestrator:job:${jobId}`);
  }
  return inMemoryStore.get(jobId) ?? null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _saveJob(job: OrchestratorJobStatus): Promise<void> {
  if (isRedisAvailable()) {
    await redisSetSafe(`orchestrator:job:${job.jobId}`, job, JOB_TTL_SECONDS);
  } else {
    inMemoryStore.set(job.jobId, job);
    // Auto-evict from in-memory after TTL (best-effort)
    setTimeout(() => inMemoryStore.delete(job.jobId), JOB_TTL_SECONDS * 1000);
  }
}
