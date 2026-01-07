import { WebSocket, WebSocketServer, RawData } from 'ws';
import { IncomingMessage } from 'http';
import { Server as HttpServer } from 'http';
import { logger } from '../utils/logger';
import { URL } from 'url';
import { opRepository } from '../repository/canvas/opRepository';
import { elementRepository } from '../repository/canvas/elementRepository';

// --- TYPES ---
export type GeneratorOverlay = {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  meta: any; // Flexible meta for plugins
  isVectorizing?: boolean;
};

export type MediaElement = {
  id: string;
  kind: 'image' | 'video' | 'model3d' | 'text';
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  url?: string;
  frameWidth?: number;
  frameHeight?: number;
  model?: string; // model selection for generators
  selected?: boolean;
};

// Strict Data Models per User Spec
export type CanvasOp = {
  id: string;
  type: string;
  data: any; // Using 'data' as payload to match existing frontend preference
  inverse?: CanvasOp;
  authorId: string;
  elementIds?: string[]; // Add optional elementIds
  elementId?: string; // Add optional elementId
};

export type WSMessage = {
  kind: 'op';
  op: CanvasOp;
  version: number;
} | {
  kind: 'cursor';
  x: number;
  y: number;
  authorId: string;
} | {
  kind: 'init';
  version: number;
  overlays: GeneratorOverlay[];
  media: MediaElement[];
} | {
  kind: 'history.push';
  op: CanvasOp;
  inverse?: CanvasOp;
} | {
  kind: 'history.undo';
} | {
  kind: 'history.redo';
};

export type ProjectState = {
  overlays: Map<string, GeneratorOverlay>;
  media: Map<string, MediaElement>;
  history: {
    undoStack: CanvasOp[];
    redoStack: CanvasOp[];
  };
  version: number; // Canonical project version
};

// In-memory state per project
const projects = new Map<string, ProjectState>();

function getProjectState(projectId: string): ProjectState {
  if (!projects.has(projectId)) {
    projects.set(projectId, {
      overlays: new Map(),
      media: new Map(),
      history: { undoStack: [], redoStack: [] },
      version: 0,
    });
  }
  return projects.get(projectId)!;
}

function getProjectId(reqUrl: string | undefined): string | null {
  if (!reqUrl) return null;
  try {
    const { env } = require('../config/env');
    const defaultBase = env.devFrontendUrl;
    const u = new URL(reqUrl, defaultBase);
    return u.searchParams.get('projectId');
  } catch {
    return null;
  }
}

