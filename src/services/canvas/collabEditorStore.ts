type CollaborationMode = 'editor' | 'viewer';

type PresenceEntry = {
  sessionId: string;
  uid: string;
  mode: CollaborationMode;
  lastSeen: number;
};

const ACTIVE_TTL_MS = 30_000;
const MAX_ACTIVE_EDITORS = 3;

const projectPresence = new Map<string, Map<string, PresenceEntry>>();

function getProjectMap(projectId: string): Map<string, PresenceEntry> {
  const existing = projectPresence.get(projectId);
  if (existing) return existing;
  const next = new Map<string, PresenceEntry>();
  projectPresence.set(projectId, next);
  return next;
}

function pruneInactive(projectId: string, now: number): Map<string, PresenceEntry> {
  const map = getProjectMap(projectId);
  for (const [sessionId, entry] of map.entries()) {
    if (now - entry.lastSeen > ACTIVE_TTL_MS) {
      map.delete(sessionId);
    }
  }
  return map;
}

function activeEditorsByUid(map: Map<string, PresenceEntry>): Set<string> {
  const editors = new Set<string>();
  for (const entry of map.values()) {
    if (entry.mode === 'editor') editors.add(entry.uid);
  }
  return editors;
}

export function joinCollabSession(
  projectId: string,
  sessionId: string,
  uid: string,
  requestedMode: CollaborationMode,
): { mode: CollaborationMode; canEdit: boolean; activeEditors: number; maxEditors: number } {
  const now = Date.now();
  const map = pruneInactive(projectId, now);
  const current = map.get(sessionId);

  const currentEditors = activeEditorsByUid(map);
  const userAlreadyEditor = current?.mode === 'editor' || currentEditors.has(uid);
  const canClaimEditor = requestedMode === 'editor' && (userAlreadyEditor || currentEditors.size < MAX_ACTIVE_EDITORS);
  const mode: CollaborationMode = canClaimEditor ? 'editor' : 'viewer';

  map.set(sessionId, {
    sessionId,
    uid,
    mode,
    lastSeen: now,
  });

  const activeEditors = activeEditorsByUid(map).size;
  return { mode, canEdit: mode === 'editor', activeEditors, maxEditors: MAX_ACTIVE_EDITORS };
}

export function heartbeatCollabSession(
  projectId: string,
  sessionId: string,
): { mode: CollaborationMode | null; canEdit: boolean; activeEditors: number; maxEditors: number } {
  const now = Date.now();
  const map = pruneInactive(projectId, now);
  const entry = map.get(sessionId);
  if (!entry) {
    return { mode: null, canEdit: false, activeEditors: activeEditorsByUid(map).size, maxEditors: MAX_ACTIVE_EDITORS };
  }
  entry.lastSeen = now;
  map.set(sessionId, entry);
  return {
    mode: entry.mode,
    canEdit: entry.mode === 'editor',
    activeEditors: activeEditorsByUid(map).size,
    maxEditors: MAX_ACTIVE_EDITORS,
  };
}

export function leaveCollabSession(projectId: string, sessionId: string): void {
  const map = getProjectMap(projectId);
  map.delete(sessionId);
}

export function canSessionEdit(projectId: string, sessionId: string): boolean {
  const map = pruneInactive(projectId, Date.now());
  const entry = map.get(sessionId);
  return entry?.mode === 'editor';
}

export function collabStatus(projectId: string): { activeEditors: number; maxEditors: number } {
  const map = pruneInactive(projectId, Date.now());
  return { activeEditors: activeEditorsByUid(map).size, maxEditors: MAX_ACTIVE_EDITORS };
}
