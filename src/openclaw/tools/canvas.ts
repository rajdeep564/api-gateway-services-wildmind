/**
 * edit_image, upscale_image, remove_background — wire to Canvas/Workflow APIs (agent-facing).
 */

import type { ToolRegistration } from "../types";
import { removeBackground } from "../../services/workflows/general/removeBackgroundService";

export const editImageTool: ToolRegistration = {
  definition: {
    name: "edit_image",
    description: "Edit an existing image (e.g. canvas edit). Use the Canvas app for full editing.",
    parameters: {
      type: "object",
      properties: {
        imageId: { type: "string", description: "Library/generation item ID" },
      },
    },
  },
  handler: async (_args, context) => {
    return {
      message: "Use the Canvas app to edit images.",
      url: "/canvas",
      userId: context.userId,
    };
  },
};

export const upscaleImageTool: ToolRegistration = {
  definition: {
    name: "upscale_image",
    description: "Upscale an image. Use the Canvas app for upscaling.",
    parameters: {
      type: "object",
      properties: {
        imageId: { type: "string", description: "Library item ID" },
      },
    },
  },
  handler: async (_args, context) => {
    return {
      message: "Use the Canvas app to upscale images.",
      url: "/canvas",
      userId: context.userId,
    };
  },
};

/** remove_background — remove background from an image (workflow service). */
export const removeBackgroundTool: ToolRegistration = {
  definition: {
    name: "remove_background",
    description: "Remove the background from an image. Provide a public image URL or data URI.",
    parameters: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "URL or data URI of the image" },
      },
      required: ["imageUrl"],
    },
  },
  handler: async (args, context) => {
    const imageUrl = typeof args.imageUrl === "string" ? args.imageUrl.trim() : "";
    if (!imageUrl) throw new Error("remove_background requires imageUrl");
    const result = await removeBackground(context.userId, { imageUrl });
    return { imageUrl: result.imageUrl, storagePath: result.storagePath, historyId: result.historyId };
  },
};
