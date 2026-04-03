import type { ChatModeModelId } from '../services/genai/assistantMultiModelService';

export const AGENT_DEFAULT_MODEL_ID = 'openai/gpt-5-nano';

export const CHAT_MODEL_CONFIGS: Record<ChatModeModelId, { label: string; fallbackCreditCost: number }> = {
  'google/gemini-3.1-pro': {
    label: 'Gemini 3.1 Pro',
    fallbackCreditCost: 1,
  },
  'google/gemini-2.5-flash': {
    label: 'Gemini 2.5 Flash',
    fallbackCreditCost: 1,
  },
  'anthropic/claude-opus-4.6': {
    label: 'Claude Opus 4.6',
    fallbackCreditCost: 1,
  },
  'openai/gpt-5.2': {
    label: 'GPT-5.2',
    fallbackCreditCost: 1,
  },
  'deepseek-ai/deepseek-v3.1': {
    label: 'DeepSeek V3.1',
    fallbackCreditCost: 1,
  },
};

export const CHAT_MODE_MODEL_IDS = Object.keys(CHAT_MODEL_CONFIGS) as ChatModeModelId[];

export function isChatModeModelId(value: string): value is ChatModeModelId {
  return CHAT_MODE_MODEL_IDS.includes(value as ChatModeModelId);
}
