import { Request, Response } from 'express';
import { projectRepository } from '../../repository/canvas/projectRepository';
import { opRepository } from '../../repository/canvas/opRepository';
import { elementRepository } from '../../repository/canvas/elementRepository';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ApiError } from '../../utils/errorHandler';
import { CanvasSnapshot } from '../../types/canvas';
import { admin } from '../../config/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';

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
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }
    const { id: projectId } = req.params;

    // Verify access (owner, collaborator viewer/editor)
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

    const snapshot = await projectRepository.getCurrentSnapshot(projectId);
    res.json(formatApiResponse('success', 'Current snapshot retrieved', { snapshot }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to get snapshot', null)
    );
  }
}

