/**
 * WildMind AI Orchestrator — HTTP Controller
 *
 * Endpoints:
 *   POST /api/orchestrator/plan            → Preview plan (saves to planStore, status: awaiting_approval)
 *   POST /api/orchestrator/approve/:planId → Approve plan (security check → enqueue BullMQ job)
 *   POST /api/orchestrator/generate        → Legacy: submit generation job directly
 *   GET  /api/orchestrator/status/:jobId   → Poll job status
 */

import type { Request, Response } from "express";
import { createJobStatus, getJobStatus } from "../orchestrator/jobStatusStore";
import { enqueueOrchestrationJob } from "../orchestrator/jobQueue";
import { estimateCredits } from "../orchestrator/taskRouter";
import { generateExecutionPlan } from "../orchestrator/planner/agentPlanner";
import { modelSelectionEngine, type SelectionPriority, MODEL_REGISTRY } from "../orchestrator/planner/modelSelectionEngine";
import { savePlan, getPlan, markApproved, markExecuting, applyModelOverrides } from "../orchestrator/planStore";
import { readUserCredits } from "../repository/creditsRepository";
import type {
  OrchestratorJobPayload,
  TaskType,
  Complexity,
} from "../orchestrator/types/orchestratorTypes";
import { MAX_PLAN_COST } from "../openclaw/types";

// ---------------------------------------------------------------------------
// POST /api/orchestrator/generate
// ---------------------------------------------------------------------------

