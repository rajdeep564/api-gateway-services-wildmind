/**
 * WebSocket Server for Canvas Presence
 * 
 * This module provides real-time presence tracking for Canvas projects.
 * Uses HTTP-based presence updates (can be upgraded to WebSocket later).
 * 
 * For now, implements a simple HTTP-based presence system that can be
 * upgraded to WebSocket when needed.
 */

import { Request, Response } from 'express';
import { formatApiResponse } from '../utils/formatApiResponse';
import { ApiError } from '../utils/errorHandler';
import { getRedisClient, isRedisEnabled } from '../config/redisClient';
import { projectRepository } from '../repository/canvas/projectRepository';
import { adminDb, admin } from '../config/firebaseAdmin';

const PRESENCE_TTL = 5; // 5 seconds TTL for presence

/**
 * Update user presence in a project
 * POST /api/canvas/projects/:id/presence
 */
export async function updatePresence(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id: projectId } = req.params;
    const { x, y, tool, color, selection } = req.body;

    // Verify user has access to project
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

    const presenceData = {
      uid: userId,
      projectId,
      x: x || 0,
      y: y || 0,
      tool: tool || 'cursor',
      color: color || '#3b82f6',
      selection: selection || [],
      lastSeen: admin.firestore.Timestamp.now(),
    };

    // Store in Redis if available (faster)
    if (isRedisEnabled()) {
      const redis = getRedisClient();
      if (redis) {
        const key = `presence:${projectId}:${userId}`;
        await redis.setEx(key, PRESENCE_TTL, JSON.stringify(presenceData));
      }
    }

    // Also store in Firestore for persistence
    const presenceRef = adminDb
      .collection('canvasProjects')
      .doc(projectId)
      .collection('presence')
      .doc(userId);
    
    await presenceRef.set(presenceData, { merge: true });

    res.json(formatApiResponse('success', 'Presence updated', null));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to update presence', null)
    );
  }
}

/**
 * Get all active presences for a project
 * GET /api/canvas/projects/:id/presence
 */
export async function getPresences(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id: projectId } = req.params;

    // Verify user has access to project
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

    const presences: any[] = [];

    // Try Redis first (faster)
    if (isRedisEnabled()) {
      const redis = getRedisClient();
      if (redis) {
        const keys = await redis.keys(`presence:${projectId}:*`);
        
        for (const key of keys) {
          const data = await redis.get(key);
          if (data) {
            try {
              presences.push(JSON.parse(data));
            } catch (e) {
              // Invalid JSON, skip
            }
          }
        }
      }
    }

    // Fallback to Firestore
    if (presences.length === 0) {
      const presenceRef = adminDb
        .collection('canvasProjects')
        .doc(projectId)
        .collection('presence');
      
      const snap = await presenceRef.get();
      const now = admin.firestore.Timestamp.now();
      
      snap.docs.forEach(doc => {
        const data = doc.data();
        const lastSeen = data.lastSeen?.toMillis?.() || 0;
        const ageSeconds = (now.toMillis() - lastSeen) / 1000;
        
        // Only include presences from last 10 seconds
        if (ageSeconds < 10) {
          presences.push({
            uid: doc.id,
            ...data,
          });
        }
      });
    }

    res.json(formatApiResponse('success', 'Presences retrieved', { presences }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to get presences', null)
    );
  }
}

/**
 * Remove user presence (on disconnect)
 * DELETE /api/canvas/projects/:id/presence
 */
export async function removePresence(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id: projectId } = req.params;

    // Remove from Redis
    if (isRedisEnabled()) {
      const redis = getRedisClient();
      if (redis) {
        await redis.del(`presence:${projectId}:${userId}`);
      }
    }

    // Remove from Firestore
    const presenceRef = adminDb
      .collection('canvasProjects')
      .doc(projectId)
      .collection('presence')
      .doc(userId);
    
    await presenceRef.delete();

    res.json(formatApiResponse('success', 'Presence removed', null));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to remove presence', null)
    );
  }
}

