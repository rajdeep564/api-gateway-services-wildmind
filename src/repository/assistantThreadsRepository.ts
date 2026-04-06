import { admin, adminDb } from '../config/firebaseAdmin';
import { generateGpt5NanoResponse } from '../services/genai/gpt5NanoService';

export type AssistantThreadMode = 'agent' | 'chat';
export type AssistantThreadRole = 'user' | 'assistant';

export interface AssistantAttachment {
  id: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  fileName?: string | null;
  mimeType?: string | null;
  storagePath?: string | null;
  sizeBytes?: number | null;
}

export interface AssistantThreadMessage {
  id: string;
  role: AssistantThreadRole;
  content: string;
  attachments: AssistantAttachment[];
  modelInput?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AssistantThread {
  id: string;
  uid: string;
  mode: AssistantThreadMode;
  modelId: string;
  title: string;
  lastMessagePreview?: string | null;
  messageCount: number;
  attachmentCount: number;
  isDeleted?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastMessageAt?: string | null;
}

function toIso(value: any): string | null {
  try {
    if (value && typeof value?.toDate === 'function') {
      return value.toDate().toISOString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

function sanitizePreview(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function deriveTitleFromMessage(message: string): string {
  const preview = sanitizePreview(message);
  return preview.slice(0, 60) || 'New chat';
}

function sanitizeTitleCandidate(title: string): string {
  return String(title || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function isWeakThreadTitle(title?: string | null): boolean {
  const normalized = sanitizeTitleCandidate(title || '').toLowerCase();
  if (!normalized) return true;
  if (normalized.length <= 4) return true;
  if (/^(hi+|hlo+|hello+|hey+|yo+|sup+|test+|new chat|\?+)$/.test(normalized)) {
    return true;
  }
  if (/^(what('?s| is)\s+(this|that)|help|hello whatsapp\??)$/.test(normalized)) {
    return true;
  }
  return false;
}

function buildHeuristicThreadTitle(messages: AssistantThreadMessage[]): string {
  const informativeUserMessage =
    messages
      .filter((message) => message.role === 'user')
      .map((message) => sanitizePreview(message.content))
      .find((message) => message.length >= 12 && !isWeakThreadTitle(message)) ||
    messages
      .map((message) => sanitizePreview(message.content))
      .find((message) => message.length >= 12);

  return sanitizeTitleCandidate(informativeUserMessage || 'New chat') || 'New chat';
}

function buildTitlePrompt(messages: AssistantThreadMessage[]): string {
  const transcript = messages
    .slice(-8)
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${sanitizePreview(message.content)}`)
    .join('\n');

  return [
    'Create a short title for this conversation.',
    'Rules:',
    '- Use 2 to 6 words.',
    '- Reflect the overall topic of the conversation, not just the first message.',
    '- Do not use quotes, punctuation at the end, or filler words like hi/hello/help.',
    '- Return only the title.',
    '',
    'Conversation:',
    transcript,
  ].join('\n');
}

async function generateConversationTitle(messages: AssistantThreadMessage[]): Promise<string> {
  const fallbackTitle = buildHeuristicThreadTitle(messages);

  try {
    const generated = await generateGpt5NanoResponse(buildTitlePrompt(messages), {
      systemPrompt:
        'You write concise conversation titles. Focus on the main topic across the full chat. Never mention that it is a chat or conversation.',
      verbosity: 'low',
      reasoningEffort: 'minimal',
      maxCompletionTokens: 24,
    });

    const title = sanitizeTitleCandidate(generated);
    return title || fallbackTitle;
  } catch (error: any) {
    console.warn('[AssistantThreadsRepository] Title generation fallback used', {
      error: error?.message,
    });
    return fallbackTitle;
  }
}

function normalizeAttachments(value: any): AssistantAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object' && typeof item.url === 'string')
    .map((item) => ({
      id: String(item.id || `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      type: item.type,
      url: String(item.url),
      fileName: item.fileName ?? null,
      mimeType: item.mimeType ?? null,
      storagePath: item.storagePath ?? null,
      sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : null,
    }))
    .filter((item) => item.type === 'image' || item.type === 'video' || item.type === 'audio');
}

function normalizeThread(id: string, data: any): AssistantThread {
  return {
    id,
    uid: String(data?.uid || ''),
    mode: data?.mode === 'chat' ? 'chat' : 'agent',
    modelId: String(data?.modelId || ''),
    title: String(data?.title || 'New chat'),
    lastMessagePreview: data?.lastMessagePreview ?? null,
    messageCount: Number(data?.messageCount || 0),
    attachmentCount: Number(data?.attachmentCount || 0),
    isDeleted: data?.isDeleted === true,
    createdAt: toIso(data?.createdAt),
    updatedAt: toIso(data?.updatedAt),
    lastMessageAt: toIso(data?.lastMessageAt),
  };
}

function normalizeMessage(id: string, data: any): AssistantThreadMessage {
  return {
    id,
    role: data?.role === 'assistant' ? 'assistant' : 'user',
    content: String(data?.content || ''),
    attachments: normalizeAttachments(data?.attachments),
    modelInput: data?.modelInput ?? null,
    metadata: data?.metadata ?? null,
    createdAt: toIso(data?.createdAt),
    updatedAt: toIso(data?.updatedAt),
  };
}

function threadRef(uid: string, threadId: string) {
  return adminDb.collection('assistantThreads').doc(uid).collection('threads').doc(threadId);
}

function messageCollection(uid: string, threadId: string) {
  return threadRef(uid, threadId).collection('messages');
}

export async function createThread(uid: string, data: {
  mode: AssistantThreadMode;
  modelId: string;
  title?: string;
}): Promise<AssistantThread> {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const docRef = threadRef(uid, adminDb.collection('_').doc().id);
  await docRef.set({
    uid,
    mode: data.mode,
    modelId: data.modelId,
    title: data.title?.trim() || 'New chat',
    lastMessagePreview: null,
    messageCount: 0,
    attachmentCount: 0,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  });

  const snap = await docRef.get();
  return normalizeThread(docRef.id, snap.data());
}

export async function listThreads(uid: string, params?: {
  mode?: AssistantThreadMode;
  limit?: number;
}): Promise<AssistantThread[]> {
  const limit = Math.min(Math.max(Number(params?.limit || 30), 1), 100);
  const snap = await adminDb
    .collection('assistantThreads')
    .doc(uid)
    .collection('threads')
    .orderBy('updatedAt', 'desc')
    .limit(limit * 3)
    .get();

  return snap.docs
    .map((doc) => normalizeThread(doc.id, doc.data()))
    .filter((item) => item.isDeleted !== true)
    .filter((item) => !params?.mode || item.mode === params.mode)
    .slice(0, limit);
}

export async function getThread(uid: string, threadId: string): Promise<AssistantThread | null> {
  const snap = await threadRef(uid, threadId).get();
  if (!snap.exists) return null;
  const item = normalizeThread(snap.id, snap.data());
  if (item.isDeleted) return null;
  return item;
}

export async function updateThread(uid: string, threadId: string, updates: Partial<Pick<AssistantThread, 'title' | 'lastMessagePreview' | 'messageCount' | 'attachmentCount'>>): Promise<void> {
  await threadRef(uid, threadId).set(
    {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function softDeleteThread(uid: string, threadId: string): Promise<void> {
  await threadRef(uid, threadId).set(
    {
      isDeleted: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function listMessages(uid: string, threadId: string, limit: number = 50): Promise<AssistantThreadMessage[]> {
  const snap = await messageCollection(uid, threadId)
    .orderBy('createdAt', 'asc')
    .limit(Math.min(Math.max(limit, 1), 200))
    .get();

  return snap.docs.map((doc) => normalizeMessage(doc.id, doc.data()));
}

async function listRecentMessages(uid: string, threadId: string, limit: number = 16): Promise<AssistantThreadMessage[]> {
  const snap = await messageCollection(uid, threadId)
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 50))
    .get();

  return snap.docs
    .map((doc) => normalizeMessage(doc.id, doc.data()))
    .reverse();
}

export async function appendMessages(uid: string, threadId: string, params: {
  threadMode: AssistantThreadMode;
  modelId: string;
  messages: Array<{
    role: AssistantThreadRole;
    content: string;
    attachments?: AssistantAttachment[];
    modelInput?: Record<string, any> | null;
    metadata?: Record<string, any> | null;
  }>;
}): Promise<AssistantThreadMessage[]> {
  const batch = adminDb.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const normalizedMessages = params.messages.map((message) => ({
    role: message.role,
    content: String(message.content || ''),
    attachments: normalizeAttachments(message.attachments),
    modelInput: message.modelInput ?? null,
    metadata: message.metadata ?? null,
  }));

  const createdRefs = normalizedMessages.map(() => messageCollection(uid, threadId).doc());
  normalizedMessages.forEach((message, index) => {
    batch.set(createdRefs[index], {
      ...message,
      createdAt: now,
      updatedAt: now,
    });
  });

  const userFacingMessages = normalizedMessages.filter((message) => message.role === 'user');
  const firstUserMessage = userFacingMessages[0]?.content || normalizedMessages[0]?.content || '';
  const thread = await getThread(uid, threadId);
  const existingMessages = thread ? await listRecentMessages(uid, threadId, 16) : [];
  const titleContextMessages = [
    ...existingMessages,
    ...normalizedMessages.map((message, index) =>
      normalizeMessage(`pending-${index}`, {
        ...message,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    ),
  ];
  const nextTitle =
    !thread?.messageCount || isWeakThreadTitle(thread.title)
      ? await generateConversationTitle(titleContextMessages)
      : thread.title;

  batch.set(
    threadRef(uid, threadId),
    {
      uid,
      mode: params.threadMode,
      modelId: params.modelId,
      title: nextTitle || (!thread?.messageCount ? deriveTitleFromMessage(firstUserMessage) : thread?.title || 'New chat'),
      lastMessagePreview: sanitizePreview(normalizedMessages[normalizedMessages.length - 1]?.content || ''),
      messageCount: Number(thread?.messageCount || 0) + normalizedMessages.length,
      attachmentCount:
        Number(thread?.attachmentCount || 0) +
        normalizedMessages.reduce((sum, message) => sum + message.attachments.length, 0),
      isDeleted: false,
      updatedAt: now,
      lastMessageAt: now,
      ...(thread ? {} : { createdAt: now }),
    },
    { merge: true }
  );

  await batch.commit();

  const persisted = await Promise.all(createdRefs.map((ref) => ref.get()));
  return persisted.map((doc) => normalizeMessage(doc.id, doc.data()));
}

export const assistantThreadsRepository = {
  appendMessages,
  createThread,
  getThread,
  listMessages,
  listThreads,
  softDeleteThread,
  updateThread,
};
