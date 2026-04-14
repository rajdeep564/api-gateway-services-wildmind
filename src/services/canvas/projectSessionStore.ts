type ProjectSessionState = {
  currentSessionId: string | null;
  pendingRequesterSessionId: string | null;
  lastRejectedSessionId: string | null;
};

const projectSessions = new Map<string, ProjectSessionState>();

function ensureState(projectId: string): ProjectSessionState {
  const existing = projectSessions.get(projectId);
  if (existing) return existing;
  const next: ProjectSessionState = {
    currentSessionId: null,
    pendingRequesterSessionId: null,
    lastRejectedSessionId: null,
  };
  projectSessions.set(projectId, next);
  return next;
}

export function setCurrentSession(projectId: string, sessionId: string | null): void {
  const state = ensureState(projectId);
  state.currentSessionId = sessionId;
  state.pendingRequesterSessionId = null;
  state.lastRejectedSessionId = null;
}

export function getCurrentSession(projectId: string): string | null {
  return ensureState(projectId).currentSessionId;
}

export function isCurrentSession(projectId: string, sessionId: string | null): boolean {
  if (sessionId == null) return true;
  return ensureState(projectId).currentSessionId === sessionId;
}

export function requestSessionTakeover(projectId: string, requesterSessionId: string): { status: 'granted' | 'pending'; currentSessionId: string | null } {
  const state = ensureState(projectId);

  if (!state.currentSessionId || state.currentSessionId === requesterSessionId) {
    state.currentSessionId = requesterSessionId;
    state.pendingRequesterSessionId = null;
    state.lastRejectedSessionId = null;
    return { status: 'granted', currentSessionId: requesterSessionId };
  }

  state.pendingRequesterSessionId = requesterSessionId;
  state.lastRejectedSessionId = null;
  return { status: 'pending', currentSessionId: state.currentSessionId };
}

export function resolveSessionTakeover(
  projectId: string,
  approverSessionId: string,
  action: 'accept' | 'reject'
): { requesterSessionId: string | null; currentSessionId: string | null } {
  const state = ensureState(projectId);
  if (!state.currentSessionId || state.currentSessionId !== approverSessionId) {
    return { requesterSessionId: null, currentSessionId: state.currentSessionId };
  }

  const requesterSessionId = state.pendingRequesterSessionId;
  if (!requesterSessionId) {
    return { requesterSessionId: null, currentSessionId: state.currentSessionId };
  }

  if (action === 'accept') {
    state.currentSessionId = requesterSessionId;
    state.pendingRequesterSessionId = null;
    state.lastRejectedSessionId = null;
    return { requesterSessionId, currentSessionId: requesterSessionId };
  }

  state.pendingRequesterSessionId = null;
  state.lastRejectedSessionId = requesterSessionId;
  return { requesterSessionId, currentSessionId: state.currentSessionId };
}

export function getSessionState(projectId: string, sessionId: string | null): {
  sessionIsCurrent: boolean;
  waitingForApproval: boolean;
  rejected: boolean;
  hasActiveSession: boolean;
} {
  const state = ensureState(projectId);
  return {
    sessionIsCurrent: sessionId == null ? true : state.currentSessionId === sessionId,
    waitingForApproval: sessionId != null && state.pendingRequesterSessionId === sessionId,
    rejected: sessionId != null && state.lastRejectedSessionId === sessionId,
    hasActiveSession: state.currentSessionId != null,
  };
}
