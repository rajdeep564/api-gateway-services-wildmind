/**
 * WildMind AI Planner — Execution Plan Types
 *
 * These types represent the FULL execution plan that the AI Planner
 * generates from a user prompt. This is richer than ClassificationResult —
 * it contains every step the workflow engine needs to execute without
 * any additional decision-making.
 *
 * Schema design goals:
 *   - Self-describing: each step carries everything needed to execute it
 *   - Serializable: can be stored in Redis/Firestore as plain JSON
 *   - Executable: WorkflowEngine consumes PlanStep[] directly
 *   - Auditable: plan captures why decisions were made (reasoning fields)
 */

// ---------------------------------------------------------------------------
// Primitive enums (kept in sync with orchestratorTypes.ts)
// ---------------------------------------------------------------------------

export type PlanTaskType =
  | "image"
  | "video"
  | "music"
  | "voice"
  | "video_ad"
  | "image_ad"
  | "multimodal";

export type PlanComplexity = "low" | "medium" | "high";

export type PlanStepStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped";

// ---------------------------------------------------------------------------
// Plan Step — a single generation action
// ---------------------------------------------------------------------------

export interface PlanStep {
  /**
   * Unique identifier for this step within the plan.
   * Used by `dependsOn` to wire outputs between steps.
   * Convention: snake_case, e.g. "script_gen", "runway_video_1"
   */
  stepId: string;

  /**
   * Human-readable label shown in status updates.
   * e.g. "Generate Ad Script", "Render Cinematic Video"
   */
  label: string;

  /**
   * Which generation service handles this step.
   * Maps to services known by the WorkflowEngine/TaskRouter.
   */
  service:
    | "fal_image"
    | "fal_image_pro"
    | "bfl_image"
    | "replicate_image"
    | "runway_video"
    | "fal_video"
    | "replicate_video"
    | "minimax_music"
    | "fal_music"
    | "fal_voice"
    | "replicate_voice"
    | "script_gen"
    | "scene_breakdown"
    | string; // extensible

  /**
   * Internal API endpoint this service is called at.
   * e.g. "/api/runway/generate"
   */
  endpoint: string;

  /**
   * Execution order group.
   * Steps with the SAME order run in PARALLEL.
   * Steps with DIFFERENT orders run SEQUENTIALLY (ascending).
   */
  order: number;

  /**
   * Optional: stepId this step depends on.
   * The output of the named step is injected as `context` into this step's request.
   */
  dependsOn?: string;

  /**
   * The generation prompt for this specific step.
   * May differ from the top-level enhancedPrompt (e.g., for script_gen the
   * planner writes a script-specific instruction).
   */
  prompt: string;

  /**
   * Extra parameters merged into the service request body.
   * Keys are service-specific (e.g., { duration: 30, aspectRatio: "16:9" })
   */
  params: Record<string, any>;

  /**
   * Estimated credits this step will consume.
   * Sum of all steps = total plan cost.
   */
  creditCost: number;

  /**
   * Estimated wall-clock time for this step.
   */
  estimatedDurationSeconds: number;

  /**
   * Whether a failure in this step should abort the entire plan.
   * Non-critical steps (e.g., background music) can fail without blocking others.
   */
  critical: boolean;
}

// ---------------------------------------------------------------------------
// Full Execution Plan — output of the AI Planner
// ---------------------------------------------------------------------------

export interface ExecutionPlan {
  /** The task type the planner chose */
  taskType: PlanTaskType;

  /** One-line summary of what will be generated */
  summary: string;

  /** Planner's reasoning for the chosen task type and steps */
  reasoning: string;

  /** Detected or inferred visual/audio style */
  style: string;

  /** Emotional tone */
  tone: string;

  /** Task complexity — influences credit budget and model selection */
  complexity: PlanComplexity;

  /** Audience or target demographic (for ads) */
  targetAudience?: string;

  /** Estimated duration in seconds (video/music), null for image */
  contentDurationSeconds: number | null;

  /** Top-level enhanced prompt used across all steps (unless overridden per-step) */
  enhancedPrompt: string;

  /** Original user prompt, unchanged */
  originalPrompt: string;

  /** Ordered list of generation steps — consumed directly by WorkflowEngine */
  steps: PlanStep[];

  /** Total estimated credit cost (sum of all step costs) */
  totalEstimatedCredits: number;

  /** Total estimated wall-clock time assuming maximum parallelism */
  totalEstimatedDurationSeconds: number;

  /** Which LLM generated this plan */
  generatedBy: string;

  /** Plan schema version for backward compatibility */
  schemaVersion: "1.0";
}

// ---------------------------------------------------------------------------
// Planner Input
// ---------------------------------------------------------------------------

export interface PlannerInput {
  /** Raw user prompt */
  prompt: string;
  /** Optional caller hints to guide the planner */
  hints?: {
    taskType?: PlanTaskType;
    style?: string;
    tone?: string;
    complexity?: PlanComplexity;
    targetAudience?: string;
    durationSeconds?: number;
    spec?: Record<string, any>;
  };
}

// ---------------------------------------------------------------------------
// Plan Validation Result
// ---------------------------------------------------------------------------

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Repaired plan if validation found fixable issues */
  repairedPlan?: ExecutionPlan;
}
