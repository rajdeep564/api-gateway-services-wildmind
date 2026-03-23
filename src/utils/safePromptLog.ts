/**
 * Safe prompt logging — SOC2 critical fix.
 * Do not log full prompts in general logs. Log only prompt_length, prompt_hash, and model.
 */

import { createHash } from "crypto";

export interface SafePromptMeta {
  prompt_length: number;
  prompt_hash: string;
  model?: string;
}

/**
 * Compute safe metadata for a prompt (for logging). Uses first 16 chars of hex SHA-256 when available.
 */
export function safePromptMeta(prompt: string, model?: string): SafePromptMeta {
  const prompt_length = typeof prompt === "string" ? prompt.length : 0;
  let prompt_hash = "";
  if (typeof prompt === "string" && prompt.length > 0) {
    try {
      const hash = createHash("sha256").update(prompt, "utf8").digest("hex");
      prompt_hash = hash.slice(0, 16);
    } catch {
      prompt_hash = "(hash-unavailable)";
    }
  }
  return { prompt_length, prompt_hash, model };
}

/**
 * Format safe prompt meta for a log line (no full prompt).
 */
export function formatSafePromptLog(meta: SafePromptMeta): string {
  const parts = [`prompt_length=${meta.prompt_length}`, `prompt_hash=${meta.prompt_hash}`];
  if (meta.model) parts.push(`model=${meta.model}`);
  return parts.join(" ");
}
