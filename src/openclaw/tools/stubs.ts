/**
 * Stub tools for the OpenClaw allowlist — not yet implemented in WildMind.
 */

import type { ToolRegistration } from "../types";

function notImplemented(name: string, description?: string): ToolRegistration {
  return {
    definition: {
      name,
      description: description ?? `Not implemented in WildMind yet: ${name}`,
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      throw new Error(`${name} not implemented`);
    },
  };
}

export const addTextTool = notImplemented("add_text", "Add text overlay to an image. Not yet implemented.");
export const addToPortfolioTool = notImplemented("add_to_portfolio", "Add an asset to portfolio. Use the Library UI.");
export const getUserStyleTool = notImplemented("get_user_style", "Get the user's saved style preferences. Not yet implemented.");
export const saveUserPreferenceTool = notImplemented("save_user_preference", "Save a user preference. Not yet implemented.");
