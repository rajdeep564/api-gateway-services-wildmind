import { Request, Response } from 'express';
import { projectRepository } from '../../repository/canvas/projectRepository';
import { opRepository } from '../../repository/canvas/opRepository';
import { listAllElements } from '../../repository/canvas/elementRepository';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ApiError } from '../../utils/errorHandler';
import { CanvasProject, CanvasSnapshot } from '../../types/canvas';
import { admin } from '../../config/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { getSessionState, requestSessionTakeover, resolveSessionTakeover } from '../../services/canvas/projectSessionStore';
import { notifyProjectOpenedElsewhere, notifySessionTakeoverAccepted, notifySessionTakeoverRejected, notifySessionTakeoverRequested } from '../../services/canvas/canvasSessionNotifier';

/** Comma-separated project IDs in PUBLIC_CANVAS_SNAPSHOT_PROJECT_IDS (homepage showcase, etc.). */
function isPublicSnapshotReadAllowed(projectId: string, project: CanvasProject | null): boolean {
  if (!project) return false;
  if (project.settings?.publicSnapshotRead === true) return true;
  const raw = process.env.PUBLIC_CANVAS_SNAPSHOT_PROJECT_IDS || '';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(projectId);
}

export async function getSnapshot(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id: projectId } = req.params;
    const fromOp = parseInt(req.query.fromOp as string) || 0;

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

    // Get latest snapshot (don't create on-the-fly - let worker handle it)
    let snapshot = await projectRepository.getLatestSnapshot(projectId);
    let snapshotOpIndex = project.lastSnapshotOpIndex || 0;

    // If no snapshot exists, start from op 0 and get all ops
    // This is fine for new projects - they'll get a snapshot created by the worker later
    if (!snapshot) {
      snapshotOpIndex = -1; // Start from beginning
      snapshot = {
        projectId,
        snapshotOpIndex: -1,
        elements: {},
        metadata: {
          version: '1.0',
          createdAt: admin.firestore.Timestamp.now(),
        },
      };
    }

    // Get ops after snapshot (or all ops if no snapshot)
    const startOpIndex = snapshotOpIndex >= 0 ? snapshotOpIndex + 1 : 0;
    const ops = await opRepository.listOps(projectId, startOpIndex, 1000);

    res.json(formatApiResponse('success', 'Snapshot retrieved', {
      snapshot,
      ops,
      fromOp: startOpIndex,
    }));

    // Note: Snapshots are created by the worker, not on-the-fly
    // This prevents expensive snapshot creation on every GET request
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to get snapshot', null)
    );
  }
}

export async function createSnapshot(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id: projectId } = req.params;

    // Verify access (only owner/editor can create snapshots)
    const project = await projectRepository.getProject(projectId);
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    const userRole = project.ownerUid === userId
      ? 'owner'
      : project.collaborators.find(c => c.uid === userId)?.role;

    if (userRole !== 'owner' && userRole !== 'editor') {
      throw new ApiError('Only owners and editors can create snapshots', 403);
    }

    // Get current op index
    const counterRef = (await import('../../config/firebaseAdmin')).adminDb
      .collection('canvasProjects')
      .doc(projectId)
      .collection('counters')
      .doc('opIndex');

    const counterSnap = await counterRef.get();
    const currentOpIndex = counterSnap.data()?.value || 0;

    // Get all elements
    const elementsRef = (await import('../../config/firebaseAdmin')).adminDb
      .collection('canvasProjects')
      .doc(projectId)
      .collection('elements');

    const elementsSnap = await elementsRef.get();
    const elements: Record<string, any> = {};

    elementsSnap.docs.forEach(doc => {
      elements[doc.id] = { id: doc.id, ...doc.data() };
    });

    const snapshot: CanvasSnapshot = {
      projectId,
      snapshotOpIndex: currentOpIndex,
      elements,
      metadata: {
        version: '1.0',
        createdAt: new Date() as any,
      },
    };

    await projectRepository.saveSnapshot(projectId, snapshot, currentOpIndex);

    res.json(formatApiResponse('success', 'Snapshot created', { snapshot }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to create snapshot', null)
    );
  }
}

