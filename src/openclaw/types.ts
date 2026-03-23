/**
 * OpenClaw — shared types for agent context and tools.
 */

export interface AgentContext {
  userId: string;
  sessionId: string;
  requestId: string;
  token?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: AgentContext
) => Promise<unknown>;

export interface ToolRegistration {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export const MAX_TOOL_CALLS_PER_TURN = 10;
export const MAX_STEPS = 5;
export const MAX_PROMPT_LENGTH = 8000;
export const MAX_PLAN_COST = 10000;