export async function submitGeneration(
  req: Request,
  res: Response,
): Promise<void> {
  const { prompt, hints } = req.body;
  const userId = (req as any).uid as string;

  // Validate required fields
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({
      error: "MISSING_PROMPT",
      message: "prompt is required and must be a non-empty string",
    });
    return;
  }

  if (prompt.trim().length > 5000) {
    res.status(400).json({
      error: "PROMPT_TOO_LONG",
      message: "prompt must be 5000 characters or fewer",
    });
    return;
  }

  // Validate hints if provided
  const VALID_TASK_TYPES: TaskType[] = [
    "image",
    "video",
    "music",
    "voice",
    "video_ad",
    "image_ad",
    "multimodal",
  ];
  const VALID_COMPLEXITY: Complexity[] = ["low", "medium", "high"];

  if (hints?.taskType && !VALID_TASK_TYPES.includes(hints.taskType)) {
    res.status(400).json({
      error: "INVALID_TASK_TYPE",
      message: `hints.taskType must be one of: ${VALID_TASK_TYPES.join(", ")}`,
    });
    return;
  }

  if (hints?.complexity && !VALID_COMPLEXITY.includes(hints.complexity)) {
    res.status(400).json({
      error: "INVALID_COMPLEXITY",
      message: `hints.complexity must be one of: ${VALID_COMPLEXITY.join(", ")}`,
    });
    return;
  }

  try {
    // Create job in Redis/in-memory store
    const job = await createJobStatus(userId, prompt.trim());

    // Extract Bearer token for internal service-to-service calls
    const cookieToken = req.cookies?.app_session;
    const headerToken = (req.headers.authorization ?? "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    const token = cookieToken || headerToken;

    const payload: OrchestratorJobPayload = {
      jobId: job.jobId,
      userId,
      prompt: prompt.trim(),
      token,
      hints,
    };

    // Enqueue (or execute inline in dev)
    await enqueueOrchestrationJob(payload);

    // Estimate credits based on hint if provided
    const estimatedCredits = hints?.taskType
      ? estimateCredits(hints.taskType)
      : undefined;

    res.status(202).json({
      jobId: job.jobId,
      status: job.status,
      estimatedCredits,
      message:
        "Generation job accepted. Poll /api/orchestrator/status/:jobId for updates.",
    });
  } catch (err: any) {
    console.error(
      "[OrchestratorController] submitGeneration error:",
      err?.message,
    );
    res.status(500).json({
      error: "ORCHESTRATOR_ERROR",
      message: err?.message ?? "Failed to submit generation job",
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/orchestrator/status/:jobId
// ---------------------------------------------------------------------------

export async function getGenerationStatus(
  req: Request,
  res: Response,
): Promise<void> {
  const { jobId } = req.params;
  const userId = (req as any).uid as string;

  if (!jobId || !jobId.startsWith("orch_")) {
    res.status(400).json({
      error: "INVALID_JOB_ID",
      message: "jobId must be a valid orchestrator job ID (format: orch_...)",
    });
    return;
  }

  try {
    const job = await getJobStatus(jobId);

    if (!job) {
      res.status(404).json({
        error: "JOB_NOT_FOUND",
        message: `No job found with id: ${jobId}`,
      });
      return;
    }

    // Security: users may only view their own jobs
    if (job.userId !== userId) {
      res.status(403).json({
        error: "FORBIDDEN",
        message: "You do not have permission to view this job",
      });
      return;
    }

    res.json(job);
  } catch (err: any) {
    console.error(
      "[OrchestratorController] getGenerationStatus error:",
      err?.message,
    );
    res.status(500).json({
      error: "STATUS_FETCH_ERROR",
      message: err?.message ?? "Failed to retrieve job status",
    });
  }
}

// ---------------------------------------------------------------------------
// POST /api/orchestrator/plan
// Generate a plan without executing it, including per-step model alternatives.
// Used by the frontend "plan review" UX so users can inspect and approve
// before committing credits or starting generation.
// ---------------------------------------------------------------------------

export async function previewPlan(
  req: Request,
  res: Response,
): Promise<void> {
  const { prompt, hints, spec } = req.body;

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({
      error: "MISSING_PROMPT",
      message: "prompt is required",
    });
    return;
  }

  if (prompt.trim().length > 5000) {
    res.status(400).json({
      error: "PROMPT_TOO_LONG",
      message: "prompt must be 5000 characters or fewer",
    });
    return;
  }

  try {
    const priority: SelectionPriority = hints?.priority ?? "balanced";
    const userCredits: number | undefined =
      typeof hints?.userCredits === "number" ? hints.userCredits : undefined;

    // Generate plan (uses spec for static plan when provided, else LLM)
    const plan = await generateExecutionPlan({ prompt: prompt.trim(), hints: { ...hints, spec } });

    // Apply model selection to each step and collect alternatives
    const UTILITY_SERVICES = ["script_gen", "scene_breakdown"];
    const stepsWithAlternatives = plan.steps.map((step) => {
      if (UTILITY_SERVICES.includes(step.service)) {
        return { ...step, alternatives: [] };
      }
      try {
        const result = modelSelectionEngine.select({
          taskType: plan.taskType as any,
          style: plan.style ?? "",
          complexity: plan.complexity ?? "medium",
          priority,
          creditLimit: userCredits,
        });

        // Top-scored model becomes the "recommended"
        const recommended = result.primary.profile;
        // Alternatives = ranked list excluding the selected
        const alternatives = result.ranked.slice(1, 4).map((r) => ({
          modelId: r.profile.modelId,
          label: r.profile.label,
          provider: r.profile.provider,
          service: r.profile.service,
          endpoint: r.profile.endpoint,
          creditCost: r.profile.creditCost,
          score: +r.score.toFixed(3),
          reasoning: r.reasoning,
        }));

        return {
          ...step,
          service: recommended.service,
          endpoint: recommended.endpoint,
          creditCost: recommended.creditCost,
          params: {
            ...(step.params || {}),
            ...(recommended.modelParams || {}),
          },
          selectedModel: {
            modelId: recommended.modelId,
            label: recommended.label,
            provider: recommended.provider,
            creditCost: recommended.creditCost,
            reasoning: result.primary.reasoning,
            score: +result.primary.score.toFixed(3),
          },
          alternatives,
        };
      } catch {
        return { ...step, alternatives: [] };
      }
    });

    const totalEstimatedCredits = stepsWithAlternatives.reduce(
      (sum, s) => sum + (s.creditCost ?? 0),
      0,
    );

    // List all available models per task type for the frontend model picker
    const availableModels = MODEL_REGISTRY.filter((m) => m.enabled).map((m) => ({
      modelId: m.modelId,
      label: m.label,
      provider: m.provider,
      service: m.service,
      creditCost: m.creditCost,
      tasks: Object.keys(m.tasks),
      latencyP50Seconds: m.latencyP50Seconds,
    }));

    const userId = (req as any).uid as string;

    if (totalEstimatedCredits > MAX_PLAN_COST) {
      res.status(400).json({
        error: "PLAN_COST_EXCEEDED",
        message: `Plan cost (${totalEstimatedCredits} credits) exceeds maximum allowed (${MAX_PLAN_COST}). Simplify the plan or reduce steps.`,
      });
      return;
    }

    // Save plan to planStore so it can be approved later
    const finalPlan = { ...plan, steps: stepsWithAlternatives, totalEstimatedCredits };
    const planId = savePlan(userId, finalPlan as any);

    res.json({
      ok: true,
      planId,
      status: "awaiting_approval",
      prompt: prompt.trim(),
      priority,
      plan: finalPlan,
      availableModels,
      spec: spec ?? null,
      originalPrompt: (finalPlan as any).originalPrompt ?? prompt.trim(),
      enhancedPrompt: (finalPlan as any).enhancedPrompt ?? prompt.trim(),
    });
  } catch (err: any) {
    console.error("[OrchestratorController] previewPlan error:", err?.message);
    res.status(500).json({
      error: "PLAN_ERROR",
      message: err?.message ?? "Failed to generate plan",
    });
  }
}

// ---------------------------------------------------------------------------
// POST /api/orchestrator/approve/:planId
// Security: verify ownership + credit check → enqueue BullMQ job
// ---------------------------------------------------------------------------

export async function approvePlan(
  req: Request,
  res: Response,
): Promise<void> {
  const { planId } = req.params;
  const userId = (req as any).uid as string;
  const { modelOverrides } = req.body ?? {};

  if (!planId || !planId.startsWith("plan_")) {
    res.status(400).json({
      error: "INVALID_PLAN_ID",
      message: "planId must be a valid plan ID (format: plan_...)",
    });
    return;
  }

  // Retrieve plan from store
  const entry = getPlan(planId);
  if (!entry) {
    res.status(404).json({
      error: "PLAN_NOT_FOUND",
      message: "Plan not found or has expired (10-minute window). Please regenerate the plan.",
    });
    return;
  }

  // Security: only the plan owner can approve it
  if (entry.userId !== userId) {
    res.status(403).json({
      error: "FORBIDDEN",
      message: "You do not have permission to approve this plan",
    });
    return;
  }

  // State check: must be awaiting_approval
  if (entry.status !== "awaiting_approval") {
    res.status(409).json({
      error: "INVALID_STATE",
      message: `Plan is in state "${entry.status}" — can only approve plans in awaiting_approval state`,
    });
    return;
  }

  // Plan cost guardrail: reject plans exceeding MAX_PLAN_COST
  const plan = entry.executionPlan;
  const requiredCredits = plan.totalEstimatedCredits ?? 0;
  if (requiredCredits > MAX_PLAN_COST) {
    res.status(400).json({
      error: "PLAN_COST_EXCEEDED",
      message: `Plan cost (${requiredCredits} credits) exceeds maximum allowed (${MAX_PLAN_COST}).`,
    });
    return;
  }

  // Credits check: user must have enough credits for the plan
  let userCredits: number;
  try {
    userCredits = await readUserCredits(userId);
  } catch (err: any) {
    console.error("[OrchestratorController] approvePlan: readUserCredits failed", err?.message);
    res.status(503).json({
      error: "CREDITS_UNAVAILABLE",
      message: "Unable to verify credit balance. Please try again.",
    });
    return;
  }
  if (userCredits < requiredCredits) {
    res.status(402).json({
      error: "INSUFFICIENT_CREDITS",
      message: `This plan requires ${requiredCredits} credits, but you only have ${userCredits}.`,
    });
    return;
  }

  // Apply any model overrides the user made in the review UI
  if (modelOverrides && typeof modelOverrides === "object") {
    applyModelOverrides(planId, modelOverrides);
  }

  try {
    // Mark approved
    markApproved(planId);

    // Create job
    const job = await createJobStatus(userId, entry.executionPlan.originalPrompt ?? "");

    const cookieToken = req.cookies?.app_session;
    const headerToken = (req.headers.authorization ?? "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    const token = cookieToken || headerToken;

    const payload: OrchestratorJobPayload = {
      jobId: job.jobId,
      userId,
      prompt: entry.executionPlan.originalPrompt ?? "",
      token,
      hints: {
        // Pass the pre-built plan so the orchestrator skips re-planning
        preBuiltPlan: entry.executionPlan,
        modelOverrides: entry.modelOverrides,
      } as any,
    };

    await enqueueOrchestrationJob(payload);
    markExecuting(planId);

    console.log(
      `[OrchestratorController] Plan ${planId} approved → job ${job.jobId} (user: ${userId})`,
    );

    res.status(202).json({
      ok: true,
      jobId: job.jobId,
      planId,
      message: "Plan approved. Generation started. Poll /api/orchestrator/status/:jobId for updates.",
    });
  } catch (err: any) {
    console.error("[OrchestratorController] approvePlan error:", err?.message);
    res.status(500).json({
      error: "APPROVE_ERROR",
      message: err?.message ?? "Failed to start generation",
    });
  }
}
