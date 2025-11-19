import { Timestamp } from 'firebase-admin/firestore';

// Canvas Project Types
export interface CanvasProject {
  id: string;
  name: string;
  description?: string;
  ownerUid: string;
  collaborators: Array<{
    uid: string;
    role: 'owner' | 'editor' | 'viewer';
    addedAt: Timestamp;
  }>;
  settings?: {
    width?: number;
    height?: number;
    backgroundColor?: string;
    gridEnabled?: boolean;
  };
  lastSnapshotOpIndex?: number;
  lastSnapshotAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Canvas Operation Types
export type OpType = 
  | 'create' 
  | 'update' 
  | 'delete' 
  | 'move' 
  | 'resize' 
  | 'select' 
  | 'deselect' 
  | 'connect' 
  | 'disconnect'
  | 'group'
  | 'ungroup'
  | 'layer'
  | 'style';

export interface CanvasOp {
  id: string;
  projectId: string;
  opIndex: number; // Server-assigned sequential index
  type: OpType;
  elementId?: string;
  elementIds?: string[]; // For multi-select operations
  data: Record<string, any>; // Operation-specific data
  inverse?: CanvasOp; // Inverse operation for undo
  actorUid: string;
  requestId?: string; // Client request ID for deduplication
  clientTs?: number; // Client timestamp
  createdAt: Timestamp;
}

// Canvas Element Types
export interface CanvasElement {
  id: string;
  projectId: string;
  type: 'image' | 'video' | 'text' | 'shape' | 'group' | 'connector' | '3d';
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  zIndex?: number;
  // Type-specific properties
  meta?: {
    mediaId?: string; // Reference to media collection
    url?: string;
    storagePath?: string;
    text?: string;
    fontSize?: number;
    fontFamily?: string;
    fill?: string;
    stroke?: string;
    shapeType?: 'rect' | 'circle' | 'line' | 'polygon';
    model3d?: {
      url: string;
      format: 'gltf' | 'glb' | 'obj';
      rotationX?: number;
      rotationY?: number;
      zoom?: number;
    };
    groupId?: string;
    connectorFrom?: string; // Element ID
    connectorTo?: string; // Element ID
    fromAnchor?: string; // Anchor ID on source element
    toAnchor?: string; // Anchor ID on target element
    anchors?: Array<{ id: string; x: number; y: number }>; // Connection anchors
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Canvas Media Types
export interface CanvasMedia {
  id: string;
  url: string;
  storagePath: string;
  origin: 'canvas' | 'wildmind' | 'upload';
  projectId?: string;
  referencedByCount: number; // Reference count for GC
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
    format?: string;
    size?: number;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Canvas Snapshot Types
export interface CanvasSnapshot {
  projectId: string;
  snapshotOpIndex: number; // Last op index included in snapshot
  elements: Record<string, CanvasElement>; // Element ID -> Element
  metadata: {
    version: string;
    createdAt: Timestamp;
  };
}

// Presence Types
export interface CanvasPresence {
  uid: string;
  projectId: string;
  x: number;
  y: number;
  tool?: string;
  color?: string;
  selection?: string[]; // Selected element IDs
  lastSeen: Timestamp;
}

// Cursor Agent Types
export interface CursorAgentContext {
  viewportTransform: {
    x: number;
    y: number;
    scale: number;
  };
  selectedTool?: string;
  selectedElementIds?: string[];
  imageContext?: {
    mediaId: string;
    boundingBox: { x: number; y: number; width: number; height: number };
  };
}

export interface CursorAgentInstruction {
  userId: string;
  projectId: string;
  context: CursorAgentContext;
  instruction: string;
}

export type CursorAgentActionType = 
  | 'move' 
  | 'pointerDown' 
  | 'pointerUp' 
  | 'drag' 
  | 'selectionRect' 
  | 'selectionLasso' 
  | 'selectSet' 
  | 'connect' 
  | 'meta';

export interface CursorAgentAction {
  type: CursorAgentActionType;
  x?: number;
  y?: number;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  steps?: number;
  timestamp?: number;
  button?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: Array<{ x: number; y: number }>;
  elementIds?: string[];
  fromId?: string;
  fromAnchor?: string;
  toId?: string;
  toAnchor?: string;
  confidence?: number;
  explanation?: string;
}

export interface CursorAgentPlan {
  planId: string;
  actions: CursorAgentAction[];
  confidence: number;
  previewPolygons?: Array<{ points: Array<{ x: number; y: number }> }>;
  debug?: Record<string, any>;
}

// Generation Request with Canvas Meta
export interface CanvasGenerationRequest {
  prompt: string;
  model: string;
  width?: number;
  height?: number;
  aspectRatio?: string; // Aspect ratio string like "16:9", "1:1", etc.
  seed?: number;
  imageCount?: number; // Number of images to generate (default: 1)
  options?: Record<string, any>;
  meta: {
    source: 'canvas';
    projectId: string;
    elementId?: string;
  };
}

