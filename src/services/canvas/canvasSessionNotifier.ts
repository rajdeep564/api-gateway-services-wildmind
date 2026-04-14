type SessionBroadcastPayload =
  | { type: 'project_opened_elsewhere' }
  | { type: 'project_takeover_requested'; requesterSessionId: string }
  | { type: 'project_takeover_accepted' }
  | { type: 'project_takeover_rejected' }
  | { type: 'project_takeover_force_close' };

let broadcaster: ((projectId: string, payload: SessionBroadcastPayload, targetSessionId?: string | null, exceptSessionId?: string | null) => void) | null = null;

export function registerCanvasSessionBroadcaster(fn: (projectId: string, payload: SessionBroadcastPayload, targetSessionId?: string | null, exceptSessionId?: string | null) => void): void {
  broadcaster = fn;
}

export function notifyProjectOpenedElsewhere(projectId: string, openerSessionId?: string | null): void {
  if (broadcaster) {
    try {
      broadcaster(projectId, { type: 'project_opened_elsewhere' }, null, openerSessionId ?? null);
    } catch (e) {
      console.warn('[canvasSessionNotifier] Broadcast failed:', e);
    }
  }
}

export function notifySessionTakeoverRequested(projectId: string, currentSessionId: string, requesterSessionId: string): void {
  if (!broadcaster) return;
  broadcaster(projectId, { type: 'project_takeover_requested', requesterSessionId }, currentSessionId, null);
}

export function notifySessionTakeoverAccepted(projectId: string, requesterSessionId: string, previousSessionId: string): void {
  if (!broadcaster) return;
  broadcaster(projectId, { type: 'project_takeover_accepted' }, requesterSessionId, null);
  broadcaster(projectId, { type: 'project_takeover_force_close' }, previousSessionId, null);
}

export function notifySessionTakeoverRejected(projectId: string, requesterSessionId: string): void {
  if (!broadcaster) return;
  broadcaster(projectId, { type: 'project_takeover_rejected' }, requesterSessionId, null);
}
