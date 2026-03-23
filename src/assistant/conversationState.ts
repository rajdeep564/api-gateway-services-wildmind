/**
 * WildMind — Conversation State Store
 *
 * When env.redisUrl is set: Redis at conversation:{userId}:{sessionId} with TTL (30 min, refresh on activity).
 * Otherwise: in-memory Map (same key pattern). Sessions expire after CONVERSATION_TTL_MS of inactivity.
 *
 * Key: compound "conversation:{userId}:{sessionId}" so sessionId cannot be hijacked (critical fix).
 */

import { env } from "../config/env";
import { redisDelSafe, redisGetSafe, redisSetSafe } from "../config/redisClient";

export type ConversationPhase =
  | "detecting_task"
  | "gathering"
  | "complete"
  | "planning"
  | "executing";

export interface ConversationMessage {
  role: "agent" | "user";
  content: string;
  timestamp: number;
}

export interface ConversationSession {
  sessionId: string;
  userId: string;
  taskType: string | null;
  schema: import("./requirementSchemas").RequirementSchema | null;
  collectedFields: Record<string, any>;
  phase: ConversationPhase;
  history: ConversationMessage[];
  planId?: string;
  createdAt: number;
  lastActivityAt: number;
}

const CONVERSATION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CONVERSATION_TTL_SEC = Math.floor(CONVERSATION_TTL_MS / 1000);
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const _sessions = new Map<string, ConversationSession>();

function sessionKey(userId: string, sessionId: string): string {
  const prefix = env.redisPrefix ?? "";
  return `${prefix}conversation:${userId}:${sessionId}`;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of _sessions.entries()) {
    if (now - session.lastActivityAt > CONVERSATION_TTL_MS) {
      _sessions.delete(key);
      console.log(`[ConversationState] Session expired and removed: ${key}`);
    }
  }
}, CLEANUP_INTERVAL_MS);

