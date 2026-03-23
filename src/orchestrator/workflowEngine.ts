/**
 * WildMind AI Orchestrator — Workflow Engine
 *
 * TWO execution modes:
 *
 * Mode A — execute(plan, routeDecision, ...) [legacy / ROUTING_MAP based]
 *   Uses RouteDecision from TaskRouter. Plan provides top-level prompt.
 *
 * Mode B — executePlan(steps, ...) [AI Planner based]
 *   Accepts PlanStep[] directly from agentPlanner.generateExecutionPlan().
 *   Each step carries its own prompt, params, endpoint, and credit cost.
 *   Steps with the same `order` run IN PARALLEL.
 *   Steps with different `order` run SEQUENTIALLY (ascending).
 *   Steps with `dependsOn` receive prior step output as `context`.
 *
 * Fault-tolerance (both modes):
 *   - A failed step is recorded but does NOT abort subsequent steps
 *   - All results returned regardless of success/failure
 */

import axios from "axios";
import type {
  RouteDecision,
  RouteService,
  OrchestratorPlan,
  OrchestratorStepResult,
} from "./types/orchestratorTypes";
import type { PlanStep } from "./planner/plannerTypes";

// ---------------------------------------------------------------------------
// Internal HTTP helpers
// ---------------------------------------------------------------------------

const INTERNAL_BASE_URL =
  process.env.INTERNAL_API_BASE_URL ||
  `http://localhost:${process.env.PORT || 5000}`;

/** Build and fire an internal generation service request. */
async function callInternalService(
  endpoint: string,
  body: Record<string, any>,
  userId: string,
  token: string,
): Promise<any> {
  const response = await axios.post(`${INTERNAL_BASE_URL}${endpoint}`, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-user-id": userId,
      "x-orchestrator": "true",
      "Content-Type": "application/json",
    },
    timeout: 360_000, // 6 minutes — generation can be slow
  });
  return response.data;
}

// ---------------------------------------------------------------------------
// Order grouping helper (shared by both modes)
// ---------------------------------------------------------------------------

function groupByOrder<T extends { order: number }>(
  items: T[],
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const group = map.get(item.order) ?? [];
    group.push(item);
    map.set(item.order, group);
  }
  return new Map([...map.entries()].sort(([a], [b]) => a - b));
}

// ---------------------------------------------------------------------------
// Public WorkflowEngine
// ---------------------------------------------------------------------------

export class WorkflowEngine {
  // ─── Mode A: Legacy ROUTING_MAP-based execution ───────────────────────────

  /**
   * Execute all services defined in `routeDecision` for the given plan.
   * Used when the orchestrator runs without the AI Planner (e.g. direct task routing).
   *
   * @param plan          - Fully resolved orchestrator plan (with enhanced prompt)
   * @param routeDecision - Routing decision from TaskRouter
   * @param userId        - Authenticated user ID
   * @param token         - Bearer token for internal service calls
   * @returns             - Array of step results
   */
  async execute(
    plan: OrchestratorPlan,
    routeDecision: RouteDecision,
    userId: string,
    token: string,
  ): Promise<OrchestratorStepResult[]> {
    const allResults: OrchestratorStepResult[] = [];
    const stepOutputs = new Map<string, any>(); // step.name → output

    const orderGroups = groupByOrder<RouteService>(routeDecision.services);

    for (const [order, services] of orderGroups) {
      console.log(
        `[WorkflowEngine] order=${order} — parallel steps: [${services.map((s) => s.name).join(", ")}]`,
      );

      const settled = await Promise.allSettled(
        services.map(async (service): Promise<OrchestratorStepResult> => {
          const startedAt = Date.now();

          const context = service.dependsOn
            ? (stepOutputs.get(service.dependsOn) ?? null)
            : null;

          if (service.dependsOn && !stepOutputs.has(service.dependsOn)) {
            console.warn(
              `[WorkflowEngine] Step "${service.name}" depends on "${service.dependsOn}" but no output — proceeding without context`,
            );
          }

          const prompt = service.promptOverride ?? plan.enhancedPrompt;
          const body: Record<string, any> = {
            prompt,
            ...(service.extraParams ?? {}),
            meta: {
              source: "orchestrator",
              taskType: plan.taskType,
              style: plan.style,
              tone: plan.tone,
            },
          };

          if (context !== null) {
            body.context = context;
            if (typeof context === "object" && context.script)
              body.text = context.script;
          }

          if (
            service.name === "minimax_music" &&
            (service.extraParams as any)?.mood === "from_plan"
          ) {
            body.mood = plan.tone;
            delete body.meta;
          }

          try {
            console.log(`[WorkflowEngine] → ${service.name}`);
            const output = await callInternalService(
              service.endpoint,
              body,
              userId,
              token,
            );
            const finishedAt = Date.now();

            console.log(
              `[WorkflowEngine] ✅ "${service.name}" done in ${finishedAt - startedAt}ms`,
            );

            return {
              step: service.name,
              status: "done",
              output,
              durationMs: finishedAt - startedAt,
              startedAt,
              finishedAt,
            };
          } catch (err: any) {
            const finishedAt = Date.now();
            const errorMsg =
              err?.response?.data?.error ?? err?.message ?? "Unknown error";
            console.error(
              `[WorkflowEngine] ❌ "${service.name}" failed:`,
              errorMsg,
            );
            return {
              step: service.name,
              status: "failed",
              error: errorMsg,
              durationMs: finishedAt - startedAt,
              startedAt,
              finishedAt,
            };
          }
        }),
      );

      for (const result of settled) {
        const stepResult: OrchestratorStepResult =
          result.status === "fulfilled"
            ? result.value
            : {
                step: "unknown",
                status: "failed",
                error: "Promise rejected unexpectedly",
              };

        allResults.push(stepResult);

        if (stepResult.status === "done" && stepResult.output !== undefined) {
          stepOutputs.set(stepResult.step, stepResult.output);
        }
      }
    }

    return allResults;
  }