export function startRealtimeServer(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/realtime' });
  const rooms = new Map<string, Set<WebSocket>>(); // projectId -> clients

  // Helper to broadcast messages to clients
  function broadcast(projectId: string, payload: any, except?: WebSocket) {
    const room = rooms.get(projectId);
    if (!room) return;
    const data = JSON.stringify(payload);
    let sent = 0;
    for (const ws of room) {
      if (ws === except) continue;
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(data); sent++; } catch (e) { /* no-op */ }
      }
    }
    logger.info({ projectId, type: payload?.type || payload?.kind, recipients: sent }, 'Realtime broadcast');
  }

  // Helper to apply operations to server-side memory (Persistence)
  function applyOpToProject(state: ProjectState, op: CanvasOp) {
    if (!op || !op.type) return;

    // Handle Bulk Operations
    if (op.type === 'bulk-create' && op.data?.elements) {
      if (Array.isArray(op.data.elements)) {
        op.data.elements.forEach((el: any) => {
          if (el.type === 'image' || el.type === 'video' || el.type === 'text') { // Media
            state.media.set(el.id, el);
          } else { // Generators / Overlays
            state.overlays.set(el.id, el);
          }
        });
      }
      return;
    }

    // Handle 'delete' (Single or Bulk)
    if (op.type === 'delete' || op.type === 'generator.delete' || op.type === 'media.delete') {
      const anyOp = op as any;
      let ids: string[] = [];

      if (anyOp.elementIds && Array.isArray(anyOp.elementIds)) {
        ids = anyOp.elementIds;
      } else if (anyOp.elementId) {
        ids = [anyOp.elementId];
      } else if (anyOp.id && (op.type === 'generator.delete' || op.type === 'media.delete')) {
        ids = [anyOp.id];
      }

      if (ids.length > 0) {
        logger.info({
          msg: 'Processing DELETE OP (Detailed)',
          targetIds: ids,
          overlayCount: state.overlays.size,
          mediaCount: state.media.size,
          sampleOverlayKeys: Array.from(state.overlays.keys()).slice(0, 5),
          sampleMediaKeys: Array.from(state.media.keys()).slice(0, 5)
        });

        ids.forEach(id => {
          let found = false;
          if (state.overlays.has(id)) {
            state.overlays.delete(id);
            found = true;
            logger.info({ id }, 'Deleted from OVERLAYS');
          }
          if (state.media.has(id)) {
            state.media.delete(id);
            found = true;
            logger.info({ id }, 'Deleted from MEDIA');
          }
          if (!found) {
            logger.warn({ id }, 'FAILED TO DELETE: ID not found in either map');
          }
        });
      } else {
        logger.warn({ opId: op.id, type: op.type }, 'Delete OP received without valid targets');
      }
      return;
    }

    // Handle 'create'
    if (op.type === 'create' || op.type === 'generator.create') {
      const el = op.data?.element || op.data; // normalization
      if (el && el.id) {
        state.overlays.set(el.id, el);
        logger.info({ id: el.id, type: el.type, inOverlays: true }, 'Persisting create op');
      }
      return;
    }
    if (op.type === 'media.create') {
      const el = op.data?.media || op.data;
      if (el && el.id) {
        state.media.set(el.id, el);
        logger.info({ id: el.id, type: el.type, inMedia: true }, 'Persisting media.create op');
      }
      return;
    }

    // Handle 'update'
    if (op.type === 'update' || op.type === 'generator.update') {
      const id = op.id || (op as any).elementId;
      const updates = op.data?.updates || op.data;
      if (id && updates) {
        if (state.overlays.has(id)) {
          const existing = state.overlays.get(id)!;
          // Deep merge for meta if exists
          const merged = { ...existing, ...updates };
          if (existing.meta && updates.meta) {
            merged.meta = { ...existing.meta, ...updates.meta };
          }
          state.overlays.set(id, merged as GeneratorOverlay);
        } else if (state.media.has(id)) {
          state.media.set(id, { ...state.media.get(id)!, ...updates });
        }
      }
      return;
    }
    if (op.type === 'media.update') {
      const id = op.id || (op as any).elementId;
      const updates = op.data?.updates || op.data;
      if (id && updates && state.media.has(id)) {
        state.media.set(id, { ...state.media.get(id)!, ...updates });
      }
      return;
    }
  }

  // Helper to persist operations to Firestore (Ops + Element State)
  async function persistOp(projectId: string, op: CanvasOp, state: ProjectState) {
    try {
      // 1. Append Op to History (Ops Collection & Increment Counter)
      await opRepository.appendOp(projectId, {
        projectId,
        type: op.type as any,
        data: op.data,
        inverse: op.inverse as any,
        elementIds: op.elementIds,
        elementId: op.elementId, // Deprecated but kept for compat
        actorUid: op.authorId,
      });

      // 2. Update Element State (Elements Collection) - Snapshot Source
      // We rely on the normalized state we just computed in-memory to know what to save
      // But for simplicity/robustness, we re-parse the op here since state maps are broad.

      // Handle 'create'
      if (op.type === 'create' || op.type === 'generator.create' || op.type === 'media.create') {
        const el = op.data?.element || op.data?.media || op.data;
        if (el && el.id) {
          await elementRepository.upsertElement(projectId, el);
        }
      }

      // Handle 'update'
      if (op.type === 'update' || op.type === 'generator.update' || op.type === 'media.update') {
        const id = op.id || (op as any).elementId;
        const updates = op.data?.updates || op.data;
        if (id && updates) {
          // We need to merge with existing because `upsertElement` overwrites if not careful,
          // but our repository `upsertElement` does a merge if exists, effectively.
          // However, it expects a full object or at least the ID.
          // Ideally we fetch current from memory to ensure full object is compliant,
          // but updating just fields is better.
          // The repository `upsertElement` implementation does a merge:
          // existing.exists ? update({...element}) : set({...element})
          // So passing just ID and updates matches `update` behavior usually,
          // BUT `upsertElement` signature expects `Omit<CanvasElement...>`, so we might need full flags.
          // Let's rely on in-memory state to get the FULL object to be safe.
          const fullEl = state.overlays.get(id) || state.media.get(id);
          if (fullEl) {
            await elementRepository.upsertElement(projectId, fullEl as any);
          }
        }
      }

      // Handle 'delete'
      if (op.type === 'delete' || op.type === 'generator.delete' || op.type === 'media.delete') {
        const anyOp = op as any;
        let ids: string[] = anyOp.elementIds || (anyOp.elementId ? [anyOp.elementId] : []) || (anyOp.id ? [anyOp.id] : []);

        for (const id of ids) {
          await elementRepository.deleteElement(projectId, id);
        }
      }

      // Handle 'bulk-create'
      if (op.type === 'bulk-create' && op.data?.elements && Array.isArray(op.data.elements)) {
        await elementRepository.batchUpsertElements(projectId, op.data.elements);
      }

    } catch (err) {
      logger.error({ projectId, opId: op.id, err }, 'Failed to persist OP to DB');
    }
  }

  // Basic Validation
  function validateOp(op: any): boolean {
    if (!op || typeof op !== 'object') return false;
    if (!op.type || typeof op.type !== 'string') return false;
    // Check for IDs
    const hasId = op.id || op.elementId || (op.elementIds && Array.isArray(op.elementIds));
    if (!hasId) return false;
    return true;
  }

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const projectId = getProjectId(req.url) || 'default';

    if (!rooms.has(projectId)) rooms.set(projectId, new Set());
    rooms.get(projectId)!.add(ws);

    logger.info({ projectId }, 'Realtime WS connected');

    // Send init state
    const state = getProjectState(projectId);
    const overlays = Array.from(state.overlays.values());
    const media = Array.from(state.media.values());
    try {
      ws.send(JSON.stringify({
        type: 'init',
        overlays,
        media,
        version: state.version
      }));
      logger.info({ projectId, overlays: overlays.length, media: media.length, version: state.version }, 'Realtime init sent');
    } catch {/* ignore */ }

    ws.on('message', (raw: RawData) => {
      let msg: any = null;
      try { msg = JSON.parse(raw.toString()); } catch {
        logger.warn({ projectId }, 'Realtime message JSON parse failed');
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      // Normalize 'kind' vs 'type'
      const kind = msg.kind || msg.type;
      const state = getProjectState(projectId);

      // --- INIT ---
      if (kind === 'init') {
        const overlays = Array.from(state.overlays.values());
        const media = Array.from(state.media.values());
        ws.send(JSON.stringify({
          type: 'init',
          overlays,
          media,
          version: state.version
        }));
        return;
      }

      // --- HISTORY PUSH ---
      if (kind === 'history.push') {
        const { op, inverse } = msg;

        // Validation
        if (!validateOp(op)) {
          logger.warn({ projectId, op }, 'Invalid OP received, dropping.');
          return;
        }
        if (inverse && !validateOp(inverse)) {
          logger.warn({ projectId, inverse }, 'Invalid INVERSE received, dropping.');
          return;
        }

        // 1. Clear Redo
        state.history.redoStack = [];

        // 2. Increment Version
        state.version++;

        // 3. Push to Undo Stack
        state.history.undoStack.push({
          id: `op-${Date.now()}-${Math.random()}`, // Deterministic server-sided ID assignment if missing
          type: op.type,
          data: op.data,
          inverse,
          authorId: 'user',
          elementIds: op.elementIds, // Capture these for bulk operations
          elementId: op.elementId,
          ...op // Spread rest to catch loose props
        });

        // Limit Stack
        if (state.history.undoStack.length > 50) {
          state.history.undoStack.shift();
        }

        // 4. APPLY TO SERVER STATE (Persistence)
        applyOpToProject(state, op);

        // Fire-and-forget persistence to DB (don't block broadcast)
        persistOp(projectId, op, state).catch(e => console.error('Persistence failed', e));

        logger.info({ projectId, version: state.version, type: op.type }, 'History push (Strict)');

        // 5. Broadcast OP to ALL (including sender)
        broadcast(projectId, {
          kind: 'op',
          op: op,
          version: state.version,
          canUndo: state.history.undoStack.length > 0,
          canRedo: state.history.redoStack.length > 0
        });
        return;
      }

      // --- UNDO ---
      if (kind === 'history.undo') {
        if (state.history.undoStack.length === 0) return;

        const item = state.history.undoStack.pop()!;
        if (!item.inverse) {
          state.history.undoStack.push(item);
          return;
        }

        state.version++;
        state.history.redoStack.push(item);

        // APPLY INVERSE TO STATE
        applyOpToProject(state, item.inverse);

        // Fire-and-forget persistence of the INVERSE op (effectively a new op)
        // Note: 'undo' pushes the INVERSE as a new op in `opRepository` usually via `appendOp`?
        // Actually, strictly speaking, we should record the UNDO event itself or the inverse op.
        // Our `appendOp` in repo adds a new doc.
        // Let's persist the INVERSE as a new op so the sequence is linear in DB.
        persistOp(projectId, item.inverse, state).catch(e => console.error('Undo Persistence failed', e));

        logger.info({ projectId, version: state.version, undoing: item.type }, 'History undo (Strict)');

        broadcast(projectId, {
          kind: 'op',
          op: item.inverse,
          version: state.version,
          canUndo: state.history.undoStack.length > 0,
          canRedo: state.history.redoStack.length > 0
        });
        return;
      }

      // --- REDO ---
      if (kind === 'history.redo') {
        if (state.history.redoStack.length === 0) return;

        const item = state.history.redoStack.pop()!;

        state.version++;
        state.history.undoStack.push(item);

        // APPLY ORIGINAL OP TO STATE
        // Ensure we pass elementIds if they were missing in the item (fallback to item which hopefully has them now)
        applyOpToProject(state, item);

        // Fire-and-forget persistence
        persistOp(projectId, item, state).catch(e => console.error('Redo Persistence failed', e));

        logger.info({ projectId, version: state.version, redoing: item.type }, 'History redo (Strict)');

        broadcast(projectId, {
          kind: 'op',
          op: item,
          version: state.version,
          canUndo: state.history.undoStack.length > 0,
          canRedo: state.history.redoStack.length > 0
        });
        return;
      }

      // --- CURSOR ---
      if (kind === 'cursor') {
        broadcast(projectId, {
          kind: 'cursor',
          x: msg.x,
          y: msg.y,
          authorId: 'unknown'
        }, ws); // Exclude sender
        return;
      }
    });

    ws.on('close', () => {
      rooms.get(projectId)?.delete(ws);
      logger.info({ projectId }, 'Realtime WS disconnected');
    });

    ws.on('error', (err: unknown) => {
      logger.warn({ err: String(err), projectId }, 'Realtime WS error');
    });
  });

  logger.info({ path: '/realtime' }, 'Realtime WebSocket server started');
}
