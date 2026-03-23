/**
 * WildMind — Orchestrator Structured Logger
 *
 * Single source of truth for all orchestration-layer log formatting.
 * Every stage emits a canonical prefixed line that can be grepped:
 *
 *   [ORCH:<jobId>] Stage=PLAN  taskType=video complexity=high credits=620cr
 *   [ORCH:<jobId>] Stage=MODEL step=runway_video_1 → runway/gen3 score=0.921
 *   [ORCH:<jobId>] Stage=BUDGET status=DOWNGRADED 820→620
 *   [ORCH:<jobId>] Stage=EXEC  step=runway_video_1 status=done 47.2s
 *   [ORCH:<jobId>] Stage=DONE  success=2/2 total=62.1s
 *
 * Usage:
 *   const log = new OrchestratorLogger(jobId);
 *   log.stage("PLAN", { taskType, steps, credits });
 */

import { safePromptMeta, formatSafePromptLog } from "../utils/safePromptLog";

type Stage =
  | "INIT"
  | "PLAN"
  | "MODEL"
  | "BUDGET"
  | "REUSE"
  | "EXEC"
  | "QUALITY"
  | "STORE"
  | "DONE"
  | "ERROR";

export class OrchestratorLogger {
  private readonly jobId: string;
  private readonly startMs: number;

  constructor(jobId: string) {
    this.jobId = jobId;
    this.startMs = Date.now();
  }

  private prefix(stage: Stage): string {
    return `[ORCH:${this.jobId}] Stage=${stage.padEnd(7)}`;
  }

  private elapsed(): string {
    return `+${((Date.now() - this.startMs) / 1000).toFixed(1)}s`;
  }

  // ── Job lifecycle ──────────────────────────────────────────────────────────

  init(userId: string, prompt: string, hints?: Record<string, any>) {
    const meta = safePromptMeta(prompt, hints?.model as string | undefined);
    console.log(
      `${this.prefix("INIT")} user=${userId} ${formatSafePromptLog(meta)}`,
      hints ? `hints=${JSON.stringify(hints)}` : ""
    );
  }

  // ── Planning ───────────────────────────────────────────────────────────────

  planStart() {
    console.log(`${this.prefix("PLAN")} 🤔 Generating execution plan…`);
  }

  planDone(opts: {
    taskType: string;
    complexity: string;
    style: string;
    steps: number;
    credits: number;
    generatedBy: string;
    durationMs: number;
  }) {
    console.log(
      `${this.prefix("PLAN")} ✅ taskType=${opts.taskType} complexity=${opts.complexity} ` +
      `style="${opts.style}" steps=${opts.steps} credits=${opts.credits}cr ` +
      `generatedBy=${opts.generatedBy} (${opts.durationMs}ms) ${this.elapsed()}`
    );
  }

  planSteps(steps: Array<{ stepId: string; service: string; creditCost: number; order: number }>) {
    steps.forEach((s) =>
      console.log(
        `${this.prefix("PLAN")}   step[${s.order}] ${s.stepId} → service=${s.service} cost=${s.creditCost}cr`
      )
    );
  }

  planError(err: string) {
    console.error(`${this.prefix("PLAN")} ❌ Planning failed: ${err}`);
  }

  // ── Model selection ────────────────────────────────────────────────────────

  modelSelectApplied(opts: {
    stepId: string;
    from: string;
    to: string;
    provider: string;
    score: number;
    creditCost: number;
    breakdown: { quality: number; cost: number; latency: number; styleMatch: number };
  }) {
    const b = opts.breakdown;
    console.log(
      `${this.prefix("MODEL")} ${opts.stepId}: ${opts.from} → ${opts.provider}/${opts.to} ` +
      `score=${opts.score.toFixed(3)} (Q:${b.quality.toFixed(2)} C:${b.cost.toFixed(2)} ` +
      `L:${b.latency.toFixed(2)} S:${b.styleMatch.toFixed(2)}) cost=${opts.creditCost}cr`
    );
  }

  modelSelectSkipped(stepId: string, reason: string) {
    console.log(`${this.prefix("MODEL")} ${stepId}: skip (${reason})`);
  }

  modelSelectError(stepId: string, err: string) {
    console.warn(`${this.prefix("MODEL")} ${stepId}: ⚠ selection failed — ${err}`);
  }

  modelSelectSummary(totalCredits: number) {
    console.log(`${this.prefix("MODEL")} ✅ Final plan cost after selection: ${totalCredits}cr`);
  }

