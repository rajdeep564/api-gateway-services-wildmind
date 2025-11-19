# Canvas Backend Implementation Guide

## Overview

This document describes the Canvas backend system implementation, including collaborative editing, Cursor Agent AI, and high-performance rendering support.

## Architecture

```
Canvas Client → API Gateway (/api/canvas/*) → Canvas Services → Firestore/Zata/Redis
```

## Database Collections

### Firestore Collections

1. **canvasProjects** - Project metadata
   - Document ID: project ID
   - Fields: name, description, ownerUid, collaborators[], settings, lastSnapshotOpIndex, timestamps

2. **canvasProjects/{id}/ops** - Operations log
   - Document ID: auto-generated
   - Fields: opIndex (server-assigned), type, elementId, data, inverse, actorUid, timestamps

3. **canvasProjects/{id}/elements** - Canvas elements
   - Document ID: element ID
   - Fields: type, x, y, width, height, rotation, meta (mediaId, url, etc.)

4. **canvasProjects/{id}/snapshots** - Snapshots for fast loading
   - Document ID: snapshotOpIndex (string)
   - Fields: snapshotOpIndex, elements (map), metadata

5. **canvasProjects/{id}/counters** - Operation counter
   - Document ID: "opIndex"
   - Fields: value (number)

6. **canvasMedia** - Media index
   - Document ID: media ID
   - Fields: url, storagePath, origin, projectId, referencedByCount, metadata

## API Endpoints

### Projects
- `POST /api/canvas/projects` - Create project
- `GET /api/canvas/projects/:id` - Get project
- `PATCH /api/canvas/projects/:id` - Update project
- `POST /api/canvas/projects/:id/collaborators` - Add collaborator

### Operations
- `POST /api/canvas/projects/:id/ops` - Append operation
- `GET /api/canvas/projects/:id/ops?fromOp=N&limit=M` - Get operations after index

### Snapshots
- `GET /api/canvas/projects/:id/snapshot?fromOp=N` - Get snapshot + ops
- `POST /api/canvas/projects/:id/snapshot` - Create snapshot (owner/editor only)

### Generation
- `POST /api/canvas/generate` - Generate image/video for canvas
  - Body: `{ prompt, model, width, height, meta: { source: "canvas", projectId } }`

### Cursor Agent
- `POST /api/canvas/agent/plan` - Plan agent actions
  - Body: `{ instruction, projectId, context: { viewportTransform, selectedTool, ... } }`
- `POST /api/canvas/agent/execute` - Execute plan (logging)

## Operation System

### Operation Types
- `create` - Create element
- `update` - Update element
- `delete` - Delete element
- `move` - Move element(s)
- `resize` - Resize element
- `select` - Select element(s)
- `connect` - Connect two elements
- `group` - Group elements
- `ungroup` - Ungroup elements

### Operation Flow

1. **Client creates op** with `requestId` and `clientTs`
2. **Client sends** `POST /api/canvas/projects/:id/ops`
3. **Server**:
   - Validates access
   - Checks for duplicate `requestId`
   - In transaction: increments `opIndex`, writes op
   - Updates elements collection
   - Returns `{ opId, opIndex }`
4. **Client** reconciles optimistic state with server `opIndex`

### Undo/Redo

- Each op includes `inverse` field
- Undo = append inverse op
- Redo = append original op again
- All clients receive inverse ops and replay

## Cursor Agent AI

### Capabilities

1. **Selection**:
   - "select all" → selects all visible elements
   - "select near top-right" → region-based selection
   - "select red elements" → color-based selection

2. **Connection**:
   - "connect node A to node B" → creates connector
   - Automatically finds nearest anchors
   - Plans cursor movements and drag events

3. **Heuristics**:
   - Element-based operations (preferred)
   - Region-based selection
   - Anchor snapping (20px tolerance)

### Implementation

- `cursorAgentService.planAgentActions()` - Parses instruction, generates actions
- Returns `CursorAgentPlan` with actions, confidence, preview polygons
- Client executes actions or shows preview for confirmation

## Media Lifecycle

1. **Generation** → Upload to Zata → Create `canvasMedia` record
2. **Element references media** → `incrementRef(mediaId)`
3. **Element deleted** → `decrementRef(mediaId)`
4. **GC Worker** (nightly):
   - Query `referencedByCount == 0 && createdAt < now() - 7 days`
   - Delete from Zata
   - Delete from Firestore

## High-Performance Rendering

### Frontend Requirements

1. **PixiJS for 2D**:
   - Use PixiJS Application for canvas rendering
   - Support WebGL/WebGPU
   - Texture caching (LRU, 200-400MB limit)

2. **Three.js for 3D**:
   - WebGL renderer
   - Support GLTF/GLB models
   - Texture compression (KTX2/Basis)

3. **Media Formats**:
   - Images: AVIF/WebP for web, KTX2 for GPU
   - Videos: H.264/VP9/AV1, multiple resolutions
   - Use WebCodecs for frame-level rendering

4. **Optimizations**:
   - Tiled images (Deep Zoom/IIIF)
   - Mipmaps for textures
   - Request tiles at appropriate LOD
   - Avoid `canvas.toDataURL()` frequently
   - Reuse textures, don't recreate

## WebSocket Presence (Future)

- Endpoint: `WS /ws/canvas/:projectId`
- Heartbeat: Every 1-2s with `{ uid, x, y, tool, color }`
- Redis: `HSET presence:{projectId}:{uid}` with TTL 5s
- Broadcast via pub/sub to project subscribers

## Security

- All routes require `validateAuth` middleware
- Project access checked via `collaborators` array
- Only owner/editor can create snapshots
- Only owner can add collaborators

## Performance Considerations

1. **Op Indexing**: Composite index on `opIndex` for fast queries
2. **Element Queries**: Spatial indexing (consider Geohash for large projects)
3. **Snapshot Frequency**: Every 100 ops or 1 hour (configurable)
4. **Media GC**: Run nightly, keep 7-day grace period

## Testing Checklist

- [ ] Create project
- [ ] Append operations
- [ ] Get snapshot + ops
- [ ] Generate image for canvas
- [ ] Cursor agent selection
- [ ] Cursor agent connection
- [ ] Undo/redo operations
- [ ] Multi-user collaboration
- [ ] Media reference counting
- [ ] Snapshot creation

## Deployment Notes

1. **Firestore Indexes**: Create composite indexes for:
   - `canvasProjects/{id}/ops`: `opIndex` (ascending)
   - `canvasMedia`: `referencedByCount + createdAt`

2. **Environment Variables**: No new vars needed (reuses existing)

3. **Workers**: 
   - Snapshot worker: Scheduled job (Cloud Functions/Cloud Run)
   - Media GC worker: Scheduled job (nightly)

4. **Rate Limiting**: Apply to `/api/canvas/agent/*` endpoints (expensive)

