/**
 * OpenClaw — HTTP controller.
 * POST /api/assistant/openclaw: one turn through the agent (tools only via controller).
 */

import type { Request, Response } from "express";
import { MAX_PROMPT_LENGTH } from "./types";
import { runOpenClawTurn } from "./openclawAgent";

export async function openclawHandler(req: Request, res: Response): Promise<void> {
  const userId = (req as any).uid as string;
  const { message, sessionId } = req.body ?? {};

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({
      error: "MISSING_MESSAGE",
      message: "message is required and must be a non-empty string",
    });
    return;
  }
  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({
      error: "MISSING_SESSION_ID",
      message: "sessionId is required",
    });
    return;
  }
  if (message.length > MAX_PROMPT_LENGTH) {
    res.status(400).json({
      error: "MESSAGE_TOO_LONG",
      message: `message must be ${MAX_PROMPT_LENGTH} characters or fewer`,
    });
    return;
  }

  const requestId = (req as any).requestId ?? `req-${Date.now()}`;

  try {
    const outcome = await runOpenClawTurn(message.trim(), sessionId, {
      userId,
      requestId,
      token: (req as any).token,
    });

    if (outcome.type === "reply") {
      res.json({ ok: true, type: "reply", content: outcome.content });
      return;
    }
    res.json({ ok: true, type: "tool_result", result: outcome.result });
  } catch (err: any) {
    console.error("[OpenClawController] error:", err?.message);
    res.status(500).json({
      error: "OPENCLAW_ERROR",
      message: err?.message ?? "Agent processing failed",
    });
  }
}
