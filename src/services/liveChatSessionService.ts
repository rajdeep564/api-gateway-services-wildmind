import { liveChatSessionRepository } from '../repository/liveChatSessionRepository';
import { ApiError } from '../utils/errorHandler';

export interface CreateLiveChatSessionPayload {
  sessionId: string;
  model: string;
  frameSize?: string;
  style?: string;
  startedAt: string; // ISO string
}

export interface AddMessageToSessionPayload {
  sessionDocId: string;
  prompt: string;
  images: Array<{
    id: string;
    url: string;
    storagePath?: string;
    originalUrl?: string;
    firebaseUrl?: string;
  }>;
  timestamp: string; // ISO string
}

export interface CompleteSessionPayload {
  sessionDocId: string;
  completedAt: string; // ISO string
}

/**
 * Create a new live chat session
 */
export async function createSession(
  uid: string,
  payload: CreateLiveChatSessionPayload
): Promise<{ sessionDocId: string }> {
  // Check if session with same sessionId already exists
  const existing = await liveChatSessionRepository.findBySessionId(payload.sessionId);
  if (existing) {
    // Return existing session doc ID
    return { sessionDocId: existing.id };
  }

  const result = await liveChatSessionRepository.create(uid, payload);
  return result;
}

/**
 * Add a message with images to an existing session
 */
export async function addMessage(
  uid: string,
  payload: AddMessageToSessionPayload
): Promise<void> {
  const session = await liveChatSessionRepository.get(payload.sessionDocId);
  if (!session) throw new ApiError('Session not found', 404);
  if (session.uid !== uid) throw new ApiError('Unauthorized', 403);

  await liveChatSessionRepository.addMessage(payload.sessionDocId, {
    prompt: payload.prompt,
    images: payload.images,
    timestamp: payload.timestamp,
  });
}

/**
 * Complete a session
 */
export async function completeSession(
  uid: string,
  payload: CompleteSessionPayload
): Promise<void> {
  const session = await liveChatSessionRepository.get(payload.sessionDocId);
  if (!session) throw new ApiError('Session not found', 404);
  if (session.uid !== uid) throw new ApiError('Unauthorized', 403);

  await liveChatSessionRepository.update(payload.sessionDocId, {
    status: 'completed',
    completedAt: payload.completedAt,
  } as any);
}

/**
 * Get session by document ID
 */
export async function getSession(
  uid: string,
  sessionDocId: string
): Promise<any> {
  const session = await liveChatSessionRepository.get(sessionDocId);
  if (!session) throw new ApiError('Session not found', 404);
  if (session.uid !== uid) throw new ApiError('Unauthorized', 403);
  return session;
}

/**
 * Get session by image URL
 * This is the key function for restoring sessions when clicking on an image
 */
export async function getSessionByImageUrl(
  uid: string,
  imageUrl: string
): Promise<any> {
  const session = await liveChatSessionRepository.findByImageUrl(imageUrl);
  if (!session) throw new ApiError('Session not found', 404);
  if (session.uid !== uid) throw new ApiError('Unauthorized', 403);
  return session;
}

/**
 * List all sessions for a user
 */
export async function listSessions(
  uid: string,
  params: {
    limit?: number;
    cursor?: string;
    status?: 'active' | 'completed' | 'failed';
  }
): Promise<{ sessions: any[]; nextCursor?: string }> {
  return liveChatSessionRepository.findByUserId(uid, params);
}

/**
 * Find or create a session by sessionId
 * If session exists, return its doc ID; otherwise create new one
 */
export async function findOrCreateSession(
  uid: string,
  sessionId: string,
  initialData: {
    model: string;
    frameSize?: string;
    style?: string;
    startedAt: string;
  }
): Promise<{ sessionDocId: string }> {
  const existing = await liveChatSessionRepository.findBySessionId(sessionId);
  if (existing && existing.uid === uid) {
    return { sessionDocId: existing.id };
  }

  return createSession(uid, {
    sessionId,
    ...initialData,
  });
}

export const liveChatSessionService = {
  createSession,
  addMessage,
  completeSession,
  getSession,
  getSessionByImageUrl,
  listSessions,
  findOrCreateSession,
};

