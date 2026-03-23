/**
 * WildMind Tool API (for OpenClaw Gateway and other agent runtimes)
 *
 * Mounts at: /api/tools
 *
 * POST /api/tools/invoke  — Invoke a tool by name (allowlisted via toolRegistry)
 * GET  /api/tools/schemas — (Optional) List tool definitions (name/desc/params)
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/authMiddleware";
import { hasTool, listTools } from "../openclaw/toolRegistry";
import { executeTool } from "../openclaw/toolExecutionController";
import type { AgentContext } from "../openclaw/types";
import { logAudit } from "../utils/complianceLog";

type ToolInvokeRequestBody = {
  tool?: unknown;
  args?: unknown;
};

type ToolErrorCode =
  | "UNKNOWN_TOOL"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "MODEL_TIMEOUT"
  | "NOT_IMPLEMENTED"
  | "INTERNAL_ERROR";

const APPROVAL_REQUIRED_TOOLS = new Set(["delete_asset", "upgrade_plan"]);

function inferToken(req: Request): string | undefined {
  const cookieToken = (req as any).cookies?.app_session as string | undefined;
  if (cookieToken && typeof cookieToken === "string" && cookieToken.trim()) return cookieToken;

  const authHeader =
    (req.headers.authorization as string | undefined) ??
    ((req.headers as any).Authorization as string | undefined);
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    const t = authHeader.replace(/^Bearer\s+/i, "").trim();
    return t || undefined;
  }
  return undefined;
}

function mapErrorToCode(message: string): { error_code: ToolErrorCode; retryable: boolean } {
  const m = message.toLowerCase();
  if (m.includes("unknown tool")) return { error_code: "UNKNOWN_TOOL", retryable: false };
  if (m.includes("rate limit")) return { error_code: "RATE_LIMITED", retryable: true };
  if (m.includes("missing required argument") || m.includes("must be a")) {
    return { error_code: "VALIDATION_ERROR", retryable: false };
  }
  if (m.includes("not implemented")) return { error_code: "NOT_IMPLEMENTED", retryable: false };
  if (m.includes("timeout")) return { error_code: "MODEL_TIMEOUT", retryable: true };
  return { error_code: "INTERNAL_ERROR", retryable: false };
}

export default function toolsRoutes(): Router {
  const router = Router();

  router.use(requireAuth);

  router.post("/invoke", async (req: Request, res: Response) => {
    const userId = (req as any).uid as string;
    const requestId = (req as any).requestId ?? `req-${Date.now()}`;
    const token = inferToken(req);

    const body = (req.body ?? {}) as ToolInvokeRequestBody;
    const tool = body.tool;
    const args = body.args;

    if (!tool || typeof tool !== "string" || !tool.trim()) {
      res.status(400).json({
        success: false,
        error_code: "VALIDATION_ERROR",
        error_message: "tool is required and must be a non-empty string",
        retryable: false,
      });
      return;
    }
    if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
      res.status(400).json({
        success: false,
        error_code: "VALIDATION_ERROR",
        error_message: "args must be an object when provided",
        retryable: false,
      });
      return;
    }

    if (!hasTool(tool)) {
      logAudit({
        type: "tool_call",
        userId,
        requestId,
        action: tool,
        meta: { success: false, error_code: "UNKNOWN_TOOL" },
      });
      res.status(400).json({
        success: false,
        error_code: "UNKNOWN_TOOL",
        error_message: `Unknown tool: ${tool}`,
        retryable: false,
      });
      return;
    }

    const argsObj = (args ?? {}) as Record<string, unknown>;
    const sessionId = typeof argsObj.sessionId === "string" ? argsObj.sessionId : "default";
    const context: AgentContext = { userId, sessionId, requestId, token };

    // Approval gate (v1): block sensitive tools unless caller explicitly marks approved.
    // Future: replace with planStore/orchestrator integration for real approvals.
    if (APPROVAL_REQUIRED_TOOLS.has(tool) && req.headers["x-wildmind-approved"] !== "true") {
      logAudit({
        type: "tool_call",
        userId,
        requestId,
        action: tool,
        meta: { approval_required: true },
      });
      res.json({
        success: true,
        approval_required: true,
        planId: requestId,
        result: { tool, args: argsObj },
      });
      return;
    }

    const result = await executeTool(tool, argsObj, context);
    if (result.success) {
      res.json({ success: true, result: result.result });
      return;
    }

    const mapped = mapErrorToCode(result.error ?? "unknown error");
    res.status(mapped.error_code === "UNKNOWN_TOOL" || mapped.error_code === "VALIDATION_ERROR" ? 400 : 500).json({
      success: false,
      error_code: mapped.error_code,
      error_message: result.error ?? "unknown error",
      retryable: mapped.retryable,
    });
  });

  router.get("/schemas", (_req: Request, res: Response) => {
    const schemas = listTools().map((t) => t.definition);
    res.json({ success: true, tools: schemas });
  });

  return router;
}

