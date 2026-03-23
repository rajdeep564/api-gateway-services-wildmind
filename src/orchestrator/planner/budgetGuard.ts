/**
 * WildMind AI Planner — Budget Guard
 *
 * Enforces user credit limits BEFORE workflow execution.
 * If the plan costs more than the user's available credits, the guard
 * attempts to downgrade the plan so it fits within budget.
 *
 * Downgrade strategies (applied in order until plan fits):
 *
 *   1. Model downgrade    — swap premium models for cheaper equivalents
 *      (e.g. bfl_image → fal_image_pro → fal_image)
 *
 *   2. Step removal       — remove non-critical steps
 *      (e.g. drop background music from video_ad)
 *
 *   3. Task type fallback — downgrade entire task category
 *      (e.g. video_ad → image_ad, multimodal → video)
 *
 * If the plan cannot be made to fit, returns NOT_AFFORDABLE with the
 * minimum credits required so the client can inform the user.
 */

import type { ExecutionPlan, PlanStep, PlanTaskType } from "./plannerTypes";

// ---------------------------------------------------------------------------
// Budget Guard Result
// ---------------------------------------------------------------------------

export type BudgetGuardStatus =
  | "WITHIN_BUDGET"
  | "DOWNGRADED"
  | "NOT_AFFORDABLE";

export interface BudgetGuardResult {
  status: BudgetGuardStatus;
  plan: ExecutionPlan;
  /** Credits the user has */
  userCredits: number;
  /** Credits the original plan required */
  originalCost: number;
  /** Credits the final (possibly downgraded) plan requires */
  finalCost: number;
  /** Human-readable explanation of what was changed */
  changes: string[];
}

// ---------------------------------------------------------------------------
// Model downgrade chains
// cheaperAlternative[service] → next cheaper option
// ---------------------------------------------------------------------------

const MODEL_DOWNGRADE_CHAIN: Record<
  string,
  { service: string; endpoint: string; creditCost: number; params?: Record<string, any> } | null
> = {
  bfl_image: {
    service: "fal_image_pro",
    endpoint: "/api/fal/generate",
    params: { model: "fal-ai/flux-pro/v1.1" },
    creditCost: 200,
  },
  fal_image_pro: {
    service: "fal_image",
    endpoint: "/api/fal/generate",
    params: { model: "fal-ai/flux/dev" },
    creditCost: 100,
  },
  fal_image: null, // already minimum
  replicate_image: {
    service: "fal_image",
    endpoint: "/api/fal/generate",
    params: { model: "fal-ai/flux/dev" },
    creditCost: 100,
  },

  runway_video: {
    service: "fal_video",
    endpoint: "/api/fal/video",
    creditCost: 400,
  },
  fal_video: null, // already minimum video

  minimax_music: {
    service: "fal_music",
    endpoint: "/api/fal/music",
    creditCost: 180,
  },
  fal_music: null,

  fal_voice: {
    service: "replicate_voice",
    endpoint: "/api/replicate/tts",
    creditCost: 130,
  },
  replicate_voice: null,
};

