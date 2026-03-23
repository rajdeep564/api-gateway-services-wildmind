/**
 * Tool Registry — single place that maps tool name → definition + handler.
 * Only explicitly registered tools exist (closed registry).
 */

import type { ToolRegistration } from "./types";

const registry = new Map<string, ToolRegistration>();

export function registerTool(registration: ToolRegistration): void {
  registry.set(registration.definition.name, registration);
}

export function getTool(name: string): ToolRegistration | null {
  return registry.get(name) ?? null;
}

export function listTools(): ToolRegistration[] {
  return Array.from(registry.values());
}

export function hasTool(name: string): boolean {
  return registry.has(name);
}
