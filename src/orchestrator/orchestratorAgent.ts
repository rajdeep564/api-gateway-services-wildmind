/**
 * WildMind AI Orchestrator Agent — v4 (Elite Architecture + Model Selection Engine)
 *
 * Full pipeline integrating all modules:
 *
 *   1. PLANNING       → agentPlanner generates ExecutionPlan (LLM, 4-layer fallback)
 *   2. MODEL SELECT   → ModelSelectionEngine scores all providers on 5 dimensions
 *                       and picks the optimal model per step and priority mode
 *   3. BUDGET GUARD   → enforceBudget enforces user credit limit, downgrades plan
 *   4. ASSET REUSE    → assetLibrary injects existing user assets (skip re-generation)
 *   5. GENERATING     → workflowEngine.executePlan() runs all steps
 *   6. QUALITY EVAL   → evaluateOutput scores each result, retries if below threshold
 *   7. ASSET STORE    → successful outputs stored in user's asset library
 *
 * Status transitions updated in Redis at each stage for real-time polling.
 */

import { generateExecutionPlan } from "./planner/agentPlanner";
import {
  modelSelectionEngine,
  type SelectionPriority,
} from "./planner/modelSelectionEngine";
import { enforceBudget } from "./planner/budgetGuard";
import {
  getUserAssetLibrary,
  injectReuseableAssets,
  storeAsset,
  extractAssetUrl,
} from "./planner/assetLibrary";
import { evaluateOutput } from "./planner/qualityEvaluator";
import { WorkflowEngine } from "./workflowEngine";
import { updateJobStatus } from "./jobStatusStore";
import { OrchestratorLogger } from "./orchestratorLogger";
import { logGenerationUsage } from "../modelGateway/generationUsageLogs";
import type {
  OrchestratorJobPayload,
  OrchestratorPlan,
} from "./types/orchestratorTypes";
import type { ExecutionPlan, PlanStep } from "./planner/plannerTypes";

// Feature flags (env-driven so you can toggle without deploys)
const ENABLE_MODEL_SELECTION = process.env.ENABLE_MODEL_SELECTION !== "false";
const ENABLE_BUDGET_GUARD = process.env.ENABLE_BUDGET_GUARD !== "false";
const ENABLE_ASSET_REUSE = process.env.ENABLE_ASSET_REUSE === "true"; // opt-in
const ENABLE_QUALITY_EVAL = process.env.ENABLE_QUALITY_EVAL === "true"; // opt-in

export class OrchestratorAgent {
  private engine = new WorkflowEngine();

