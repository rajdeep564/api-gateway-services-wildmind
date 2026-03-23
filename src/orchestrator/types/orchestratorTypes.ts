/**
 * WildMind AI Orchestrator — Shared Types
 *
 * Central type definitions used across all orchestrator modules.
 * Every generation category, job state, and step result is typed here.
 */

// ---------------------------------------------------------------------------
// Generation Categories
// ---------------------------------------------------------------------------

export type GenerationCategory =
  | "image"
  | "video"
  | "music"
  | "voice"
  | "advertisement"
  | "multimodal"
  | "unknown";

export type TaskType =
  | "image"
  | "video"
  | "music"
  | "voice"
  | "video_ad"
  | "image_ad"
  | "multimodal"
  | "unknown";

export type Complexity = "low" | "medium" | "high";

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type JobStatus =
  | "pending"
  | "classifying"
  | "enhancing"
  | "routing"
  | "generating"
  | "completed"
  | "failed";

// ---------------------------------------------------------------------------
// Classification Output (from IntentClassifier)
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  /** Detected generation task type */
  taskType: TaskType;
  /** List of asset types required */
  assetsNeeded: string[];
  /** Visual/audio style descriptor */
  style: string;
  /** Emotional tone */
  tone: string;
  /** Task complexity */
  complexity: Complexity;
  /** Primary subject of the content */
  subject: string;
  /** Estimated duration in seconds (video/music), null otherwise */
  duration: number | null;
  /** Overall generation category */
  category: GenerationCategory;
  /** LLM model used for classification */
  classifiedBy: string;
  /** Raw confidence (0–1); may be null if model does not provide it */
  confidence: number | null;
}

// ---------------------------------------------------------------------------
// Orchestrator Plan (built after classification + enhancement)
// ---------------------------------------------------------------------------

export interface OrchestratorPlan {
  taskType: TaskType;
  category: GenerationCategory;
  assetsNeeded: string[];
  style: string;
  tone: string;
  complexity: Complexity;
  /** LLM-enhanced version of the original prompt */
  enhancedPrompt: string;
  originalPrompt: string;
  /** Names of the routing targets that will be called */
  routingTargets: string[];
  /** Credit estimate before generation starts */
  estimatedCredits: number;
  /** Additional metadata passed through the pipeline */
  metadata: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Routing Decision (from TaskRouter)
// ---------------------------------------------------------------------------

export interface RouteService {
  /** Unique name for this step */
  name: string;
  /** Internal API endpoint to call */
  endpoint: string;
  /** Execution order — same order = parallel, different = sequential */
  order: number;
  /** Name of a previous step whose output is injected as context */
  dependsOn?: string;
  /** Override prompt for this specific step (e.g., for script generation) */
  promptOverride?: string;
  /** Extra body params specific to this service */
  extraParams?: Record<string, any>;
}

export interface RouteDecision {
  taskType: TaskType;
  services: RouteService[];
}

// ---------------------------------------------------------------------------
// Step Result (from WorkflowEngine)
// ---------------------------------------------------------------------------

export interface OrchestratorStepResult {
  step: string;
  status: StepStatus;
  /** Raw output from the generation service */
  output?: any;
  /** Error message if step failed */
  error?: string;
  /** Wall-clock duration for this step */
  durationMs?: number;
  /** When the step started */
  startedAt?: number;
  /** When the step finished */
  finishedAt?: number;
}

// ---------------------------------------------------------------------------
// Job Status (stored in Redis per jobId)
// ---------------------------------------------------------------------------

export interface OrchestratorJobStatus {
  jobId: string;
  userId: string;
  status: JobStatus;
  /** Full plan, set once classification + enhancement is done */
  plan?: OrchestratorPlan;
  /** Array of step results, updated as steps complete */
  steps: OrchestratorStepResult[];
  /** Final aggregated result, set when status = "completed" */
  result?: any;
  /** Top-level error message, set when status = "failed" */
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Job Enqueue Payload (passed to BullMQ / inline executor)
// ---------------------------------------------------------------------------

export interface OrchestratorJobPayload {
  jobId: string;
  userId: string;
  prompt: string;
  /** Bearer token for internal service-to-service calls */
  token: string;
  /** Optional caller-provided hints that override classification */
  hints?: {
    taskType?: TaskType;
    style?: string;
    tone?: string;
    complexity?: Complexity;
    assetsNeeded?: string[];
  };
}