// Overwrite current snapshot (no op-index semantics). Accepts full canvas state.
export async function setCurrentSnapshot(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id: projectId } = req.params;
    const body = req.body || {};

    // Verify access (owner/editor can overwrite snapshot)
    const project = await projectRepository.getProject(projectId);
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    const userRole = project.ownerUid === userId
      ? 'owner'
      : project.collaborators.find(c => c.uid === userId)?.role;
    if (userRole !== 'owner' && userRole !== 'editor') {
      throw new ApiError('Only owners and editors can update snapshot', 403);
    }

    // Expect body: { elements: Record<string, any>, metadata?: Record<string, any> }
    const elements = body.elements || {};
    const incomingMetadata = body.metadata || {};

    // Get existing snapshot to preserve existing metadata
    const existingSnapshot = await projectRepository.getCurrentSnapshot(projectId);
    const existingMetadata = (existingSnapshot?.metadata || {}) as Record<string, any>;

    // Log what we're receiving
    console.log('[SNAPSHOT RECEIVED]', Object.keys(elements).length, 'metadata:', Object.keys(incomingMetadata));


    // Merge incoming metadata with existing metadata, preserving all fields
    // For nested objects like 'stitched-image', we need to merge them properly
    const mergedMetadata: Record<string, any> = {
      ...existingMetadata,
    };

    // Merge each key from incoming metadata
    for (const key in incomingMetadata) {
      if (key === 'version' || key === 'createdAt') {
        // Skip these, we'll set them explicitly
        continue;
      }
      if (typeof incomingMetadata[key] === 'object' && incomingMetadata[key] !== null && !Array.isArray(incomingMetadata[key])) {
        // Merge nested objects (like 'stitched-image')
        mergedMetadata[key] = {
          ...(existingMetadata[key] || {}),
          ...incomingMetadata[key],
        };
      } else {
        // Replace primitive values
        mergedMetadata[key] = incomingMetadata[key];
      }
    }

    // Ensure version and createdAt are always set
    mergedMetadata.version = (incomingMetadata.version || existingMetadata.version || '1.0') as string;
    if (!existingMetadata.createdAt) {
      mergedMetadata.createdAt = admin.firestore.Timestamp.now();
    } else {
      mergedMetadata.createdAt = existingMetadata.createdAt;
    }



    const snapshot: CanvasSnapshot = {
      projectId,
      snapshotOpIndex: -1,
      elements,
      metadata: mergedMetadata as CanvasSnapshot['metadata'],
    };

    await projectRepository.saveCurrentSnapshot(projectId, snapshot);

    // Extract images for project preview
    try {
      const imageUrls: string[] = [];
      const seenUrls = new Set<string>();

      // 1. Check metadata for stitched image or others
      if (mergedMetadata['stitched-image']) {
        const url = typeof mergedMetadata['stitched-image'] === 'string'
          ? mergedMetadata['stitched-image']
          : mergedMetadata['stitched-image'].url;
        if (url && !seenUrls.has(url)) {
          imageUrls.push(url);
          seenUrls.add(url);
        }
      }

      // 2. Extract from elements
      for (const elId in elements) {
        const el = elements[elId];
        const urlsToCheck = [
          el.meta?.url,
          el.generatedImageUrl,
          el.generatedVideoUrl,
          ...(Array.isArray(el.generatedImageUrls) ? el.generatedImageUrls : [])
        ];

        for (const url of urlsToCheck) {
          if (url && typeof url === 'string' && !seenUrls.has(url)) {
            imageUrls.push(url);
            seenUrls.add(url);
          }
        }
      }

      if (imageUrls.length > 0) {
        // Randomize order for the previewImages array
        const shuffled = [...imageUrls].sort(() => Math.random() - 0.5).slice(0, 10);
        await projectRepository.updateProject(projectId, {
          thumbnail: shuffled[0], // Set one as primary thumbnail
          previewImages: shuffled,
        });
      }
    } catch (prevErr) {
      console.error('[setCurrentSnapshot] Failed to update project preview images:', prevErr);
      // Non-blocking error
    }

    // Verify it was saved
    const verify = await projectRepository.getCurrentSnapshot(projectId);
    const savedMeta = (verify?.metadata || {}) as Record<string, any>;


    res.json(formatApiResponse('success', 'Current snapshot updated', { snapshot }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to update snapshot', null)
    );
  }
}

