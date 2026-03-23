/**
 * navigate_page — return URL or instruction for UI (agent-facing).
 */

import type { ToolRegistration } from "../types";

const PAGE_MAP: Record<string, string> = {
  canvas: "/canvas",
  gallery: "/library",
  library: "/library",
  credits: "/credits",
  account: "/account",
  upgrade: "/subscription",
  subscription: "/subscription",
};

export const navigatePageTool: ToolRegistration = {
  definition: {
    name: "navigate_page",
    description: "Navigate the user to a page in the app (canvas, gallery, credits, account, upgrade).",
    parameters: {
      type: "object",
      properties: {
        page: { type: "string", description: "Page key: canvas, gallery, library, credits, account, upgrade" },
      },
      required: ["page"],
    },
  },
  handler: async (args, _context) => {
    const page = String(args.page ?? "").trim().toLowerCase();
    const path = PAGE_MAP[page] ?? null;
    return { page, path: path ?? "/", message: path ? `Open ${path}` : "Unknown page." };
  },
};
