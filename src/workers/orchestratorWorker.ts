/**
 * WildMind AI Orchestrator — BullMQ Worker Process
 *
 * This is a STANDALONE Node.js process (not part of the HTTP server).
 * Run it separately:
 *   ts-node src/workers/orchestratorWorker.ts
 *   OR via PM2 ecosystem.config.js entry
 *
 * It dequeues jobs from the "wildmind-orchestrator" BullMQ queue
 * and executes them via OrchestratorAgent.execute().
 *
 * Configuration via environment variables:
 *   REDIS_URL                      — required (otherwise worker exits immediately)
 *   ORCHESTRATOR_CONCURRENCY       — concurrent jobs per worker (default: 5)
 *   ORCHESTRATOR_STALLED_INTERVAL  — ms between stalled-job checks (default: 30000)
 */

import dotenv from "dotenv";
import path from "path";

// Load env before importing anything else
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { OrchestratorAgent } from "../orchestrator/orchestratorAgent";

const QUEUE_NAME = "wildmind-orchestrator";
const CONCURRENCY = parseInt(process.env.ORCHESTRATOR_CONCURRENCY ?? "5", 10);
const STALLED_INTERVAL = parseInt(
  process.env.ORCHESTRATOR_STALLED_INTERVAL ?? "30000",
  10,
);

// ---------------------------------------------------------------------------
// Guard: require Redis
// ---------------------------------------------------------------------------

if (!process.env.REDIS_URL) {
  console.error(
    "[OrchestratorWorker] ❌ REDIS_URL is not set. Worker cannot start without Redis.",
  );
  console.error("[OrchestratorWorker] Set REDIS_URL in .env and restart.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Start Worker
// ---------------------------------------------------------------------------

async function startWorker(): Promise<void> {
  let Worker: any;
  try {
    ({ Worker } = await import("bullmq"));
  } catch {
    console.error(
      '[OrchestratorWorker] ❌ "bullmq" is not installed. Run: npm install bullmq',
    );
    process.exit(1);
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: any) => {
      console.log(
        `[OrchestratorWorker] Processing job ${job.id} (attempt ${job.attemptsMade + 1})`,
      );
      const data = job.data;
      // Payload validation (SOC2: validate required fields and types before execution)
      if (!data || typeof data !== "object") {
        throw new Error("OrchestratorWorker: job.data must be an object");
      }
      const { jobId, userId, prompt, token } = data;
      if (typeof jobId !== "string" || !jobId.trim()) {
        throw new Error("OrchestratorWorker: job.data.jobId is required and must be a non-empty string");
      }
      if (typeof userId !== "string" || !userId.trim()) {
        throw new Error("OrchestratorWorker: job.data.userId is required and must be a non-empty string");
      }
      if (typeof prompt !== "string" || !prompt.trim()) {
        throw new Error("OrchestratorWorker: job.data.prompt is required and must be a non-empty string");
      }
      if (typeof token !== "string" || !token.trim()) {
        throw new Error("OrchestratorWorker: job.data.token is required and must be a non-empty string");
      }
      const agent = new OrchestratorAgent();
      await agent.execute(job.data);
    },
    {
      connection: { url: process.env.REDIS_URL },
      concurrency: CONCURRENCY,
      stalledInterval: STALLED_INTERVAL,
      maxStalledCount: 2,
    },
  );

  // ─── Event Handlers ───────────────────────────────────────────────────────

  worker.on("active", (job: any) => {
    console.log(`[OrchestratorWorker] 🚀 Job ${job.id} started`);
  });

  worker.on("completed", (job: any) => {
    console.log(`[OrchestratorWorker] ✅ Job ${job.id} completed`);
  });

  worker.on("failed", (job: any, err: Error) => {
    console.error(
      `[OrchestratorWorker] ❌ Job ${job?.id ?? "unknown"} failed:`,
      err.message,
    );
  });

  worker.on("stalled", (jobId: string) => {
    console.warn(
      `[OrchestratorWorker] ⚠️ Job ${jobId} stalled — will be retried`,
    );
  });

  worker.on("error", (err: Error) => {
    console.error("[OrchestratorWorker] Worker-level error:", err.message);
  });

  // ─── Graceful Shutdown ────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    console.log(
      `[OrchestratorWorker] Received ${signal}, shutting down gracefully...`,
    );
    await worker.close();
    console.log("[OrchestratorWorker] Worker closed. Exiting.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // ─── Startup Log ─────────────────────────────────────────────────────────

  console.log(`[OrchestratorWorker] ✅ Started`);
  console.log(`[OrchestratorWorker]    Queue:       ${QUEUE_NAME}`);
  console.log(`[OrchestratorWorker]    Concurrency: ${CONCURRENCY}`);
  console.log(
    `[OrchestratorWorker]    Redis:       ${process.env.REDIS_URL?.replace(/:\/\/.*@/, "://***@")}`,
  );
}

startWorker().catch((err) => {
  console.error("[OrchestratorWorker] Fatal startup error:", err);
  process.exit(1);
});
