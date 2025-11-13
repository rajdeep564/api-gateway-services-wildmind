import { Request, Response } from 'express';
import { projectRepository } from '../../repository/canvas/projectRepository';
import { opRepository } from '../../repository/canvas/opRepository';
import { elementRepository } from '../../repository/canvas/elementRepository';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ApiError } from '../../utils/errorHandler';
import { CanvasSnapshot } from '../../types/canvas';
import { admin } from '../../config/firebaseAdmin';

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

