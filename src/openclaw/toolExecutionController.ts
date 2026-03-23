/**
 * Tool Execution Controller — single entry point for all tool execution.
 * OpenClaw never calls handlers directly; it only calls executeTool.
 * Enforces: resolve from registry, permission (context.userId), rate limit, args validation (JSON Schema–style), logging, optional retry for read-only tools.
 */

import type { AgentContext, ToolDefinition } from "./types";
import { getTool } from "./toolRegistry";
import { logAudit } from "../utils/complianceLog";

const callsThisMinute = new Map<string, number>();
const MINUTE_MS = 60 * 1000;
const MAX_CALLS_PER_USER_PER_MINUTE = 30;

/** Read-only tools: safe to retry once on transient failure */
const READ_ONLY_TOOLS = new Set([
  "get_credit_balance",
  "get_user_assets",
  "get_recent_generations",
  "get_asset",
  "search_similar_creations",
  "navigate_page",
]);

function rateLimitKey(context: AgentContext, toolName: string): string {
  return `tool:${context.userId}:${toolName}:${Math.floor(Date.now() / MINUTE_MS)}`;
}

function checkRateLimit(context: AgentContext, toolName: string): boolean {
  const key = rateLimitKey(context, toolName);
  const count = callsThisMinute.get(key) ?? 0;
  if (count >= MAX_CALLS_PER_USER_PER_MINUTE) return false;
  callsThisMinute.set(key, count + 1);
  return true;
}

/** Validate args against tool definition (required fields and types). */
function validateArgs(
  definition: ToolDefinition,
  args: Record<string, unknown>
): { valid: true } | { valid: false; error: string } {
  const { properties = {}, required = [] } = definition.parameters ?? {};
  for (const key of required) {
    const val = args[key];
    if (val === undefined || val === null) {
      return { valid: false, error: `Missing required argument: ${key}` };
    }
  }
  for (const [key, val] of Object.entries(args)) {
    const prop = properties[key];
    if (!prop) continue;
    const t = prop.type as string;
    if (t === "string" && typeof val !== "string") return { valid: false, error: `Argument ${key} must be a string` };
    if (t === "number" && typeof val !== "number") return { valid: false, error: `Argument ${key} must be a number` };
    if (t === "boolean" && typeof val !== "boolean") return { valid: false, error: `Argument ${key} must be a boolean` };
  }
  return { valid: true };
}

export interface ExecuteToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * Execute a tool by name. Validates tool exists, rate limit, then runs handler.
 * Identity is always from context.userId; no userId in args.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: AgentContext
): Promise<ExecuteToolResult> {
  const start = Date.now();
  const registration = getTool(name);
  if (!registration) {
    return {
      success: false,
      error: `Unknown tool: ${name}`,
      durationMs: Date.now() - start,
    };
  }
  if (!checkRateLimit(context, name)) {
    return {
      success: false,
      error: "Rate limit exceeded",
      durationMs: Date.now() - start,
    };
  }
  const validation = validateArgs(registration.definition, args);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      durationMs: Date.now() - start,
    };
  }
  const run = async (): Promise<ExecuteToolResult> => {
    const result = await registration.handler(args, context);
    const durationMs = Date.now() - start;
    logAudit({
      type: "tool_call",
      userId: context.userId,
      requestId: context.requestId,
      action: name,
      meta: { success: true, durationMs },
    });
    console.log(
      `[ToolExecutionController] tool=${name} userId=${context.userId} requestId=${context.requestId} success=true durationMs=${durationMs}`
    );
    return { success: true, result, durationMs };
  };
  try {
    return await run();
  } catch (err: any) {
    if (READ_ONLY_TOOLS.has(name)) {
      try {
        return await run();
      } catch (retryErr: any) {
        // fall through to same error handling
        err = retryErr;
      }
    }
    const durationMs = Date.now() - start;
    const message = err?.message ?? String(err);
    logAudit({
      type: "tool_call",
      userId: context.userId,
      requestId: context.requestId,
      action: name,
      meta: { success: false, error: message, durationMs },
    });
    console.log(
      `[ToolExecutionController] tool=${name} userId=${context.userId} requestId=${context.requestId} success=false error=${message} durationMs=${durationMs}`
    );
    return { success: false, error: message, durationMs };
  }
}
