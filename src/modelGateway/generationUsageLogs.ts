/**
 * Generation usage logging for cost tracking (plan: generation_usage_logs / ai_usage_logs).
 * Complements aiUsageLogs (LLM); records each generation step (FAL, Replicate, MiniMax, BFL, Runway).
 * Set GENERATION_USAGE_LOG_FILE to a path for append-only file persistence (SOC2).
 */

import * as fs from "fs";

export interface GenerationUsageEntry {
  userId: string;
  requestId: string;
  provider: string;
  model: string;
  credits: number;
  stepId?: string;
  createdAt: number;
}

const buffer: GenerationUsageEntry[] = [];
const MAX_BUFFER = 10_000;

const GENERATION_USAGE_LOG_FILE = process.env.GENERATION_USAGE_LOG_FILE?.trim() || undefined;

function appendToUsageFile(entry: GenerationUsageEntry): void {
  if (!GENERATION_USAGE_LOG_FILE) return;
  try {
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(GENERATION_USAGE_LOG_FILE, line, "utf8");
  } catch (e) {
    console.warn("[GenerationUsage] Failed to append to file:", (e as Error)?.message);
  }
}

export function logGenerationUsage(
  entry: Omit<GenerationUsageEntry, "createdAt">,
): void {
  const full: GenerationUsageEntry = { ...entry, createdAt: Date.now() };
  buffer.push(full);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  if (GENERATION_USAGE_LOG_FILE) appendToUsageFile(full);
}

export function getGenerationUsageBuffer(): GenerationUsageEntry[] {
  return [...buffer];
}
