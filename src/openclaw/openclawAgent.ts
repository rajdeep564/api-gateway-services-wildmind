/**
 * OpenClaw Platform Agent — top layer.
 * Agent loop: think → call tool via controller → observe → repeat (MAX_STEPS).
 * Identity from context only; no userId in tool args.
 */

import { MAX_STEPS, MAX_TOOL_CALLS_PER_TURN, type AgentContext } from "./types";
import { executeTool } from "./toolExecutionController";
import { listTools } from "./toolRegistry";

const CREDIT_INTENT_PATTERN = /credit|balance|how many.*(have|left)|credits left/i;

function wantsCreditBalance(message: string): boolean {
  return CREDIT_INTENT_PATTERN.test(message.trim());
}

/**
 * Run the agent loop: decide tool or reply, execute via controller, return result.
 * Without an LLM that returns tool calls, we use intent heuristics and call at most one tool per turn for now.
 */
export async function runOpenClawTurn(
  message: string,
  sessionId: string,
  context: Omit<AgentContext, "sessionId">
): Promise<{ type: "tool_result"; result: unknown } | { type: "reply"; content: string }> {
  const fullContext: AgentContext = {
    ...context,
    sessionId,
  };
  const tools = listTools();
  let toolCallsThisTurn = 0;

  // Intent: credit balance
  if (wantsCreditBalance(message) && toolCallsThisTurn < MAX_TOOL_CALLS_PER_TURN) {
    const res = await executeTool("get_credit_balance", {}, fullContext);
    toolCallsThisTurn++;
    if (res.success && res.result && typeof res.result === "object" && "credits" in res.result) {
      const credits = (res.result as { credits: number }).credits;
      return { type: "reply", content: `You have ${credits} credits available.` };
    }
  }

  // Default: generation flow (generate_content)
  for (let step = 0; step < MAX_STEPS && toolCallsThisTurn < MAX_TOOL_CALLS_PER_TURN; step++) {
    const res = await executeTool(
      "generate_content",
      { message, sessionId },
      fullContext
    );
    toolCallsThisTurn++;
    if (!res.success) {
      return { type: "reply", content: `Something went wrong: ${res.error ?? "unknown error"}.` };
    }
    return { type: "tool_result", result: res.result };
  }

  return { type: "reply", content: "I'm not sure how to help with that. You can ask to create an image, video, or logo, or ask for your credit balance." };
}
