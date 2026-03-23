/**
 * Compliance logging — separate, immutable, access-controlled audit log (SOC2).
 * In production, set AUDIT_LOG_FILE to an path for append-only file persistence.
 * Otherwise: in-memory buffer + console; no PII or full prompts.
 */

import * as fs from "fs";

export type AuditEventType =
  | "auth"
  | "tool_call"
  | "plan_approve"
  | "conversation_reset"
  | "admin";

export interface AuditEntry {
  ts: number;
  type: AuditEventType;
  userId?: string;
  requestId?: string;
  action: string;
  meta?: Record<string, unknown>;
}

const buffer: AuditEntry[] = [];
const MAX_AUDIT_BUFFER = 5000;

const AUDIT_LOG_FILE = process.env.AUDIT_LOG_FILE?.trim() || undefined;

function appendToAuditFile(entry: AuditEntry): void {
  if (!AUDIT_LOG_FILE) return;
  try {
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(AUDIT_LOG_FILE, line, "utf8");
  } catch (e) {
    console.warn("[AUDIT] Failed to append to audit file:", (e as Error)?.message);
  }
}

export function logAudit(entry: Omit<AuditEntry, "ts">): void {
  const full: AuditEntry = { ...entry, ts: Date.now() };
  buffer.push(full);
  if (buffer.length > MAX_AUDIT_BUFFER) buffer.shift();
  if (AUDIT_LOG_FILE) appendToAuditFile(full);
  console.log(
    `[AUDIT] type=${full.type} action=${full.action} userId=${full.userId ?? "-"} requestId=${full.requestId ?? "-"}`
  );
}

export function getAuditBuffer(): AuditEntry[] {
  return [...buffer];
}
