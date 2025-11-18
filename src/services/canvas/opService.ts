import { opRepository } from '../../repository/canvas/opRepository';
import { elementRepository } from '../../repository/canvas/elementRepository';
import { projectRepository } from '../../repository/canvas/projectRepository';
import { CanvasOp, CanvasElement } from '../../types/canvas';
import { ApiError } from '../../utils/errorHandler';

export async function appendOp(
  projectId: string,
  userId: string,
  op: Omit<CanvasOp, 'id' | 'opIndex' | 'createdAt' | 'projectId' | 'actorUid'>
): Promise<{ opId: string; opIndex: number }> {
  // Verify user has access
  const project = await projectRepository.getProject(projectId);
  if (!project) {
    throw new ApiError('Project not found', 404);
  }

  const hasAccess = 
    project.ownerUid === userId ||
    project.collaborators.some(c => c.uid === userId);
  
  if (!hasAccess) {
    throw new ApiError('Access denied', 403);
  }

  // Check for duplicate requestId
  if (op.requestId) {
    const existing = await opRepository.getOpsByRequestId(projectId, op.requestId);
    if (existing) {
      return { opId: existing.id, opIndex: existing.opIndex };
    }
  }

  // Append op with server-assigned index
  const result = await opRepository.appendOp(projectId, {
    ...op,
    projectId,
    actorUid: userId,
  });

  // Update elements based on op type (batched)
  await applyOpToElements(projectId, {
    ...op,
    opIndex: result.opIndex,
    actorUid: userId,
  } as CanvasOp);

  return result;
}

async function applyOpToElements(projectId: string, op: CanvasOp): Promise<void> {
  const batch: Array<Omit<CanvasElement, 'projectId' | 'createdAt' | 'updatedAt'>> = [];

  switch (op.type) {
    case 'create':
      if (op.data.element) {
        batch.push(op.data.element);
      }
      break;
    
    case 'update':
      if (op.elementId && op.data.updates) {
        const existing = await elementRepository.getElement(projectId, op.elementId);
        if (existing) {
          batch.push({
            ...existing,
            ...op.data.updates,
          });
        }
      }
      break;
    
    case 'delete':
      if (op.elementId) {
        await elementRepository.deleteElement(projectId, op.elementId);
      }
      if (op.elementIds) {
        for (const id of op.elementIds) {
          await elementRepository.deleteElement(projectId, id);
        }
      }
      break;
    
    case 'move':
      if (op.elementId && op.data.delta) {
        const existing = await elementRepository.getElement(projectId, op.elementId);
        if (existing) {
          batch.push({
            ...existing,
            x: existing.x + op.data.delta.x,
            y: existing.y + op.data.delta.y,
          });
        }
      }
      if (op.elementIds && op.data.delta) {
        for (const id of op.elementIds) {
          const existing = await elementRepository.getElement(projectId, id);
          if (existing) {
            batch.push({
              ...existing,
              x: existing.x + op.data.delta.x,
              y: existing.y + op.data.delta.y,
            });
          }
        }
      }
      break;
    
    case 'connect':
      if (op.data.fromId && op.data.toId) {
        // Create connector element
        const connector: Omit<CanvasElement, 'projectId' | 'createdAt' | 'updatedAt'> = {
          id: op.data.connectorId || `connector-${Date.now()}`,
          type: 'connector',
          x: op.data.fromX || 0,
          y: op.data.fromY || 0,
          meta: {
            connectorFrom: op.data.fromId,
            connectorTo: op.data.toId,
            ...(op.data.fromAnchor && { fromAnchor: op.data.fromAnchor }),
            ...(op.data.toAnchor && { toAnchor: op.data.toAnchor }),
          } as CanvasElement['meta'],
        };
        batch.push(connector);
      }
      break;
    case 'group':
      if (op.data.element) {
        // Upsert the group element
        batch.push(op.data.element);
        // Also set meta.groupId on member elements if provided
        const memberIds: string[] = op.data.element.meta?.memberElementIds || [];
        for (const mid of memberIds) {
          const existing = await elementRepository.getElement(projectId, mid);
          if (existing) {
            const updated = { ...existing, meta: { ...(existing.meta || {}), groupId: op.elementId } };
            batch.push(updated);
          }
        }
      }
      break;
    case 'ungroup':
      // Remove group element and clear groupId from member elements
      if (op.elementId) {
        const groupEl = await elementRepository.getElement(projectId, op.elementId);
        if (groupEl) {
          const memberIds: string[] = groupEl.meta?.memberElementIds || [];
          for (const mid of memberIds) {
            const existing = await elementRepository.getElement(projectId, mid);
            if (existing) {
              const updatedMeta = { ...(existing.meta || {}) };
              if (updatedMeta.groupId) delete updatedMeta.groupId;
              batch.push({ ...existing, meta: updatedMeta });
            }
          }
          // Delete group element document
          await elementRepository.deleteElement(projectId, op.elementId);
        }
      }
      break;
  }

  if (batch.length > 0) {
    await elementRepository.batchUpsertElements(projectId, batch);
  }
}

export async function getOpsAfterIndex(
  projectId: string,
  userId: string,
  fromIndex: number,
  limit: number = 100
): Promise<CanvasOp[]> {
  // Verify access
  const project = await projectRepository.getProject(projectId);
  if (!project) {
    throw new ApiError('Project not found', 404);
  }

  const hasAccess = 
    project.ownerUid === userId ||
    project.collaborators.some(c => c.uid === userId);
  
  if (!hasAccess) {
    throw new ApiError('Access denied', 403);
  }

  return opRepository.listOps(projectId, fromIndex, limit);
}

export function computeInverseOp(op: CanvasOp): CanvasOp | undefined {
  switch (op.type) {
    case 'create':
      return {
        ...op,
        type: 'delete',
        data: { elementId: op.elementId },
      } as CanvasOp;
    
    case 'delete':
      return {
        ...op,
        type: 'create',
        data: { element: op.data.elementSnapshot },
      } as CanvasOp;
    
    case 'move':
      return {
        ...op,
        data: {
          delta: {
            x: -(op.data.delta?.x || 0),
            y: -(op.data.delta?.y || 0),
          },
        },
      } as CanvasOp;
    
    case 'update':
      return {
        ...op,
        data: {
          updates: op.data.previousState,
        },
      } as CanvasOp;
    case 'group':
      return {
        ...op,
        type: 'ungroup',
        data: {},
      } as CanvasOp;
    case 'ungroup':
      return {
        ...op,
        type: 'group',
        data: {
          element: op.data.elementSnapshot,
        },
      } as CanvasOp;
    
    default:
      return undefined;
  }
}

export const opService = {
  appendOp,
  getOpsAfterIndex,
  computeInverseOp,
};

