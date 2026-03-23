/**
 * WildMind — Conversation Controller
 *
 * Handles multi-turn requirement gathering conversations.
 *
 * POST /api/assistant/converse    — process one conversation turn
 * DELETE /api/assistant/converse/:sessionId — reset / clear a session
 */

import type { Request, Response } from "express";
import {
  processConversationTurn,
  resetSession,
} from "../assistant/conversationAgent";
import { getActiveSessionCount, getRecentMessages } from "../assistant/conversationState";
import { MAX_PROMPT_LENGTH } from "../openclaw/types";
import { validateReferenceUrls } from "../utils/referenceUrlAllowlist";
import { logAudit } from "../utils/complianceLog";

// ── POST /api/assistant/converse ──────────────────────────────────────────────

export async function converseHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = (req as any).uid as string;
  const { message, sessionId, referenceImageUrls } = req.body;

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
      message: "sessionId is required (generate a UUID on the frontend per browser session)",
    });
    return;
  }

  if (message.trim().length > MAX_PROMPT_LENGTH) {
    res.status(400).json({
      error: "MESSAGE_TOO_LONG",
      message: `message must be ${MAX_PROMPT_LENGTH} characters or fewer`,
    });
    return;
  }

  // Optional: URLs of reference images user uploaded (from frontend)
  const refUrls = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter((u: any) => typeof u === "string" && u.trim())
    : undefined;

  if (refUrls?.length) {
    const refCheck = validateReferenceUrls(refUrls);
    if (!refCheck.valid) {
      res.status(400).json({
        error: "INVALID_REFERENCE_URL",
        message: refCheck.reason,
      });
      return;
    }
  }

  const requestId = (req as any).requestId ?? `converse-${Date.now()}-${userId}`;

  try {
    const response = await processConversationTurn({
      sessionId,
      userId,
      userMessage: message.trim(),
      referenceImageUrls: refUrls?.length ? refUrls : undefined,
      requestId,
    });

    res.json({
      ok: true,
      ...response,
    });
  } catch (err: any) {
    console.error("[ConversationController] converseHandler error:", err?.message);
    res.status(500).json({
      error: "CONVERSATION_ERROR",
      message: err?.message ?? "Conversation processing failed",
    });
  }
}

// ── DELETE /api/assistant/converse/:sessionId ─────────────────────────────────

export async function resetConversation(req: Request, res: Response): Promise<void> {
  const userId = (req as any).uid as string;
  const { sessionId } = req.params;
  if (!sessionId) {
    res.status(400).json({ error: "MISSING_SESSION_ID" });
    return;
  }
  await resetSession(sessionId, userId);
  logAudit({ type: "conversation_reset", userId, action: "reset", meta: { sessionId } });
  res.json({ ok: true, message: "Session reset" });
}

// ── GET /api/assistant/context (conversation context for agents) ─────────────────

export async function getConversationContext(req: Request, res: Response): Promise<void> {
  const userId = (req as any).uid as string;
  const sessionId = req.query.sessionId as string;
  const limitRaw = req.query.limit as string | undefined;
  const maxTotalCharsRaw = req.query.maxTotalChars as string | undefined;
  if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
    res.status(400).json({
      error: "MISSING_SESSION_ID",
      message: "query sessionId is required",
    });
    return;
  }
  const limit = limitRaw ? Math.min(50, Math.max(1, parseInt(limitRaw, 10) || 20)) : 20;
  const maxTotalChars = maxTotalCharsRaw
    ? Math.min(100_000, Math.max(1000, parseInt(maxTotalCharsRaw, 10) || 0))
    : undefined;
  const messages = await getRecentMessages(sessionId, userId, limit, maxTotalChars);
  res.json({ ok: true, messages });
}

// ── GET /api/assistant/health (internal monitoring) ────────────────────────────

export function conversationHealth(_req: Request, res: Response): void {
  res.json({ activeSessions: getActiveSessionCount() });
}
