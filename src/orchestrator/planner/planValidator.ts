/**
 * WildMind AI Planner — Plan Validator
 *
 * Validates an ExecutionPlan returned by the LLM and repairs common issues.
 * Because even structured LLM outputs can have subtle problems, we always
 * validate before handing the plan to the WorkflowEngine.
 *
 * Validation checks:
 *   1. Required top-level fields present
 *   2. At least one step exists
 *   3. All step IDs are unique
 *   4. dependsOn references exist and have lower order numbers
 *   5. Order numbers are positive integers
 *   6. Credit costs are non-negative integers
 *   7. totalEstimatedCredits matches sum of steps (auto-repaired)
 *   8. schemaVersion is "1.0"
 *
 * Repair logic (applied automatically):
 *   - Recalculate totalEstimatedCredits from steps
 *   - Default missing critical to true
 *   - Default missing params to {}
 *   - Default missing estimatedDurationSeconds to 30
 *   - Clamp invalid complexity to "medium"
 *   - Clamp invalid taskType to "image"
 */

import type {
  ExecutionPlan,
  PlanStep,
  PlanValidationResult,
  PlanTaskType,
  PlanComplexity,
} from "./plannerTypes";

const VALID_TASK_TYPES: PlanTaskType[] = [
  "image",
  "video",
  "music",
  "voice",
  "video_ad",
  "image_ad",
  "multimodal",
];
const VALID_COMPLEXITY: PlanComplexity[] = ["low", "medium", "high"];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate and repair an ExecutionPlan from the LLM.
 * Always returns a PlanValidationResult — never throws.
 */
