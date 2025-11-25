import type { Server as HttpServer } from 'http';
// Using ws for WebSocket server
// Types are provided by @types/ws at build time
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import type { IncomingMessage } from 'http';
import { logger } from '../utils/logger';
import { URL } from 'url';

export type GeneratorOverlay = {
  id: string;
  type: 'image' | 'video' | 'music' | 'text' | 'upscale' | 'removebg' | 'erase' | 'replace' | 'expand' | 'vectorize' | 'storyboard';
  x: number;
  y: number;
  generatedImageUrl?: string | null;
  generatedVideoUrl?: string | null;
  generatedMusicUrl?: string | null;
  upscaledImageUrl?: string | null;
  removedBgImageUrl?: string | null;
  erasedImageUrl?: string | null;
  replacedImageUrl?: string | null;
  expandedImageUrl?: string | null;
  vectorizedImageUrl?: string | null;
  sourceImageUrl?: string | null;
  localUpscaledImageUrl?: string | null;
  localRemovedBgImageUrl?: string | null;
  localErasedImageUrl?: string | null;
  localReplacedImageUrl?: string | null;
  localExpandedImageUrl?: string | null;
  localVectorizedImageUrl?: string | null;
  frameWidth?: number;
  frameHeight?: number;
  model?: string;
  frame?: string;
  aspectRatio?: string;
  prompt?: string;
  mode?: string;
  scale?: number;
  backgroundType?: string;
  scaleValue?: number;
  isUpscaling?: boolean;
  isRemovingBg?: boolean;
  isErasing?: boolean;
  isReplacing?: boolean;
  isExpanding?: boolean;
  isVectorizing?: boolean;
  value?: string;
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

// Minimal in-memory state per project (optional; can be removed if server shouldn't store)
const projectOverlays = new Map<string, Map<string, GeneratorOverlay>>();
const projectMedia = new Map<string, Map<string, MediaElement>>();

function getProjectId(reqUrl: string | undefined): string | null {
  if (!reqUrl) return null;
  try {
    const u = new URL(reqUrl, 'http://localhost');
    return u.searchParams.get('projectId');
  } catch {
    return null;
  }
}

export function startRealtimeServer(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/realtime' });
  const rooms = new Map<string, Set<WebSocket>>(); // projectId -> clients

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
    logger.info({ projectId, type: payload?.type, recipients: sent }, 'Realtime broadcast');
  }

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const projectId = getProjectId(req.url) || 'default';

    if (!rooms.has(projectId)) rooms.set(projectId, new Set());
    rooms.get(projectId)!.add(ws);

    logger.info({ projectId }, 'Realtime WS connected');

    // Send init overlays/media if we keep any state
    const overlays = Array.from(projectOverlays.get(projectId)?.values() || []);
    const media = Array.from(projectMedia.get(projectId)?.values() || []);
    try {
      ws.send(JSON.stringify({ type: 'init', overlays, media }));
      logger.info({ projectId, overlays: overlays.length, media: media.length }, 'Realtime init sent');
    } catch {/* ignore */}

    ws.on('message', (raw: RawData) => {
      let msg: any = null;
      try { msg = JSON.parse(raw.toString()); } catch {
        logger.warn({ projectId }, 'Realtime message JSON parse failed');
        return;
      }
      if (!msg || typeof msg !== 'object' || !msg.type) return;

      // Handle basic create/update/delete and mirror to room for generators
      if (msg.type === 'generator.create' && msg.overlay && msg.overlay.id && msg.overlay.type) {
        logger.info({ projectId, id: msg.overlay.id, type: msg.overlay.type }, 'Realtime recv create');
        const m = projectOverlays.get(projectId) || new Map<string, GeneratorOverlay>();
        m.set(msg.overlay.id, msg.overlay);
        projectOverlays.set(projectId, m);
        broadcast(projectId, { type: 'generator.create', overlay: msg.overlay }, ws);
      } else if (msg.type === 'generator.update' && msg.id) {
        logger.info({ projectId, id: msg.id, fields: Object.keys(msg.updates || {}) }, 'Realtime recv update');
        const m = projectOverlays.get(projectId);
        if (m && m.has(msg.id)) {
          const cur = m.get(msg.id)!;
          const next = { ...cur, ...(msg.updates || {}) } as GeneratorOverlay;
          m.set(msg.id, next);
        }
        broadcast(projectId, { type: 'generator.update', id: msg.id, updates: msg.updates || {} }, ws);
      } else if (msg.type === 'generator.delete' && msg.id) {
        logger.info({ projectId, id: msg.id }, 'Realtime recv delete');
        const m = projectOverlays.get(projectId);
        if (m) m.delete(msg.id);
        broadcast(projectId, { type: 'generator.delete', id: msg.id }, ws);
      // Media events (uploaded or other canvas elements)
      } else if (msg.type === 'media.create' && msg.media && msg.media.id) {
        logger.info({ projectId, id: msg.media.id, kind: msg.media.kind }, 'Realtime recv media.create');
        const m = projectMedia.get(projectId) || new Map<string, MediaElement>();
        m.set(msg.media.id, msg.media as MediaElement);
        projectMedia.set(projectId, m);
        broadcast(projectId, { type: 'media.create', media: msg.media }, ws);
      } else if (msg.type === 'media.update' && msg.id) {
        logger.info({ projectId, id: msg.id, fields: Object.keys(msg.updates || {}) }, 'Realtime recv media.update');
        const m = projectMedia.get(projectId);
        if (m && m.has(msg.id)) {
          const cur = m.get(msg.id)!;
          const next = { ...cur, ...(msg.updates || {}) } as MediaElement;
          m.set(msg.id, next);
        }
        broadcast(projectId, { type: 'media.update', id: msg.id, updates: msg.updates || {} }, ws);
      } else if (msg.type === 'media.delete' && msg.id) {
        logger.info({ projectId, id: msg.id }, 'Realtime recv media.delete');
        const m = projectMedia.get(projectId);
        if (m) m.delete(msg.id);
        broadcast(projectId, { type: 'media.delete', id: msg.id }, ws);
      } else if (msg.type === 'init') {
        // No-op: client requests init on open; we already sent it on connect
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
