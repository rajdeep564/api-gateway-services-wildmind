/**
 * WildMind — Conversation Agent
 *
 * Main orchestrator for multi-turn requirement gathering.
 * Handles one conversation turn and returns a structured response:
 *
 *   { type: "clarify",  question: string }            — task type not yet known
 *   { type: "question", question: string, progress }  — still collecting fields
 *   { type: "spec_ready", spec, progress }            — all required fields collected
 *
 * Usage:
 *   const { response } = await processConversationTurn({
 *     sessionId, userId, userMessage
 *   });
 */

import {
  getOrCreateSession,
  appendMessage,
  mergeFields,
  setTaskType,
  setSchema,
  setPhase,
  persistSession,
  deleteSession,
  type ConversationSession,
} from "./conversationState";
import {
  getFallbackSchema,
  getMissingFields,
  isSpecComplete,
  type RequirementSchema,
  type RequirementField,
} from "./requirementSchemas";
import {
  detectTaskType,
  extractFieldsFromMessage,
  generateFollowUpQuestion,
  generateDynamicSchema,
} from "./requirementExtractor";
import {
  setAgentState,
  emptyAgentState,
  type AgentState as StoredAgentState,
} from "../memory/agentStateStore";
import { PROMPT_VERSIONS } from "../modelGateway/promptVersions";

// ── Public types ──────────────────────────────────────────────────────────────

export interface ConversationProgress {
  collected: number;
  total: number;
  percent: number;
}

export type ConversationResponseType = "clarify" | "question" | "spec_ready";

export interface ConversationResponse {
  type: ConversationResponseType;
  question?: string;
  spec?: GenerationSpec;
  progress: ConversationProgress;
  session: {
    sessionId: string;
    taskType: string | null;
    collectedFields: Record<string, any>;
    phase: string;
  };
}