  // ── Budget guard ───────────────────────────────────────────────────────────

  budgetCheck(planCost: number, userCredits: number) {
    console.log(
      `${this.prefix("BUDGET")} planCost=${planCost}cr userCredits=${userCredits === Infinity ? "unlimited" : userCredits + "cr"}`
    );
  }

  budgetOk(cost: number) {
    console.log(`${this.prefix("BUDGET")} ✅ Affordable: ${cost}cr`);
  }

  budgetDowngraded(originalCost: number, finalCost: number, changes: string[]) {
    console.log(
      `${this.prefix("BUDGET")} ⬇  Downgraded: ${originalCost}cr → ${finalCost}cr  changes=[${changes.join(", ")}]`
    );
  }

  budgetRejected(planCost: number, userCredits: number) {
    console.warn(
      `${this.prefix("BUDGET")} ❌ NOT_AFFORDABLE: need=${planCost}cr have=${userCredits}cr`
    );
  }

  // ── Asset reuse ────────────────────────────────────────────────────────────

  reuseCheck(librarySize: number) {
    console.log(`${this.prefix("REUSE")} Checking library: ${librarySize} assets`);
  }

  reuseInjected(count: number) {
    if (count > 0) {
      console.log(`${this.prefix("REUSE")} ♻  Reusing ${count} existing assets`);
    }
  }

  // ── Step execution ─────────────────────────────────────────────────────────

  execStart(stepId: string, service: string, endpoint: string, order: number) {
    console.log(
      `${this.prefix("EXEC")} ▶ step[${order}] ${stepId} (${service}) → ${endpoint} ${this.elapsed()}`
    );
  }

  execDone(stepId: string, service: string, durationMs: number) {
    console.log(
      `${this.prefix("EXEC")} ✅ ${stepId} (${service}) done in ${(durationMs / 1000).toFixed(1)}s ${this.elapsed()}`
    );
  }

  execFailed(stepId: string, service: string, err: string, critical: boolean) {
    const prefix = critical ? "❌" : "⚠";
    console.error(
      `${this.prefix("EXEC")} ${prefix} ${stepId} (${service}) failed [critical=${critical}]: ${err} ${this.elapsed()}`
    );
  }

  // ── Quality evaluation ─────────────────────────────────────────────────────

  qualityScore(stepId: string, score: number, evaluator: string, notes: string) {
    console.log(
      `${this.prefix("QUALITY")} ${stepId}: score=${score.toFixed(2)} evaluator=${evaluator} notes="${notes}"`
    );
  }

  // ── Asset store ────────────────────────────────────────────────────────────

  storeAsset(stepId: string, assetType: string, url: string) {
    console.log(`${this.prefix("STORE")} ${stepId} → ${assetType}: ${url.slice(0, 80)}`);
  }

  storeError(stepId: string, err: string) {
    console.warn(`${this.prefix("STORE")} ⚠ ${stepId}: store failed (non-fatal) — ${err}`);
  }

  // ── Completion ─────────────────────────────────────────────────────────────

  done(opts: { success: number; total: number; reuseCount: number }) {
    console.log(
      `${this.prefix("DONE")} 🎉 success=${opts.success}/${opts.total} reused=${opts.reuseCount} ${this.elapsed()}`
    );
  }

  failed(err: string) {
    console.error(
      `${this.prefix("ERROR")} 💥 Job crashed: ${err} ${this.elapsed()}`
    );
  }
}

// ── Standalone (non-job) logger for planning-only calls ─────────────────────

export class PlanLogger {
  private readonly reqId: string;

  constructor(reqId: string = Math.random().toString(36).slice(2, 8)) {
    this.reqId = reqId;
  }

  private p() { return `[PLAN:${this.reqId}]`; }

  start(prompt: string, priority: string, model?: string) {
    const meta = safePromptMeta(prompt, model);
    console.log(`${this.p()} ▶ ${formatSafePromptLog(meta)} priority=${priority}`);
  }

  stepModel(stepIdx: number, stepId: string, model: string, provider: string, cost: number, score: number) {
    console.log(`${this.p()} step[${stepIdx}] ${stepId} → ${provider}/${model} cost=${cost}cr score=${score}`);
  }

  done(taskType: string, totalCredits: number, steps: number, generatedBy: string) {
    console.log(`${this.p()} ✅ ${taskType} | ${steps} steps | ${totalCredits}cr | via ${generatedBy}`);
  }

  error(err: string) {
    console.error(`${this.p()} ❌ Failed: ${err}`);
  }
}
