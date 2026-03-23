/**
 * AI usage logging for cost tracking (plan: ai_usage_logs table).
 * In production, write to DB table ai_usage_logs (userId, requestId, provider, model, inputTokens, outputTokens, cost, createdAt).
 * Here: in-memory buffer and optional file append for dev.
 */

export interface AiUsageEntry {
  userId: string;
  requestId: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  /** AI governance: which prompt template version was used (e.g. PLANNER=1.0) */
  promptTemplateVersion?: string;
  createdAt: number;
}

const buffer: AiUsageEntry[] = [];
const MAX_BUFFER = 10_000;

export function logAiUsage(entry: Omit<AiUsageEntry, "createdAt">): void {
  const full: AiUsageEntry = { ...entry, createdAt: Date.now() };
  buffer.push(full);
  if (buffer.length > MAX_BUFFER) buffer.shift();
}

export function getAiUsageBuffer(): AiUsageEntry[] {
  return [...buffer];
}