// Get the current snapshot (overwrite model). Returns null if not set yet.
export async function getCurrentSnapshot(req: Request, res: Response) {
  try {
    const userId = (req as any).uid as string | undefined;
    const { id: projectId } = req.params;

    const project = await projectRepository.getProject(projectId);
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    const publicRead = isPublicSnapshotReadAllowed(projectId, project);
    const isCollaborator =
      !!userId &&
      (project.ownerUid === userId ||
        project.collaborators.some((c) => c.uid === userId));

    if (!publicRead && !isCollaborator) {
      if (!userId) {
        throw new ApiError('Unauthorized', 401);
      }
      throw new ApiError('Access denied', 403);
    }

    // 1. Get the base snapshot (metadata + viewport)
    let snapshot = await projectRepository.getCurrentSnapshot(projectId);

    // 2. (Legacy) Elements were previously authoritative from collection. 
    // Now Snapshot Document is SSoT.
    // const elementsList = await elementRepository.listAllElements(projectId);

    // 3. Construct/Merge Snapshot
    if (!snapshot) {
      // If no current snapshot doc exists yet, create a scaffold
      snapshot = {
        projectId,
        snapshotOpIndex: -1,
        elements: {},
        metadata: {
          version: '1.0',
          createdAt: admin.firestore.Timestamp.now(),
        }
      };
    }

    // 4. (Legacy) Overwrite removed.
    // snapshot.elements = {};
    // for (const el of elementsList) {
    //   snapshot.elements[el.id] = el;
    // }

    // 5. Session takeover — only for authenticated collaborators (skip for public embed traffic).
    const canvasSessionId = req.get('x-canvas-session-id') || undefined;
    if (isCollaborator && canvasSessionId && canvasSessionId.trim()) {
      const normalizedSessionId = canvasSessionId.trim();
      const takeover = requestSessionTakeover(projectId, normalizedSessionId);
      if (takeover.status === 'granted') {
        notifyProjectOpenedElsewhere(projectId, normalizedSessionId);
      } else if (takeover.currentSessionId) {
        notifySessionTakeoverRequested(projectId, takeover.currentSessionId, normalizedSessionId);
      }
    }

    return res.json(formatApiResponse('success', 'Current snapshot retrieved', { snapshot }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to get snapshot', null)
    );
  }
}

/** GET /projects/:id/session-status — Polling fallback for "project opened elsewhere". Returns sessionIsCurrent. */
export async function getSessionStatus(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }
    const { id: projectId } = req.params;
    const rawSessionId = req.get('x-canvas-session-id') || req.query.sessionId;
    const canvasSessionId: string | null =
      typeof rawSessionId === 'string' ? rawSessionId
        : Array.isArray(rawSessionId) && typeof rawSessionId[0] === 'string' ? rawSessionId[0]
          : null;

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

    const sessionState = getSessionState(projectId, canvasSessionId || null);
    return res.json(formatApiResponse('success', 'Session status', sessionState));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to get session status', null)
    );
  }
}

export async function respondToSessionTakeover(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }
    const { id: projectId } = req.params;
    const { action } = req.body as { action?: 'accept' | 'reject' };
    const rawSessionId = req.get('x-canvas-session-id');
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';

    if (!sessionId) {
      throw new ApiError('Session id is required', 400);
    }
    if (action !== 'accept' && action !== 'reject') {
      throw new ApiError('Invalid action', 400);
    }

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

    const result = resolveSessionTakeover(projectId, sessionId, action);
    if (result.requesterSessionId) {
      if (action === 'accept') {
        notifySessionTakeoverAccepted(projectId, result.requesterSessionId, sessionId);
      } else {
        notifySessionTakeoverRejected(projectId, result.requesterSessionId);
      }
    }

    return res.json(formatApiResponse('success', 'Session takeover handled', {
      action,
      requesterSessionId: result.requesterSessionId,
      currentSessionId: result.currentSessionId,
    }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to respond to session takeover', null)
    );
  }
}
