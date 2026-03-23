import { Request, Response, NextFunction } from "express";

/**
 * Synchronous content moderation for user prompts and assistant flow.
 * Rejects requests when body.message or body.prompt contains blocklisted tokens.
 * Production: wire to OpenAI Moderation API or similar for full coverage.
 */
const BLOCKLIST_TOKENS = [
  /\b(child\s*porn|csam|underage\s*sex)\b/gi,
  /\b(hack\s*into|ddos\s*attack|inject\s*sql)\b/gi,
];

function getTextToModerate(req: Request): string | null {
  const body = req.body as Record<string, unknown>;
  if (body?.message && typeof body.message === "string") return body.message;
  if (body?.prompt && typeof body.prompt === "string") return body.prompt;
  return null;
}

export function contentModerationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const text = getTextToModerate(req);
  if (!text || !text.trim()) return next();

  const lower = text.trim().toLowerCase();
  for (const pattern of BLOCKLIST_TOKENS) {
    if (pattern.test(lower)) {
      res.status(400).json({
        error: "CONTENT_MODERATION",
        message: "Your message was rejected by content policy.",
      });
      return;
    }
  }
  return next();
}