/** The structured specification passed to the AI Planner once gathering is complete */
export interface GenerationSpec {
  taskType: string;
  [key: string]: any;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function buildProgress(
  schema: RequirementSchema | null,
  collected: Record<string, any>,
): ConversationProgress {
  if (!schema) return { collected: 0, total: 0, percent: 0 };
  const required = schema.fields.filter((f) => f.required);
  const collectedCount = required.filter((f) => {
    const v = collected[f.key];
    return v !== undefined && v !== null && v !== "";
  }).length;
  return {
    collected: collectedCount,
    total: required.length,
    percent: required.length > 0
      ? Math.round((collectedCount / required.length) * 100)
      : 100,
  };
}

function sessionSnapshot(session: ConversationSession) {
  return {
    sessionId: session.sessionId,
    taskType: session.taskType,
    collectedFields: session.collectedFields,
    phase: session.phase,
  };
}

/** Persist AgentState from session and return the response (execution memory). */
async function persistAgentStateAndReturn(
  sessionId: string,
  userId: string,
  session: ConversationSession,
  response: ConversationResponse,
): Promise<ConversationResponse> {
  const agentState: StoredAgentState = {
    taskType: session.taskType,
    spec: session.phase === "complete" ? { taskType: session.taskType!, ...session.collectedFields } : null,
    schema: session.schema,
    plan: null,
    planId: session.planId ?? null,
    approved: false,
    history: session.history,
    schemaRevisionCount: 0,
    updatedAt: Date.now(),
  };
  await setAgentState(userId, sessionId, agentState);
  return response;
}

// ── Main turn processor ───────────────────────────────────────────────────────

/** Task types that support an optional reference image / mood board */
const REFERENCE_ELIGIBLE_TASK_TYPES = ["image", "logo", "video", "video_ad"];
const REFERENCE_FIELD_KEY = "reference_image_url";

/** User said they don't have a reference → treat as answered so we don't ask again */
function isDecliningReference(msg: string): boolean {
  const t = msg.trim().toLowerCase();
  return /^(no|nope|skip|none|nah|without|don't have|dont have|not really|no thanks|no thank you)$/.test(t) || t.length < 3 && /n|s/.test(t);
}

export async function processConversationTurn(opts: {
  sessionId: string;
  userId: string;
  userMessage: string;
  /** Optional reference image URLs from uploads (client sends after user uploads) */
  referenceImageUrls?: string[];
  /** Optional request ID for gateway/audit logging */
  requestId?: string;
}): Promise<ConversationResponse> {
  const { sessionId, userId, userMessage, referenceImageUrls, requestId } = opts;
  const session = await getOrCreateSession(sessionId, userId);
  const gatewayContext =
    userId && requestId
      ? {
          userId,
          requestId,
          promptTemplateVersion: `REQUIREMENT_EXTRACTOR=${PROMPT_VERSIONS.REQUIREMENT_EXTRACTOR}`,
        }
      : undefined;

  console.log(
    `[ConversationAgent] Turn — session=${sessionId} phase=${session.phase} taskType=${session.taskType}`,
  );

  // Record user message in history
  await appendMessage(sessionId, userId, "user", userMessage);

  // ── Step 1: Determine task type (and detect "actually make it a video ad" etc.) ───

  let taskType = session.taskType;
  const { taskType: detected, confidence } = await detectTaskType(userMessage, gatewayContext);
  console.log(
    `[ConversationAgent] Task detected: ${detected} (confidence: ${confidence})`,
  );

  if (!taskType) {
    if (confidence < 0.35) {
      const question =
        "What would you like to create? For example: an image, a logo, a video, a video advertisement, or music?";
      await appendMessage(sessionId, userId, "agent", question);
      return persistAgentStateAndReturn(sessionId, userId, session, {
        type: "clarify",
        question,
        progress: buildProgress(null, {}),
        session: sessionSnapshot(session),
      });
    }
    await setTaskType(sessionId, userId, detected);
    taskType = detected;
  } else if (detected !== taskType && confidence >= 0.6) {
    // User changed task type (e.g. "actually make it a video ad") — clear and rebuild
    session.schema = null;
    session.collectedFields = {};
    await persistSession(sessionId, userId, session);
    await setTaskType(sessionId, userId, detected);
    taskType = detected;
    const agentState = emptyAgentState();
    agentState.taskType = detected;
    agentState.schemaRevisionCount = 1;
    await setAgentState(userId, sessionId, agentState);
  }

  // ── Step 2: Load or Generate schema (AI-first for "AI thinking" feel) ───────

  let schema = session.schema;
  if (!schema) {
    // 1. Prefer AI-generated schema for every task type (image, logo, video, video_ad, music, etc.)
    schema = await generateDynamicSchema(userMessage, taskType, gatewayContext);

    // 2. Fallback to static schema if dynamic fails (null, parse error, or validation)
    if (!schema) {
      schema = getFallbackSchema(taskType);
    }

    // 3. Ultimate fallback: standard image
    if (!schema) {
      console.warn(`[ConversationAgent] No schema for taskType=${taskType}, defaulting to 'image'`);
      await setTaskType(sessionId, userId, "image");
      taskType = "image";
      schema = getFallbackSchema("image")!;
    }

    await setSchema(sessionId, userId, schema);
  }

  // ── Step 3: Extract fields from this message ──────────────────────────────

  // Merge uploaded reference URLs if provided (client sent referenceImageUrls)
  if (referenceImageUrls?.length && referenceImageUrls[0]) {
    await mergeFields(sessionId, userId, { [REFERENCE_FIELD_KEY]: referenceImageUrls[0] });
  }
  // If user is declining reference (no/skip), mark as answered so we don't ask again
  const refField = schema.fields.find((f) => f.key === REFERENCE_FIELD_KEY);
  if (refField && isDecliningReference(userMessage)) {
    await mergeFields(sessionId, userId, { [REFERENCE_FIELD_KEY]: null });
  }

  const extracted = await extractFieldsFromMessage(
    userMessage,
    schema,
    session.collectedFields,
    gatewayContext,
  );

  if (Object.keys(extracted).length > 0) {
    await mergeFields(sessionId, userId, extracted);
  }

  // Refresh session after merge
  const updatedSession = await getOrCreateSession(sessionId, userId);
  const collected = updatedSession.collectedFields;

  // ── Step 4: Check completion ──────────────────────────────────────────────

  if (isSpecComplete(schema, collected)) {
    // Optional: before returning spec_ready, ask for reference if eligible and not yet answered
    const hasRefField = schema.fields.some((f) => f.key === REFERENCE_FIELD_KEY);
    const refValue = collected[REFERENCE_FIELD_KEY];
    const shouldAskReference =
      hasRefField &&
      REFERENCE_ELIGIBLE_TASK_TYPES.includes(taskType) &&
      (refValue === undefined || refValue === "");

    if (shouldAskReference) {
      const refField = schema.fields.find((f) => f.key === REFERENCE_FIELD_KEY)!;
      const question = await generateFollowUpQuestion(refField, schema, collected, gatewayContext);
      await appendMessage(sessionId, userId, "agent", question);
      const progress = buildProgress(schema, collected);
      return persistAgentStateAndReturn(sessionId, userId, updatedSession, {
        type: "question",
        question,
        progress,
        session: sessionSnapshot(updatedSession),
      });
    }
    await setPhase(sessionId, userId, "complete");

    const spec: GenerationSpec = { taskType, ...collected };
    const progress = buildProgress(schema, collected);

    console.log(
      `[ConversationAgent] Spec complete for session=${sessionId}:`,
      Object.keys(spec),
    );

    const completionMessage = `I have everything I need to create your ${schema.displayName}! Generating your plan now…`;
    await appendMessage(sessionId, userId, "agent", completionMessage);

    return persistAgentStateAndReturn(sessionId, userId, updatedSession, {
      type: "spec_ready",
      spec,
      progress,
      session: sessionSnapshot(updatedSession),
    });
  }

  // ── Step 5: Ask next question ─────────────────────────────────────────────

  const missingFields = getMissingFields(schema, collected);
  const nextField: RequirementField = missingFields[0];

  const question = await generateFollowUpQuestion(
    nextField,
    schema,
    collected,
    gatewayContext,
  );

  await appendMessage(sessionId, userId, "agent", question);

  const progress = buildProgress(schema, collected);
  console.log(
    `[ConversationAgent] Asking next: "${nextField.key}" — progress ${progress.collected}/${progress.total}`,
  );

  return persistAgentStateAndReturn(sessionId, userId, updatedSession, {
    type: "question",
    question,
    progress,
    session: sessionSnapshot(updatedSession),
  });
}

// ── Session reset ─────────────────────────────────────────────────────────────

/** Reset (delete) a session; requires userId so only the owner can reset (critical fix). */
export async function resetSession(sessionId: string, userId: string): Promise<void> {
  await deleteSession(sessionId, userId);
}