// Task type fallback order (when model downgrades aren't enough)
const TASK_FALLBACK: Partial<Record<PlanTaskType, PlanTaskType>> = {
  video_ad: "image_ad",
  multimodal: "video",
  video: "image",
  image_ad: "image",
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function planCost(plan: ExecutionPlan): number {
  return plan.steps.reduce((sum, s) => sum + s.creditCost, 0);
}

/** Deep-clone a plan without circular reference issues */
function clonePlan(plan: ExecutionPlan): ExecutionPlan {
  return JSON.parse(JSON.stringify(plan));
}

// ---------------------------------------------------------------------------
// Strategy 1: Downgrade individual models within steps
// ---------------------------------------------------------------------------

function tryModelDowngrades(
  plan: ExecutionPlan,
  budget: number,
  changes: string[],
): ExecutionPlan {
  const result = clonePlan(plan);
  let cost = planCost(result);

  // Multiple passes — each pass tries to downgrade the most expensive step
  for (let pass = 0; pass < 5 && cost > budget; pass++) {
    // Find most expensive step that has a cheaper alternative
    const candidates = result.steps
      .filter(
        (s) =>
          MODEL_DOWNGRADE_CHAIN[s.service] !== undefined &&
          MODEL_DOWNGRADE_CHAIN[s.service] !== null,
      )
      .sort((a, b) => b.creditCost - a.creditCost);

    if (candidates.length === 0) break;

    const target = candidates[0];
    const cheaper = MODEL_DOWNGRADE_CHAIN[target.service]!;

    changes.push(
      `Downgraded "${target.label}": ${target.service}(${target.creditCost}cr) → ${cheaper.service}(${cheaper.creditCost}cr)`,
    );

    target.service = cheaper.service;
    target.endpoint = cheaper.endpoint;
    target.creditCost = cheaper.creditCost;
    if (cheaper.params) {
      target.params = { ...(target.params || {}), ...cheaper.params };
    }

    cost = planCost(result);
  }

  result.totalEstimatedCredits = cost;
  return result;
}

// ---------------------------------------------------------------------------
// Strategy 2: Remove non-critical steps
// ---------------------------------------------------------------------------

function tryStepRemoval(
  plan: ExecutionPlan,
  budget: number,
  changes: string[],
): ExecutionPlan {
  const result = clonePlan(plan);

  // Remove non-critical steps sorted by highest cost first
  const nonCritical = result.steps
    .filter((s) => !s.critical)
    .sort((a, b) => b.creditCost - a.creditCost);

  for (const step of nonCritical) {
    if (planCost(result) <= budget) break;

    result.steps = result.steps.filter((s) => s.stepId !== step.stepId);

    // Remove dependsOn references to removed step from remaining steps
    for (const remaining of result.steps) {
      if (remaining.dependsOn === step.stepId) {
        delete remaining.dependsOn;
      }
    }

    changes.push(
      `Removed non-critical step "${step.label}" (${step.creditCost}cr) — not essential`,
    );
  }

  result.totalEstimatedCredits = planCost(result);
  return result;
}

// ---------------------------------------------------------------------------
// Strategy 3: Task type fallback (simplify entire plan)
// ---------------------------------------------------------------------------

function buildFallbackPlan(
  original: ExecutionPlan,
  newTaskType: PlanTaskType,
  budget: number,
  changes: string[],
): ExecutionPlan | null {
  const FALLBACK_STEPS: Record<PlanTaskType, PlanStep[]> = {
    image: [
      {
        stepId: "fal_image",
        label: "Generate Image",
        service: "fal_image",
        endpoint: "/api/fal/generate",
        order: 1,
        prompt: original.enhancedPrompt,
        params: { model: "fal-ai/flux/dev" },
        creditCost: 100,
        estimatedDurationSeconds: 20,
        critical: true,
      },
    ],
    image_ad: [
      {
        stepId: "fal_image_pro",
        label: "Generate Ad Image",
        service: "fal_image_pro",
        endpoint: "/api/fal/generate",
        order: 1,
        prompt: original.enhancedPrompt,
        params: { model: "fal-ai/flux-pro/v1.1" },
        creditCost: 200,
        estimatedDurationSeconds: 25,
        critical: true,
      },
    ],
    video: [
      {
        stepId: "fal_video",
        label: "Generate Video",
        service: "fal_video",
        endpoint: "/api/fal/video",
        order: 1,
        prompt: original.enhancedPrompt,
        params: {},
        creditCost: 400,
        estimatedDurationSeconds: 50,
        critical: true,
      },
    ],
    music: [
      {
        stepId: "minimax_music",
        label: "Generate Music",
        service: "minimax_music",
        endpoint: "/api/minimax/music",
        order: 1,
        prompt: original.enhancedPrompt,
        params: {},
        creditCost: 200,
        estimatedDurationSeconds: 30,
        critical: true,
      },
    ],
    voice: [
      {
        stepId: "fal_voice",
        label: "Generate Voice",
        service: "fal_voice",
        endpoint: "/api/fal/tts",
        order: 1,
        prompt: original.enhancedPrompt,
        params: {},
        creditCost: 150,
        estimatedDurationSeconds: 10,
        critical: true,
      },
    ],
    // These multimodal/ad types won't be fallback destinations but need to be typed
    video_ad: [],
    multimodal: [],
  };

  const fallbackSteps = FALLBACK_STEPS[newTaskType];
  if (!fallbackSteps || fallbackSteps.length === 0) return null;

  const fallbackCost = fallbackSteps.reduce(
    (s, step) => s + step.creditCost,
    0,
  );
  if (fallbackCost > budget) return null;

  changes.push(
    `Downgraded task type: ${original.taskType} → ${newTaskType} (cost: ${fallbackCost}cr)`,
  );

  return {
    ...original,
    taskType: newTaskType,
    steps: fallbackSteps,
    totalEstimatedCredits: fallbackCost,
    totalEstimatedDurationSeconds: Math.max(
      ...fallbackSteps.map((s) => s.estimatedDurationSeconds),
    ),
    summary: `[Budget downgraded] ${original.summary}`,
    reasoning: `${original.reasoning} | Budget constraint forced downgrade from ${original.taskType} to ${newTaskType}.`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enforce user credit limits on a plan before execution.
 *
 * Tries three progressive downgrade strategies:
 *   1. Swap expensive models for cheaper alternatives
 *   2. Remove non-critical supplementary steps
 *   3. Fall back to a simpler task type
 *
 * @param plan        - The AI-generated execution plan
 * @param userCredits - Current available credit balance for the user
 * @returns BudgetGuardResult with final plan + status + change log
 */
export function enforceBudget(
  plan: ExecutionPlan,
  userCredits: number,
): BudgetGuardResult {
  const originalCost = plan.totalEstimatedCredits;
  const changes: string[] = [];

  // Already within budget — fast path
  if (originalCost <= userCredits) {
    return {
      status: "WITHIN_BUDGET",
      plan,
      userCredits,
      originalCost,
      finalCost: originalCost,
      changes: [],
    };
  }

  let workingPlan = clonePlan(plan);

  // Strategy 1: Model downgrades
  workingPlan = tryModelDowngrades(workingPlan, userCredits, changes);
  if (planCost(workingPlan) <= userCredits) {
    workingPlan.totalEstimatedCredits = planCost(workingPlan);
    return {
      status: "DOWNGRADED",
      plan: workingPlan,
      userCredits,
      originalCost,
      finalCost: planCost(workingPlan),
      changes,
    };
  }

  // Strategy 2: Remove non-critical steps
  workingPlan = tryStepRemoval(workingPlan, userCredits, changes);
  if (planCost(workingPlan) <= userCredits) {
    workingPlan.totalEstimatedCredits = planCost(workingPlan);
    return {
      status: "DOWNGRADED",
      plan: workingPlan,
      userCredits,
      originalCost,
      finalCost: planCost(workingPlan),
      changes,
    };
  }

  // Strategy 3: Task type fallback
  let fallbackType = TASK_FALLBACK[plan.taskType];
  while (fallbackType) {
    const fallbackPlan = buildFallbackPlan(
      workingPlan,
      fallbackType,
      userCredits,
      changes,
    );
    if (fallbackPlan && planCost(fallbackPlan) <= userCredits) {
      return {
        status: "DOWNGRADED",
        plan: fallbackPlan,
        userCredits,
        originalCost,
        finalCost: planCost(fallbackPlan),
        changes,
      };
    }
    fallbackType = TASK_FALLBACK[fallbackType];
  }

  // Cannot afford at all
  return {
    status: "NOT_AFFORDABLE",
    plan: workingPlan,
    userCredits,
    originalCost,
    finalCost: planCost(workingPlan),
    changes,
  };
}

/**
 * Minimum credits required to execute any generation at all.
 * Used to show "You need at least X credits" to the user.
 */
export const MINIMUM_CREDITS_REQUIRED = 100;
