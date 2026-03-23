/**
 * PII redaction before sending to LLM (SOC2 / security foundations).
 * Redacts or masks common PII so it is not sent to external providers.
 */

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /\b(?:\+?1[-.]?)?\(?[0-9]{3}\)?[-.]?[0-9]{3}[-.]?[0-9]{4}\b/g;
const REDACT_PLACEHOLDER = "[REDACTED]";

/**
 * Redact common PII from text. Returns redacted string; does not mutate input.
 */
export function redactPii(text: string): string {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  out = out.replace(EMAIL_RE, REDACT_PLACEHOLDER);
  out = out.replace(PHONE_RE, REDACT_PLACEHOLDER);
  return out;
}

/**
 * Returns true if text appears to contain PII (call before sending to LLM).
 */
export function containsPii(text: string): boolean {
  if (typeof text !== "string" || !text) return false;
  return EMAIL_RE.test(text) || PHONE_RE.test(text);
}
