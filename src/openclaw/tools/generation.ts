/**
 * generate_content — invokes existing Generation Agent path (conversation → spec → plan).
 */

import type { ToolRegistration } from "../types";
import { processConversationTurn } from "../../assistant/conversationAgent";

export const generateContentTool: ToolRegistration = {
  definition: {
    name: "generate_content",
    description: "Start or continue a creative generation: image, logo, video, video ad, or music. Send the user's message to gather requirements and get a spec or plan.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "User's message describing what they want to create" },
        sessionId: { type: "string", description: "Conversation session ID" },
      },
      required: ["message", "sessionId"],
    },
  },
  handler: async (args, context) => {
    const message = args.message as string;
    const sessionId = args.sessionId as string;
    if (!message || typeof message !== "string" || !sessionId || typeof sessionId !== "string") {
      throw new Error("generate_content requires message and sessionId");
    }
    // Legacy tool kept for compatibility with older prompts.
    // The v2 assistant loop uses generate_requirement_schema + gather_requirements + preview_plan + execute_plan.
    return await processConversationTurn({
      sessionId,
      userId: context.userId,
      userMessage: message.trim(),
      requestId: context.requestId,
    });
  },
};
