/**
 * In-memory store: which client session "owns" each project (last to open via GET snapshot).
 * Used so the "previous" tab can poll and get sessionIsCurrent: false when another tab opened the project.
 */

const projectSessions = new Map<string, string | null>(); // projectId -> currentSessionId

export function setCurrentSession(projectId: string, sessionId: string | null): void {
  projectSessions.set(projectId, sessionId);
}

export function getCurrentSession(projectId: string): string | null {
  return projectSessions.get(projectId) ?? null;
}

export function isCurrentSession(projectId: string, sessionId: string | null): boolean {
  if (sessionId == null) return true;
  const current = projectSessions.get(projectId);
  return current === sessionId;
}
