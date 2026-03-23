/**
 * search_similar_creations — semantic search over user's past creations (vector memory).
 * Uses memory/vectorMemory stub until pgvector is implemented.
 */

import type { ToolRegistration } from "../types";
import { searchSimilarCreations } from "../../memory/vectorMemory";

export const searchSimilarCreationsTool: ToolRegistration = {
  definition: {
    name: "search_similar_creations",
    description: "Search the user's past creations by semantic similarity to a text query. Returns matching items with relevance scores. (Stub: returns empty until vector store is implemented.)",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language search query" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },
  handler: async (args, context) => {
    const query = String(args.query ?? "").trim();
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
    const items = await searchSimilarCreations(context.userId, query, limit);
    return { items, query };
  },
};