  // ─── Mode B: AI Planner-based execution ───────────────────────────────────

  /**
   * Execute an AI-generated plan's steps directly.
   *
   * Unlike execute(), each PlanStep carries its own prompt, params, endpoint,
   * and credit cost — the engine does not look up any global plan context.
   *
   * Steps with the same `order` run in PARALLEL.
   * Steps with different `order` run SEQUENTIALLY (ascending).
   * Steps with `dependsOn` receive prior step output as `context`.
   *
   * @param steps  - PlanStep[] from ExecutionPlan.steps
   * @param userId - Authenticated user ID
   * @param token  - Bearer token for internal service calls
   * @returns      - Array of step results keyed by stepId
   */
  async executePlan(
    steps: PlanStep[],
    userId: string,
    token: string,
  ): Promise<OrchestratorStepResult[]> {
    const allResults: OrchestratorStepResult[] = [];
    const stepOutputs = new Map<string, any>(); // stepId → output

    const orderGroups = groupByOrder<PlanStep>(steps);

    for (const [order, orderSteps] of orderGroups) {
      console.log(
        `[WorkflowEngine.executePlan] order=${order} — [${orderSteps.map((s) => s.label).join(" | ")}]`,
      );

      const settled = await Promise.allSettled(
        orderSteps.map(async (step): Promise<OrchestratorStepResult> => {
          const startedAt = Date.now();

          const context = step.dependsOn
            ? (stepOutputs.get(step.dependsOn) ?? null)
            : null;

          if (step.dependsOn && !stepOutputs.has(step.dependsOn)) {
            console.warn(
              `[WorkflowEngine.executePlan] "${step.stepId}" depends on "${step.dependsOn}" but no output — proceeding without context`,
            );
          }

          // IMPORTANT: Always respect step.params.model if present.
          // If missing, set a safe default per service so internal validators don't 400.
          const resolvedParams: Record<string, any> = { ...(step.params ?? {}) };
          if (!resolvedParams.model) {
            if (step.service === "fal_image" || step.service === "fal_image_pro") {
              resolvedParams.model = "google/nano-banana-pro";
            } else if (step.service === "replicate_image") {
              resolvedParams.model = "openai/gpt-image-1.5";
            } else if (step.service === "fal_video") {
              resolvedParams.model = "fal-ai/veo3";
            } else if (step.service === "replicate_video") {
              resolvedParams.model = "wan-video/wan-2.5-t2v";
            } else if (step.service === "minimax_music") {
              resolvedParams.model = "music-2.0";
            }
          }

          const body: Record<string, any> = {
            prompt: step.prompt,
            ...resolvedParams,
            meta: { source: "orchestrator-planner", stepId: step.stepId },
          };

          if (context !== null) {
            body.context = context;
            if (typeof context === "object" && context.script)
              body.text = context.script;
          }

          try {
            console.log(
              `[WorkflowEngine.executePlan] → "${step.label}" (${step.service})`,
            );
            const output = await callInternalService(
              step.endpoint,
              body,
              userId,
              token,
            );
            const finishedAt = Date.now();

            console.log(
              `[WorkflowEngine.executePlan] ✅ "${step.label}" done in ${finishedAt - startedAt}ms`,
            );
            return {
              step: step.stepId,
              status: "done",
              output,
              durationMs: finishedAt - startedAt,
              startedAt,
              finishedAt,
            };
          } catch (err: any) {
            const finishedAt = Date.now();
            const errorMsg =
              err?.response?.data?.error ?? err?.message ?? "Unknown error";
            console.error(
              `[WorkflowEngine.executePlan] ❌ "${step.label}" failed in ${finishedAt - startedAt}ms:`,
              errorMsg,
            );
            return {
              step: step.stepId,
              status: "failed",
              error: errorMsg,
              durationMs: finishedAt - startedAt,
              startedAt,
              finishedAt,
            };
          }
        }),
      );

      for (const result of settled) {
        const stepResult: OrchestratorStepResult =
          result.status === "fulfilled"
            ? result.value
            : {
                step: "unknown",
                status: "failed",
                error: "Promise rejected unexpectedly",
              };

        allResults.push(stepResult);

        if (stepResult.status === "done" && stepResult.output !== undefined) {
          stepOutputs.set(stepResult.step, stepResult.output);
        }
      }
    }

    return allResults;
  }
}
