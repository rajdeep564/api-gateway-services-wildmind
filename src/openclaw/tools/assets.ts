/**
 * get_user_assets / get_recent_generations / get_asset / delete_asset — wire to library/generations (agent-facing).
 */

import type { ToolRegistration } from "../types";
import { generationHistoryService } from "../../services/generationHistoryService";

export const getUserAssetsTool: ToolRegistration = {
  definition: {
    name: "get_user_assets",
    description: "List the user's generated assets (images, videos) from their library. Returns a summary of recent items.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max items to return (default 10)" },
      },
    },
  },
  handler: async (args, context) => {
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
    const result = await generationHistoryService.listUserGenerations(context.userId, {
      limit,
      mode: "all",
    });
    const items = (result.items ?? []).slice(0, limit).map((item: any) => ({
      id: item.id,
      type: item.generationType,
      status: item.status,
      createdAt: item.createdAt,
      imageCount: item.images?.length ?? 0,
      videoCount: item.videos?.length ?? 0,
    }));
    return { items, hasMore: result.hasMore ?? false };
  },
};

export const getRecentGenerationsTool: ToolRegistration = {
  definition: {
    name: "get_recent_generations",
    description: "Get the user's most recent generations (library items). Same as get_user_assets with default limit.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max items (default 10)" },
      },
    },
  },
  handler: async (args, context) => {
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
    const result = await generationHistoryService.listUserGenerations(context.userId, {
      limit,
      mode: "all",
    });
    const items = (result.items ?? []).slice(0, limit).map((item: any) => ({
      id: item.id,
      type: item.generationType,
      status: item.status,
      createdAt: item.createdAt,
    }));
    return { items, hasMore: result.hasMore ?? false };
  },
};

/** get_asset — fetch a single generation (library item) by id (historyId). */
export const getAssetTool: ToolRegistration = {
  definition: {
    name: "get_asset",
    description: "Get a single asset (generation) by its id. Use the id from get_recent_generations or get_user_assets.",
    parameters: {
      type: "object",
      properties: {
        assetId: { type: "string", description: "Generation/history id of the asset" },
      },
      required: ["assetId"],
    },
  },
  handler: async (args, context) => {
    const assetId = typeof args.assetId === "string" ? args.assetId.trim() : "";
    if (!assetId) throw new Error("get_asset requires assetId");
    const item = await generationHistoryService.getUserGeneration(context.userId, assetId);
    if (!item) return { found: false, assetId };
    return {
      found: true,
      id: (item as any).id ?? assetId,
      generationType: (item as any).generationType,
      status: (item as any).status,
      createdAt: (item as any).createdAt,
      images: (item as any).images ?? [],
      videos: (item as any).videos ?? [],
    };
  },
};

/** delete_asset — soft-delete a generation by id (historyId). Requires approval at Tool API layer. */
export const deleteAssetTool: ToolRegistration = {
  definition: {
    name: "delete_asset",
    description: "Delete an asset (generation) from the user's library by id. Requires user approval.",
    parameters: {
      type: "object",
      properties: {
        assetId: { type: "string", description: "Generation/history id of the asset to delete" },
      },
      required: ["assetId"],
    },
  },
  handler: async (args, context) => {
    const assetId = typeof args.assetId === "string" ? args.assetId.trim() : "";
    if (!assetId) throw new Error("delete_asset requires assetId");
    await generationHistoryService.softDelete(context.userId, assetId);
    return { deleted: true, assetId };
  },
};