  async execute(payload: OrchestratorJobPayload): Promise<void> {
    const { jobId, userId, prompt, token, hints } = payload;
    const log = new OrchestratorLogger(jobId);
    const jobStart = Date.now();

    log.init(userId, prompt, hints as any);

    try {
      // ── Stage 1: AI Planner ───────────────────────────────────────────────
      await updateJobStatus(jobId, { status: "classifying" });
      log.planStart();
      const planStart = Date.now();

      let plan: ExecutionPlan = await generateExecutionPlan({
        prompt,
        hints: hints as any,
      });

      log.planDone({
        taskType: plan.taskType,
        complexity: plan.complexity,
        style: plan.style,
        steps: plan.steps.length,
        credits: plan.totalEstimatedCredits,
        generatedBy: plan.generatedBy,
        durationMs: Date.now() - planStart,
      });
      log.planSteps(
        plan.steps.map((s) => ({ stepId: s.stepId, service: s.service, creditCost: s.creditCost, order: s.order }))
      );

      // ── Stage 2: Model Selection Engine (v2) ─────────────────────────────────
      if (ENABLE_MODEL_SELECTION) {
        // If caller provided a pre-built plan (assistant flow) and explicitly requested to
        // preserve its models, do not mutate steps via model selection.
        if ((hints as any)?.skipModelSelection && (hints as any)?.preBuiltPlan) {
          log.modelSelectSummary(plan.totalEstimatedCredits);
        } else {
        const priority: SelectionPriority = (hints as any)?.priority ?? "balanced";
        const userCredits: number | undefined =
          typeof (hints as any)?.userCredits === "number" ? (hints as any).userCredits : undefined;
        const UTILITY_SERVICES = ["script_gen", "scene_breakdown"];

        plan.steps = plan.steps.map((step) => {
          if (UTILITY_SERVICES.includes(step.service)) {
            log.modelSelectSkipped(step.stepId, "utility service");
            return step;
          }

          // If the step already pins a specific model, keep it (do not override).
          // This protects static fallback plans and any deterministic pre-built plans.
          if ((step as any)?.params?.model) {
            log.modelSelectSkipped(step.stepId, "pinned model");
            return step;
          }

          const prevService = step.service;
          const result = modelSelectionEngine.applyToStep(step, {
            taskType: plan.taskType,
            style: plan.style,
            complexity: plan.complexity,
            priority,
            creditLimit: userCredits,
            durationSeconds: plan.contentDurationSeconds ?? undefined,
          });

          if (result.applied && result.selection) {
            const { profile, score, breakdown } = result.selection;
            log.modelSelectApplied({
              stepId: step.stepId,
              from: prevService,
              to: profile.modelId,
              provider: profile.provider,
              score,
              creditCost: profile.creditCost,
              breakdown,
            });
          } else {
            log.modelSelectSkipped(step.stepId, result.reason ?? "already optimal");
          }
          return step;
        });

        plan.totalEstimatedCredits = plan.steps.reduce((s, step) => s + step.creditCost, 0);
        log.modelSelectSummary(plan.totalEstimatedCredits);
        }
      }

      // ── Stage 3: Budget Guard ──────────────────────────────────────────────
      let userCredits = Infinity;

      if (ENABLE_BUDGET_GUARD && hints && typeof (hints as any).userCredits === "number") {
        userCredits = (hints as any).userCredits;
        log.budgetCheck(plan.totalEstimatedCredits, userCredits);

        const budgetResult = enforceBudget(plan, userCredits);

        if (budgetResult.status === "NOT_AFFORDABLE") {
          log.budgetRejected(budgetResult.finalCost, userCredits);
          await updateJobStatus(jobId, {
            status: "failed",
            error: `Insufficient credits. This plan requires at least ${budgetResult.finalCost} credits. You have ${userCredits}.`,
          });
          return;
        }

        if (budgetResult.status === "DOWNGRADED") {
          log.budgetDowngraded(budgetResult.originalCost, budgetResult.finalCost, budgetResult.changes ?? []);
          plan = budgetResult.plan;
        } else {
          log.budgetOk(plan.totalEstimatedCredits);
        }
      }

      // ── Stage 4: Asset Reuse ──────────────────────────────────────────────
      let reuseCount = 0;
      if (ENABLE_ASSET_REUSE) {
        const library = await getUserAssetLibrary(userId);
        log.reuseCheck(library.assets.length);
        if (library.assets.length > 0) {
          const { steps: injectedSteps, reuseCount: count } =
            await injectReuseableAssets(plan.steps, library, plan.style);
          plan.steps = injectedSteps;
          reuseCount = count;
          log.reuseInjected(reuseCount);
        }
      }

      // ── Stage 5: Workflow Execution ───────────────────────────────────────
      await updateJobStatus(jobId, {
        status: "generating",
        plan: this._planToOrchestratorPlan(plan, userId, hints),
      });

      const stepResults = await this.engine.executePlan(
        plan.steps,
        userId,
        token,
      );

      // Log generation usage per completed step (Model Gateway / cost tracking)
      for (const result of stepResults) {
        if (result.status !== "done") continue;
        const step = plan.steps.find((s) => s.stepId === result.step);
        if (!step) continue;
        logGenerationUsage({
          userId,
          requestId: jobId,
          provider: step.service,
          model: (step.params?.model as string) ?? step.service,
          credits: step.creditCost,
          stepId: step.stepId,
        });
      }

      // ── Stage 6: Quality Evaluation (optional) ────────────────────────────
      const qualityResults: Record<string, any> = {};

      if (ENABLE_QUALITY_EVAL) {
        for (const result of stepResults) {
          if (result.status !== "done" || !result.output) continue;
          const step = plan.steps.find((s) => s.stepId === result.step);
          if (!step) continue;

          const score = await evaluateOutput(
            result.output,
            step.service,
            step.prompt,
          );
          qualityResults[result.step] = {
            score: score.score,
            evaluator: score.evaluator,
            notes: score.notes,
          };

          console.log(
            `[OrchestratorAgent] Quality[${result.step}]: ${score.score.toFixed(2)} via ${score.evaluator}`,
          );
        }
      }

      // ── Stage 7: Store Generated Assets in Library ────────────────────────
      if (ENABLE_ASSET_REUSE) {
        for (const result of stepResults) {
          if (result.status !== "done" || !result.output) continue;
          const step = plan.steps.find((s) => s.stepId === result.step);
          if (!step) continue;

          const url = extractAssetUrl(result.output, step.service);
          if (!url) continue;

          const assetType = step.service.includes("music")
            ? "music"
            : step.service.includes("voice") || step.service.includes("tts")
              ? "voice"
              : step.service.includes("video")
                ? "video"
                : "image";

          await storeAsset(userId, {
            assetType,
            url,
            prompt: step.prompt,
            tags: [plan.style, plan.tone, plan.taskType].filter(Boolean),
            style: plan.style,
            tone: plan.tone,
            generatedBy: step.service,
            jobId,
          }).catch((err) =>
            console.warn(
              "[OrchestratorAgent] Asset store failed (non-fatal):",
              err?.message,
            ),
          );
        }
      }

      // ── Stage 8: Finalize ─────────────────────────────────────────────────
      const successSteps = stepResults.filter((s) => s.status === "done");
      const failedSteps  = stepResults.filter((s) => s.status === "failed");
      const allFailed    = failedSteps.length === stepResults.length;

      log.done({ success: successSteps.length, total: stepResults.length, reuseCount });

      if (allFailed) {
        await updateJobStatus(jobId, {
          status: "failed",
          steps: stepResults,
          error: failedSteps[0]?.error ?? "All generation steps failed",
        });
      } else {
        const result = {
          ...Object.fromEntries(successSteps.map((s) => [s.step, s.output])),
          _meta: {
            taskType: plan.taskType,
            summary: plan.summary,
            totalMs: Date.now() - jobStart,
            reuseCount,
            quality: ENABLE_QUALITY_EVAL ? qualityResults : "disabled",
            generatedBy: plan.generatedBy,
          },
        };
        await updateJobStatus(jobId, { status: "completed", steps: stepResults, result });
      }
    } catch (err: any) {
      const errorMsg = err?.message ?? "Orchestration failed unexpectedly";
      log.failed(errorMsg);
      await updateJobStatus(jobId, { status: "failed", error: errorMsg }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Adapter
  // ---------------------------------------------------------------------------

  private _planToOrchestratorPlan(
    plan: ExecutionPlan,
    userId: string,
    hints?: OrchestratorJobPayload["hints"],
  ): OrchestratorPlan {
    return {
      taskType: plan.taskType as any,
      category: plan.taskType.includes("ad")
        ? "advertisement"
        : (plan.taskType as any),
      assetsNeeded: plan.steps.map((s) => s.service),
      style: plan.style,
      tone: plan.tone,
      complexity: plan.complexity,
      enhancedPrompt: plan.enhancedPrompt,
      originalPrompt: plan.originalPrompt,
      routingTargets: plan.steps.map((s) => s.stepId),
      estimatedCredits: plan.totalEstimatedCredits,
      metadata: {
        generatedBy: plan.generatedBy,
        summary: plan.summary,
        reasoning: plan.reasoning,
        hints: hints ?? null,
        features: {
          modelSelection: ENABLE_MODEL_SELECTION,
          budgetGuard: ENABLE_BUDGET_GUARD,
          assetReuse: ENABLE_ASSET_REUSE,
          qualityEval: ENABLE_QUALITY_EVAL,
        },
      },
    };
  }
}