/** Create a new session. Overwrites any existing session for this userId+sessionId. */
export async function createSession(
  sessionId: string,
  userId: string,
): Promise<ConversationSession> {
  const session: ConversationSession = {
    sessionId,
    userId,
    taskType: null,
    schema: null,
    collectedFields: {},
    phase: "detecting_task",
    history: [],
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  const key = sessionKey(userId, sessionId);
  _sessions.set(key, session);
  if (env.redisUrl) {
    await redisSetSafe(key, session, CONVERSATION_TTL_SEC);
  }
  console.log(`[ConversationState] Created session: ${sessionId} (user: ${userId})`);
  return session;
}

/** Get an existing session, or create a new one if it doesn't exist */
export async function getOrCreateSession(
  sessionId: string,
  userId: string,
): Promise<ConversationSession> {
  const key = sessionKey(userId, sessionId);
  if (env.redisUrl) {
    const existing = await redisGetSafe<ConversationSession>(key);
    if (existing) {
      existing.lastActivityAt = Date.now();
      await redisSetSafe(key, existing, CONVERSATION_TTL_SEC);
      return existing;
    }
    return createSession(sessionId, userId);
  }
  const existing = _sessions.get(key);
  if (existing) {
    existing.lastActivityAt = Date.now();
    return existing;
  }
  return createSession(sessionId, userId);
}

/** Get a session (null if not found or expired). */
export async function getSession(
  sessionId: string,
  userId: string,
): Promise<ConversationSession | null> {
  const key = sessionKey(userId, sessionId);
  if (env.redisUrl) {
    const session = await redisGetSafe<ConversationSession>(key);
    if (!session) return null;
    if (Date.now() - session.lastActivityAt > CONVERSATION_TTL_MS) {
      await redisDelSafe(key);
      return null;
    }
    session.lastActivityAt = Date.now();
    await redisSetSafe(key, session, CONVERSATION_TTL_SEC);
    return session;
  }
  const session = _sessions.get(key);
  if (!session) return null;
  if (Date.now() - session.lastActivityAt > CONVERSATION_TTL_MS) {
    _sessions.delete(key);
    return null;
  }
  session.lastActivityAt = Date.now();
  return session;
}

/** Merge partial fields into a session's collectedFields */
export async function mergeFields(
  sessionId: string,
  userId: string,
  extracted: Record<string, any>,
): Promise<ConversationSession | null> {
  const session = await getSession(sessionId, userId);
  if (!session) return null;
  for (const [key, value] of Object.entries(extracted)) {
    if (value !== null && value !== undefined && value !== "") {
      session.collectedFields[key] = value;
    }
  }
  session.lastActivityAt = Date.now();
  const k = sessionKey(userId, sessionId);
  if (env.redisUrl) await redisSetSafe(k, session, CONVERSATION_TTL_SEC);
  return session;
}

/** Set the task type for a session */
export async function setTaskType(
  sessionId: string,
  userId: string,
  taskType: string,
): Promise<void> {
  const session = await getSession(sessionId, userId);
  if (!session) return;
  session.taskType = taskType;
  if (session.phase === "detecting_task") session.phase = "gathering";
  session.lastActivityAt = Date.now();
  const k = sessionKey(userId, sessionId);
  if (env.redisUrl) await redisSetSafe(k, session, CONVERSATION_TTL_SEC);
}

/** Set the dynamically generated schema for a session */
export async function setSchema(
  sessionId: string,
  userId: string,
  schema: import("./requirementSchemas").RequirementSchema,
): Promise<void> {
  const session = await getSession(sessionId, userId);
  if (!session) return;
  session.schema = schema;
  session.lastActivityAt = Date.now();
  const k = sessionKey(userId, sessionId);
  if (env.redisUrl) await redisSetSafe(k, session, CONVERSATION_TTL_SEC);
}

/** Set the conversation phase */
export async function setPhase(
  sessionId: string,
  userId: string,
  phase: ConversationPhase,
): Promise<void> {
  const session = await getSession(sessionId, userId);
  if (!session) return;
  session.phase = phase;
  session.lastActivityAt = Date.now();
  const k = sessionKey(userId, sessionId);
  if (env.redisUrl) await redisSetSafe(k, session, CONVERSATION_TTL_SEC);
}

/** Append a message to the session history */
export async function appendMessage(
  sessionId: string,
  userId: string,
  role: "agent" | "user",
  content: string,
): Promise<void> {
  const session = await getSession(sessionId, userId);
  if (!session) return;
  session.history.push({ role, content, timestamp: Date.now() });
  if (session.history.length > 20) session.history.splice(0, session.history.length - 20);
  session.lastActivityAt = Date.now();
  const k = sessionKey(userId, sessionId);
  if (env.redisUrl) await redisSetSafe(k, session, CONVERSATION_TTL_SEC);
}

/** Persist an in-memory session object (e.g. after mutating schema/collectedFields). */
export async function persistSession(
  sessionId: string,
  userId: string,
  session: ConversationSession,
): Promise<void> {
  session.lastActivityAt = Date.now();
  const key = sessionKey(userId, sessionId);
  _sessions.set(key, session);
  if (env.redisUrl) await redisSetSafe(key, session, CONVERSATION_TTL_SEC);
}

/** Delete a session (user reset). */
export async function deleteSession(sessionId: string, userId: string): Promise<void> {
  const key = sessionKey(userId, sessionId);
  _sessions.delete(key);
  if (env.redisUrl) await redisDelSafe(key);
  console.log(`[ConversationState] Session deleted: ${key}`);
}

/** Get total active session count (in-memory only; returns 0 when Redis is used). */
export function getActiveSessionCount(): number {
  return env.redisUrl ? 0 : _sessions.size;
}

/**
 * Get last N messages for a session. Optional maxTotalChars trims from oldest (data minimization for LLM).
 */
export async function getRecentMessages(
  sessionId: string,
  userId: string,
  limit: number = 20,
  maxTotalChars?: number,
): Promise<ConversationMessage[]> {
  const session = await getSession(sessionId, userId);
  if (!session || !session.history.length) return [];
  const n = Math.min(Math.max(1, limit), 50);
  let out = session.history.slice(-n);
  if (typeof maxTotalChars === "number" && maxTotalChars > 0) {
    let total = 0;
    for (let i = out.length - 1; i >= 0; i--) {
      total += (out[i].content?.length ?? 0);
      if (total > maxTotalChars) {
        out = out.slice(i + 1);
        break;
      }
    }
  }
  return out;
}
