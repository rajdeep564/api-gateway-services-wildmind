/**
 * WildMind — Plan Store
 *
 * In-memory store for execution plans that are awaiting user approval.
 * Plans expire after PLAN_TTL_MS (10 minutes).
 *
 * Flow:
 *   previewPlan() → savePlan()    → status: "awaiting_approval"
 *   approvePlan() → markApproved() → status: "approved" → enqueue BullMQ
 */

import { randomBytes } from "crypto";
import type { ExecutionPlan } from "../orchestrator/planner/plannerTypes";
import { getModelById } from "./planner/assistantModelRegistry";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlanStatus =
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "completed"
  | "failed";

export interface PlanEntry {
  planId: string;
  status: PlanStatus;
  userId: string;
  executionPlan: ExecutionPlan;
  /** Per-step model overrides supplied by the user in the plan review UI */
  modelOverrides: Record<string, string>;
  createdAt: number;
}

// ── Configuration ─────────────────────────────────────────────────────────────

const PLAN_TTL_MS     = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL = 3 * 60 * 1000;  // clean every 3 minutes

// ── Store ─────────────────────────────────────────────────────────────────────

const _plans = new Map<string, PlanEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of _plans.entries()) {
    if (now - entry.createdAt > PLAN_TTL_MS) {
      _plans.delete(id);
      console.log(`[PlanStore] Plan expired and removed: ${id}`);
    }
  }
}, CLEANUP_INTERVAL);

// ── Public API ────────────────────────────────────────────────────────────────

/** Save a plan that is awaiting user approval. Returns the new planId. */
export function savePlan(
  userId: string,
  executionPlan: ExecutionPlan,
  modelOverrides: Record<string, string> = {},
): string {
  const planId = `plan_${randomBytes(8).toString("hex")}`;
  const entry: PlanEntry = {
    planId,
    status: "awaiting_approval",
    userId,
    executionPlan,
    modelOverrides,
    createdAt: Date.now(),
  };
  _plans.set(planId, entry);
  console.log(
    `[PlanStore] Saved plan ${planId} — user=${userId} steps=${executionPlan.steps.length} credits=${executionPlan.totalEstimatedCredits}`,
  );
  return planId;
}

/** Get a plan by ID. Returns null if not found or expired. */
export function getPlan(planId: string): PlanEntry | null {
  const entry = _plans.get(planId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > PLAN_TTL_MS) {
    _plans.delete(planId);
    return null;
  }
  return entry;
}

/** Apply model overrides to a plan (user changed a model before approving) */
export function applyModelOverrides(
  planId: string,
  overrides: Record<string, string>,
): PlanEntry | null {
  const entry = getPlan(planId);
  if (!entry) return null;
  entry.modelOverrides = { ...entry.modelOverrides, ...overrides };

  // Also apply overrides onto the stored execution plan so execution uses the chosen model.
  // Overrides map: stepId -> AssistantModel.id (user-facing model id)
  try {
    for (const [stepId, modelId] of Object.entries(overrides || {})) {
      const step: any = entry.executionPlan.steps.find((s: any) => s.stepId === stepId);
      if (!step) continue;
      const m = getModelById(String(modelId));
      if (!m) continue;
      step.service = m.service;
      step.endpoint = m.endpoint;
      step.creditCost = m.creditCost;
      step.params = { ...(step.params || {}), model: m.modelParam };
      step.selectedModel = {
        modelId: m.id,
        label: m.label,
        provider: m.provider,
        creditCost: m.creditCost,
      };
    }
    // Keep total cost in sync
    entry.executionPlan.totalEstimatedCredits = entry.executionPlan.steps.reduce(
      (sum: number, s: any) => sum + (Number(s.creditCost) || 0),
      0,
    );
  } catch {
    // non-fatal; leave overrides stored even if plan mutation fails
  }
  return entry;
}

/** Transition a plan to approved status */
export function markApproved(planId: string): PlanEntry | null {
  const entry = getPlan(planId);
  if (!entry) return null;
  entry.status = "approved";
  return entry;
}

/** Transition a plan to executing status */
export function markExecuting(planId: string): void {
  const entry = getPlan(planId);
  if (entry) entry.status = "executing";
}

/** Remove a plan (after job is created or cancelled) */
export function deletePlan(planId: string): void {
  _plans.delete(planId);
}

/** Active plan count (monitoring) */
export function getActivePlanCount(): number {
  return _plans.size;
}
