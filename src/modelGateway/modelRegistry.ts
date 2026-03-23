/**
 * AI model registry — governance: allowed models, versioning, change audit.
 * Plan: model registry; prompt template versioning; change audit for prompts and models.
 */

export const ALLOWED_LLM_MODELS = [
  "openai/gpt-5",
  "openai/gpt-5-nano",
] as const;

export type AllowedLLMModel = (typeof ALLOWED_LLM_MODELS)[number];

export function isAllowedLLMModel(model: string): model is AllowedLLMModel {
  return (ALLOWED_LLM_MODELS as readonly string[]).includes(model);
}
