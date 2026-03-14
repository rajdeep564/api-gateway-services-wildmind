/**
 * Notify WebSocket subscribers that a project was opened elsewhere.
 * openerSessionId = the tab that just did GET (we exclude them so only the *previous* tab gets the popup).
 */

let broadcaster: ((projectId: string, openerSessionId: string | null) => void) | null = null;

export function registerCanvasSessionBroadcaster(fn: (projectId: string, openerSessionId: string | null) => void): void {
  broadcaster = fn;
}

export function notifyProjectOpenedElsewhere(projectId: string, openerSessionId?: string | null): void {
  if (broadcaster) {
    try {
      broadcaster(projectId, openerSessionId ?? null);
    } catch (e) {
      console.warn('[canvasSessionNotifier] Broadcast failed:', e);
    }
  }
}
