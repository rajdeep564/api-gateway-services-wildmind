/**
 * generate_logo, generate_image, generate_video, generate_music — alias to generate_content with task-type hint.
 */

import type { ToolRegistration } from "../types";
import { processConversationTurn } from "../../assistant/conversationAgent";

const TASK_PREFIX: Record<string, string> = {
  generate_logo: "I want to create a logo. ",
  generate_image: "I want to create an image. ",
  generate_video: "I want to create a video. ",
  generate_music: "I want to create music. ",
};

function makeAlias(name: string, description: string): ToolRegistration {
  const prefix = TASK_PREFIX[name] ?? "";
  return {
    definition: {
      name,
      description,
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "User's message describing what they want" },
          sessionId: { type: "string", description: "Conversation session ID" },
        },
        required: ["message", "sessionId"],
      },
    },
    handler: async (args, context) => {
      const message = args.message as string;
      const sessionId = args.sessionId as string;
      if (!message || typeof message !== "string" || !sessionId || typeof sessionId !== "string") {
        throw new Error(`${name} requires message and sessionId`);
      }
      const userMessage = prefix + message.trim();
      const response = await processConversationTurn({
        sessionId,
        userId: context.userId,
        userMessage,
      });
      return response;
    },
  };
}

export const generateLogoTool = makeAlias(
  "generate_logo",
  "Start or continue a logo generation. Send the user's message; requirements are gathered via conversation."
);
export const generateImageTool = makeAlias(
  "generate_image",
  "Start or continue an image generation. Send the user's message; requirements are gathered via conversation."
);
export const generateVideoTool = makeAlias(
  "generate_video",
  "Start or continue a video generation. Send the user's message; requirements are gathered via conversation."
);
export const generateMusicTool = makeAlias(
  "generate_music",
  "Start or continue a music generation. Send the user's message; requirements are gathered via conversation."
);
