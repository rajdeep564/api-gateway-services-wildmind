import { CursorAgentInstruction, CursorAgentPlan, CursorAgentAction } from '../../types/canvas';
import { elementRepository } from '../../repository/canvas/elementRepository';
import { projectRepository } from '../../repository/canvas/projectRepository';
import { ApiError } from '../../utils/errorHandler';
import { v4 as uuidv4 } from 'uuid';

export async function planAgentActions(
  userId: string,
  instruction: CursorAgentInstruction
): Promise<CursorAgentPlan> {
  // Verify project access
  const project = await projectRepository.getProject(instruction.projectId);
  if (!project) {
    throw new ApiError('Project not found', 404);
  }

  const hasAccess = 
    project.ownerUid === userId ||
    project.collaborators.some(c => c.uid === userId);
  
  if (!hasAccess) {
    throw new ApiError('Access denied', 403);
  }

  // Get all elements in viewport
  const viewport = instruction.context.viewportTransform;
  // Default viewport dimensions (client should provide actual dimensions)
  const defaultWidth = 1200;
  const defaultHeight = 800;
  const viewportRegion = {
    x: -viewport.x / viewport.scale,
    y: -viewport.y / viewport.scale,
    width: defaultWidth / viewport.scale,
    height: defaultHeight / viewport.scale,
  };

  const elements = await elementRepository.queryElementsInRegion(
    instruction.projectId,
    viewportRegion
  );

  // Parse instruction and generate actions
  const actions = await parseInstruction(
    instruction.instruction,
    elements,
    instruction.context,
    viewport
  );

  const confidence = calculateConfidence(instruction.instruction, actions, elements);

  return {
    planId: uuidv4(),
    actions,
    confidence,
    previewPolygons: generatePreviewPolygons(actions, elements),
  };
}

async function parseInstruction(
  instruction: string,
  elements: any[],
  context: CursorAgentInstruction['context'],
  viewport: { x: number; y: number; scale: number }
): Promise<CursorAgentAction[]> {
  const actions: CursorAgentAction[] = [];
  const lower = instruction.toLowerCase();

  // Selection instructions
  if (lower.includes('select')) {
    if (lower.includes('all') || lower.includes('everything')) {
      // Select all visible elements
      const elementIds = elements.map(e => e.id);
      actions.push({
        type: 'selectSet',
        elementIds,
        confidence: 0.95,
      });
    } else if (lower.includes('near') || lower.includes('top-right') || lower.includes('top-left') || lower.includes('bottom')) {
      // Region-based selection
      const region = parseRegionFromInstruction(instruction, viewport);
      const selected = elements.filter(el => isElementInRegion(el, region));
      actions.push({
        type: 'selectionRect',
        x1: region.x,
        y1: region.y,
        x2: region.x + region.width,
        y2: region.y + region.height,
        confidence: 0.85,
      });
      actions.push({
        type: 'selectSet',
        elementIds: selected.map(e => e.id),
        confidence: 0.85,
      });
    } else if (lower.includes('red') || lower.includes('blue') || lower.includes('color')) {
      // Color-based selection (heuristic)
      const color = extractColorFromInstruction(instruction);
      const selected = elements.filter(el => {
        const fill = el.meta?.fill || '';
        return fill.toLowerCase().includes(color);
      });
      actions.push({
        type: 'selectSet',
        elementIds: selected.map(e => e.id),
        confidence: 0.7,
      });
    }
  }

  // Connection instructions
  if (lower.includes('connect') || lower.includes('link')) {
    const nodeIds = extractNodeIdsFromInstruction(instruction, elements);
    if (nodeIds.length >= 2) {
      for (let i = 0; i < nodeIds.length - 1; i++) {
        const fromEl = elements.find(e => e.id === nodeIds[i]);
        const toEl = elements.find(e => e.id === nodeIds[i + 1]);
        
        if (fromEl && toEl) {
          const fromAnchor = findNearestAnchor(fromEl, toEl, 'right');
          const toAnchor = findNearestAnchor(toEl, fromEl, 'left');
          
          actions.push({
            type: 'move',
            x: fromEl.x + (fromAnchor?.x || fromEl.width || 0),
            y: fromEl.y + (fromAnchor?.y || (fromEl.height || 0) / 2),
            timestamp: Date.now() + i * 100,
          });
          
          actions.push({
            type: 'pointerDown',
            x: fromEl.x + (fromAnchor?.x || fromEl.width || 0),
            y: fromEl.y + (fromAnchor?.y || (fromEl.height || 0) / 2),
            button: 0,
          });
          
          actions.push({
            type: 'drag',
            from: {
              x: fromEl.x + (fromAnchor?.x || fromEl.width || 0),
              y: fromEl.y + (fromAnchor?.y || (fromEl.height || 0) / 2),
            },
            to: {
              x: toEl.x + (toAnchor?.x || 0),
              y: toEl.y + (toAnchor?.y || (toEl.height || 0) / 2),
            },
            steps: 10,
          });
          
          actions.push({
            type: 'pointerUp',
            x: toEl.x + (toAnchor?.x || 0),
            y: toEl.y + (toAnchor?.y || (toEl.height || 0) / 2),
            button: 0,
          });
          
          actions.push({
            type: 'connect',
            fromId: fromEl.id,
            fromAnchor: fromAnchor?.id || 'right',
            toId: toEl.id,
            toAnchor: toAnchor?.id || 'left',
            confidence: 0.9,
          });
        }
      }
    }
  }

  // Add meta action with explanation
  if (actions.length > 0) {
    actions.push({
      type: 'meta',
      confidence: actions[0].confidence || 0.8,
      explanation: `Executed: ${instruction}`,
    });
  }

  return actions;
}

