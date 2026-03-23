/**
 * Execution memory (AgentState) — plan Phase 4.
 * Store at agent:state:{userId}:{sessionId} so "actually make it a video ad" can clear and rebuild.
 * Redis when available; in-memory fallback for dev.
 */

import { env } from "../config/env";
import { redisDelSafe, redisGetSafe, redisSetSafe } from "../config/redisClient";

const AGENT_STATE_TTL_SEC = 30 * 60; // 30 min, refresh on activity
const KEY_PREFIX = "agent:state:";

function stateKey(userId: string, sessionId: string): string {
  const prefix = env.redisPrefix || "";
  return `${prefix}${KEY_PREFIX}${userId}:${sessionId}`;
}

export interface AgentState {
  taskType: string | null;
  spec: Record<string, unknown> | null;
  schema: unknown | null; // RequirementSchema from assistant
  plan: unknown | null;
  planId: string | null;
  approved: boolean;
  history: Array<{ role: string; content: string; timestamp: number }>;
  schemaRevisionCount: number;
  updatedAt: number;
}

export function emptyAgentState(): AgentState {
  return {
    taskType: null,
    spec: null,
    schema: null,
    plan: null,
    planId: null,
    approved: false,
    history: [],
    schemaRevisionCount: 0,
    updatedAt: Date.now(),
  };
}

const _memoryFallback = new Map<string, AgentState>();

export async function getAgentState(
  userId: string,
  sessionId: string
): Promise<AgentState | null> {
  const key = stateKey(userId, sessionId);
  if (env.redisUrl) {
    const val = await redisGetSafe<AgentState>(key);
    return val ?? null;
  }
  return _memoryFallback.get(key) ?? null;
}

export async function setAgentState(
  userId: string,
  sessionId: string,
  state: AgentState,
  ttlSeconds: number = AGENT_STATE_TTL_SEC
): Promise<void> {
  const key = stateKey(userId, sessionId);
  const toStore = { ...state, updatedAt: Date.now() };
  if (env.redisUrl) {
    await redisSetSafe(key, toStore, ttlSeconds);
    return;
  }
  _memoryFallback.set(key, toStore);
}

export async function deleteAgentState(
  userId: string,
  sessionId: string
): Promise<void> {
  const key = stateKey(userId, sessionId);
  if (env.redisUrl) await redisDelSafe(key);
  else _memoryFallback.delete(key);
}

export async function getOrCreateAgentState(
  userId: string,
  sessionId: string
): Promise<AgentState> {
  const existing = await getAgentState(userId, sessionId);
  if (existing) return existing;
  const state = emptyAgentState();
  await setAgentState(userId, sessionId, state);
  return state;
}
