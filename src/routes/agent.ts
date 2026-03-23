/**
 * Agent-facing APIs — scoped to req.uid, for use by tool handlers or internal callers.
 * GET /api/agent/assets
 * GET /api/agent/generations/recent
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../middlewares/authMiddleware";
import { generationHistoryService } from "../services/generationHistoryService";

const router = Router();
router.use(requireAuth);

router.get("/assets", async (req: Request, res: Response) => {
  try {
    const uid = (req as any).uid;
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
    const result = await generationHistoryService.listUserGenerations(uid, {
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
    res.json({ ok: true, items, hasMore: result.hasMore ?? false });
  } catch (err: any) {
    console.error("[AgentRoutes] GET /assets error:", err?.message);
    res.status(500).json({ error: "AGENT_API_ERROR", message: err?.message });
  }
});

router.get("/generations/recent", async (req: Request, res: Response) => {
  try {
    const uid = (req as any).uid;
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
    const result = await generationHistoryService.listUserGenerations(uid, {
      limit,
      mode: "all",
    });
    const items = (result.items ?? []).slice(0, limit).map((item: any) => ({
      id: item.id,
      type: item.generationType,
      status: item.status,
      createdAt: item.createdAt,
    }));
    res.json({ ok: true, items, hasMore: result.hasMore ?? false });
  } catch (err: any) {
    console.error("[AgentRoutes] GET /generations/recent error:", err?.message);
    res.status(500).json({ error: "AGENT_API_ERROR", message: err?.message });
  }
});

export default router;
