import { Request, Response, NextFunction } from 'express';
import { liveChatSessionService } from '../services/liveChatSessionService';
import { formatApiResponse } from '../utils/formatApiResponse';

/**
 * Create a new live chat session
 * POST /api/live-chat-sessions
 */
async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const result = await liveChatSessionService.createSession(uid, req.body);
    return res.json(formatApiResponse('success', 'Session created', result));
  } catch (err) {
    return next(err);
  }
}

/**
 * Add a message with images to a session
 * POST /api/live-chat-sessions/:sessionDocId/messages
 */
async function addMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const { sessionDocId } = req.params;
    await liveChatSessionService.addMessage(uid, {
      sessionDocId,
      ...req.body,
    });
    return res.json(formatApiResponse('success', 'Message added', {}));
  } catch (err) {
    return next(err);
  }
}

/**
 * Complete a session
 * PATCH /api/live-chat-sessions/:sessionDocId/complete
 */
async function complete(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const { sessionDocId } = req.params;
    await liveChatSessionService.completeSession(uid, {
      sessionDocId,
      completedAt: req.body.completedAt || new Date().toISOString(),
    });
    return res.json(formatApiResponse('success', 'Session completed', {}));
  } catch (err) {
    return next(err);
  }
}

/**
 * Get a session by document ID
 * GET /api/live-chat-sessions/:sessionDocId
 */
async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const { sessionDocId } = req.params;
    const session = await liveChatSessionService.getSession(uid, sessionDocId);
    return res.json(formatApiResponse('success', 'OK', { session }));
  } catch (err) {
    return next(err);
  }
}

/**
 * Get a session by image URL
 * This is the key endpoint for restoring sessions when clicking on an image
 * GET /api/live-chat-sessions/by-image-url?imageUrl=...
 */
async function getByImageUrl(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const { imageUrl } = req.query;
    
    if (!imageUrl || typeof imageUrl !== 'string') {
      return res.status(400).json(formatApiResponse('error', 'imageUrl query parameter is required', {}));
    }

    const session = await liveChatSessionService.getSessionByImageUrl(uid, imageUrl);
    return res.json(formatApiResponse('success', 'OK', { session }));
  } catch (err) {
    return next(err);
  }
}

/**
 * List all sessions for the current user
 * GET /api/live-chat-sessions
 */
async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const { limit, cursor, status } = req.query;
    const result = await liveChatSessionService.listSessions(uid, {
      limit: limit ? Number(limit) : undefined,
      cursor: cursor as string | undefined,
      status: status as 'active' | 'completed' | 'failed' | undefined,
    });
    return res.json(formatApiResponse('success', 'OK', result));
  } catch (err) {
    return next(err);
  }
}

/**
 * Find or create a session by sessionId
 * POST /api/live-chat-sessions/find-or-create
 */
async function findOrCreate(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const { sessionId, model, frameSize, style, startedAt } = req.body;
    
    if (!sessionId || !model || !startedAt) {
      return res.status(400).json(formatApiResponse('error', 'sessionId, model, and startedAt are required', {}));
    }

    const result = await liveChatSessionService.findOrCreateSession(uid, sessionId, {
      model,
      frameSize,
      style,
      startedAt,
    });
    return res.json(formatApiResponse('success', 'OK', result));
  } catch (err) {
    return next(err);
  }
}

/**
 * Update a session
 * PATCH /api/live-chat-sessions/:sessionDocId
 */
async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const { sessionDocId } = req.params;
    
    // Verify ownership
    const session = await liveChatSessionService.getSession(uid, sessionDocId);
    if (!session) {
      return res.status(404).json(formatApiResponse('error', 'Session not found', {}));
    }

    // Update session (delegate to service if needed)
    // For now, we'll use the repository directly via service
    const { liveChatSessionRepository } = await import('../repository/liveChatSessionRepository');
    await liveChatSessionRepository.update(sessionDocId, req.body);
    
    return res.json(formatApiResponse('success', 'Session updated', {}));
  } catch (err) {
    return next(err);
  }
}

export const liveChatSessionController = {
  create,
  addMessage,
  complete,
  get,
  getByImageUrl,
  list,
  findOrCreate,
  update,
};

