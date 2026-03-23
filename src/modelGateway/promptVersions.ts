/**
 * Prompt template versioning — AI governance and change audit.
 * Bump version when system prompts change; logged in ai_usage_logs for traceability.
 */

export const PROMPT_VERSIONS = {
  /** Planner system prompt (plannerSystemPrompt.ts) */
  PLANNER: "1.0",
  /** Requirement extractor: schema gen, task detection, extraction, follow-up (requirementExtractor.ts) */
  REQUIREMENT_EXTRACTOR: "1.0",
} as const;

export type PromptTemplateId = keyof typeof PROMPT_VERSIONS;