export function validateAndRepairPlan(raw: any): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ─── null / non-object guard ─────────────────────────────────────────────
  if (!raw || typeof raw !== "object") {
    return {
      valid: false,
      errors: ["Plan is null or not an object"],
      warnings: [],
    };
  }

  // Deep clone to avoid mutating the original
  const plan: ExecutionPlan = JSON.parse(JSON.stringify(raw));

  // ─── Required top-level fields ───────────────────────────────────────────
  const REQUIRED_FIELDS = [
    "taskType",
    "summary",
    "reasoning",
    "style",
    "tone",
    "complexity",
    "enhancedPrompt",
    "originalPrompt",
    "steps",
  ];

  for (const field of REQUIRED_FIELDS) {
    if (!(field in plan) || plan[field as keyof ExecutionPlan] === undefined) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // ─── taskType ────────────────────────────────────────────────────────────
  if (!VALID_TASK_TYPES.includes(plan.taskType)) {
    warnings.push(
      `Invalid taskType "${plan.taskType}" — defaulting to "image"`,
    );
    plan.taskType = "image";
  }

  // ─── complexity ──────────────────────────────────────────────────────────
  if (!VALID_COMPLEXITY.includes(plan.complexity)) {
    warnings.push(
      `Invalid complexity "${plan.complexity}" — defaulting to "medium"`,
    );
    plan.complexity = "medium";
  }

  // ─── schemaVersion ───────────────────────────────────────────────────────
  if (plan.schemaVersion !== "1.0") {
    warnings.push(
      `schemaVersion "${plan.schemaVersion}" unexpected — setting to "1.0"`,
    );
    plan.schemaVersion = "1.0";
  }

  // ─── Steps array ─────────────────────────────────────────────────────────
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push("Plan must contain at least one step");
    return { valid: false, errors, warnings };
  }

  // ─── Per-step validation + repair ────────────────────────────────────────
  const stepIds = new Set<string>();
  let recalculatedCredits = 0;
  let maxChainDuration = 0; // rough estimate for sequential chains

  // Track which stepIds exist (for dependsOn validation)
  const existingIds = new Set(plan.steps.map((s) => s.stepId));

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const prefix = `Step[${i}] "${step.stepId ?? i}"`;

    // stepId
    if (!step.stepId || typeof step.stepId !== "string") {
      step.stepId = `step_${i + 1}`;
      warnings.push(`${prefix}: Missing stepId — assigned "${step.stepId}"`);
    }
    if (stepIds.has(step.stepId)) {
      const uniqueId = `${step.stepId}_${i}`;
      warnings.push(
        `${prefix}: Duplicate stepId "${step.stepId}" — renamed to "${uniqueId}"`,
      );
      step.stepId = uniqueId;
    }
    stepIds.add(step.stepId);

    // label
    if (!step.label) {
      step.label = step.stepId.replace(/_/g, " ");
      warnings.push(`${prefix}: Missing label — defaulted to "${step.label}"`);
    }

    // order
    if (
      typeof step.order !== "number" ||
      step.order < 1 ||
      !Number.isInteger(step.order)
    ) {
      warnings.push(
        `${prefix}: Invalid order ${step.order} — defaulting to ${i + 1}`,
      );
      step.order = i + 1;
    }

    // dependsOn cross-reference
    if (step.dependsOn !== undefined) {
      if (!existingIds.has(step.dependsOn)) {
        errors.push(
          `${prefix}: dependsOn "${step.dependsOn}" does not exist in plan`,
        );
      } else {
        // Find the depended-on step and check it has a lower order
        const dep = plan.steps.find((s) => s.stepId === step.dependsOn);
        if (dep && dep.order >= step.order) {
          errors.push(
            `${prefix}: dependsOn "${step.dependsOn}" has order=${dep.order} >= this step's order=${step.order} — creates invalid dependency`,
          );
        }
      }
    }

    // prompt
    if (!step.prompt || typeof step.prompt !== "string") {
      step.prompt = plan.enhancedPrompt;
      warnings.push(
        `${prefix}: Missing prompt — using top-level enhancedPrompt`,
      );
    }

    // params
    if (!step.params || typeof step.params !== "object") {
      step.params = {};
      warnings.push(`${prefix}: Missing params — defaulted to {}`);
    }

    // creditCost
    if (typeof step.creditCost !== "number" || step.creditCost < 0) {
      step.creditCost = 100;
      warnings.push(`${prefix}: Invalid creditCost — defaulted to 100`);
    }
    recalculatedCredits += step.creditCost;

    // estimatedDurationSeconds
    if (
      typeof step.estimatedDurationSeconds !== "number" ||
      step.estimatedDurationSeconds < 1
    ) {
      step.estimatedDurationSeconds = 30;
      warnings.push(
        `${prefix}: Invalid estimatedDurationSeconds — defaulted to 30`,
      );
    }
    maxChainDuration = Math.max(
      maxChainDuration,
      step.estimatedDurationSeconds,
    );

    // critical
    if (typeof step.critical !== "boolean") {
      step.critical = true;
      warnings.push(`${prefix}: Missing critical flag — defaulted to true`);
    }

    // service + endpoint
    if (!step.service) errors.push(`${prefix}: Missing "service"`);
    if (!step.endpoint) errors.push(`${prefix}: Missing "endpoint"`);
  }

  // ─── Auto-repair totalEstimatedCredits ───────────────────────────────────
  if (plan.totalEstimatedCredits !== recalculatedCredits) {
    warnings.push(
      `totalEstimatedCredits was ${plan.totalEstimatedCredits} but steps sum to ${recalculatedCredits} — correcting`,
    );
    plan.totalEstimatedCredits = recalculatedCredits;
  }

  // ─── Auto-repair totalEstimatedDurationSeconds ───────────────────────────
  if (
    !plan.totalEstimatedDurationSeconds ||
    plan.totalEstimatedDurationSeconds < 1
  ) {
    plan.totalEstimatedDurationSeconds = maxChainDuration;
    warnings.push(
      `totalEstimatedDurationSeconds defaulted to ${maxChainDuration}`,
    );
  }

  // ─── enhancedPrompt length guard ─────────────────────────────────────────
  if (plan.enhancedPrompt && plan.enhancedPrompt.length > 3000) {
    plan.enhancedPrompt = plan.enhancedPrompt.slice(0, 3000);
    warnings.push("enhancedPrompt truncated to 3000 characters");
  }

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    repairedPlan: valid || warnings.length > 0 ? plan : undefined,
  };
}