function parseRegionFromInstruction(
  instruction: string,
  viewport: { x: number; y: number; scale: number }
): { x: number; y: number; width: number; height: number } {
  const lower = instruction.toLowerCase();
  const defaultWidth = 1200;
  const defaultHeight = 800;
  const width = defaultWidth / viewport.scale;
  const height = defaultHeight / viewport.scale;
  
  if (lower.includes('top-right')) {
    return {
      x: width * 0.5,
      y: 0,
      width: width * 0.5,
      height: height * 0.5,
    };
  } else if (lower.includes('top-left')) {
    return {
      x: 0,
      y: 0,
      width: width * 0.5,
      height: height * 0.5,
    };
  } else if (lower.includes('bottom')) {
    return {
      x: 0,
      y: height * 0.5,
      width: width,
      height: height * 0.5,
    };
  }
  
  // Default: center region
  return {
    x: width * 0.25,
    y: height * 0.25,
    width: width * 0.5,
    height: height * 0.5,
  };
}

function isElementInRegion(
  element: any,
  region: { x: number; y: number; width: number; height: number }
): boolean {
  if (!element.width || !element.height) return false;
  
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  
  return (
    centerX >= region.x &&
    centerX <= region.x + region.width &&
    centerY >= region.y &&
    centerY <= region.y + region.height
  );
}

function extractColorFromInstruction(instruction: string): string {
  const colors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'black', 'white'];
  const lower = instruction.toLowerCase();
  return colors.find(c => lower.includes(c)) || '';
}

function extractNodeIdsFromInstruction(
  instruction: string,
  elements: any[]
): string[] {
  // Try to match by element IDs or labels
  const words = instruction.toLowerCase().split(/\s+/);
  const nodeIds: string[] = [];
  
  for (const word of words) {
    // Try to find element by ID
    const byId = elements.find(e => e.id.toLowerCase().includes(word));
    if (byId) nodeIds.push(byId.id);
    
    // Try to find by label or text
    const byText = elements.find(e => 
      e.meta?.text?.toLowerCase().includes(word)
    );
    if (byText && !nodeIds.includes(byText.id)) {
      nodeIds.push(byText.id);
    }
  }
  
  return nodeIds;
}

function findNearestAnchor(
  element: any,
  targetElement: any,
  preferredSide: 'left' | 'right' | 'top' | 'bottom'
): { id: string; x: number; y: number } | null {
  if (!element.meta?.anchors || element.meta.anchors.length === 0) {
    // Generate default anchor
    const width = element.width || 100;
    const height = element.height || 100;
    
    switch (preferredSide) {
      case 'right':
        return { id: 'right', x: width, y: height / 2 };
      case 'left':
        return { id: 'left', x: 0, y: height / 2 };
      case 'top':
        return { id: 'top', x: width / 2, y: 0 };
      case 'bottom':
        return { id: 'bottom', x: width / 2, y: height };
      default:
        return { id: 'center', x: width / 2, y: height / 2 };
    }
  }
  
  // Find anchor closest to target element
  const targetCenterX = (targetElement.x || 0) + (targetElement.width || 0) / 2;
  const targetCenterY = (targetElement.y || 0) + (targetElement.height || 0) / 2;
  
  let nearest: { id: string; x: number; y: number } | null = null;
  let minDistance = Infinity;
  
  for (const anchor of element.meta.anchors) {
    const anchorX = element.x + anchor.x;
    const anchorY = element.y + anchor.y;
    const distance = Math.sqrt(
      Math.pow(anchorX - targetCenterX, 2) + Math.pow(anchorY - targetCenterY, 2)
    );
    
    if (distance < minDistance) {
      minDistance = distance;
      nearest = anchor;
    }
  }
  
  return nearest;
}

function calculateConfidence(
  instruction: string,
  actions: CursorAgentAction[],
  elements: any[]
): number {
  if (actions.length === 0) return 0;
  
  // Base confidence on action type and element availability
  let confidence = 0.7;
  
  if (actions.some(a => a.type === 'selectSet' && a.elementIds && a.elementIds.length > 0)) {
    confidence = 0.85;
  }
  
  if (actions.some(a => a.type === 'connect')) {
    confidence = 0.9;
  }
  
  if (elements.length === 0) {
    confidence *= 0.5; // Lower confidence if no elements found
  }
  
  return Math.min(confidence, 0.95);
}

function generatePreviewPolygons(
  actions: CursorAgentAction[],
  elements: any[]
): Array<{ points: Array<{ x: number; y: number }> }> {
  const polygons: Array<{ points: Array<{ x: number; y: number }> }> = [];
  
  for (const action of actions) {
    if (action.type === 'selectionRect' && action.x1 !== undefined && action.y1 !== undefined && action.x2 !== undefined && action.y2 !== undefined) {
      polygons.push({
        points: [
          { x: action.x1, y: action.y1 },
          { x: action.x2, y: action.y1 },
          { x: action.x2, y: action.y2 },
          { x: action.x1, y: action.y2 },
        ],
      });
    } else if (action.type === 'selectionLasso' && action.points) {
      polygons.push({ points: action.points });
    }
  }
  
  return polygons;
}

export const cursorAgentService = {
  planAgentActions,
};

