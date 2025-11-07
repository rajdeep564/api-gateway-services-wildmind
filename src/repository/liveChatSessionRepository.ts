import { adminDb, admin } from '../config/firebaseAdmin';

export interface LiveChatSessionData {
  sessionId: string;
  uid: string;
  model: string;
  frameSize?: string | null;
  style?: string | null;
  startedAt: any; // Firestore Timestamp
  completedAt?: any; // Firestore Timestamp
  status: 'active' | 'completed' | 'failed';
  // All images in a single array, ordered by sequence (1, 2, 3, ...)
  images: Array<{
    id: string;
    url: string;
    storagePath?: string;
    originalUrl?: string;
    firebaseUrl?: string;
    order: number; // Order in sequence (1, 2, 3, ...)
    prompt?: string; // Optional prompt that generated this image
    timestamp?: any; // Optional timestamp when image was generated
  }>;
  // Array of messages with prompts in chronological order (for reference)
  messages: Array<{
    prompt: string;
    timestamp: any; // Firestore Timestamp
  }>;
  // All image URLs in sequence for quick lookup
  imageUrls: string[];
  // Total count of images
  totalImages: number;
  createdAt: any; // Firestore Timestamp
  updatedAt: any; // Firestore Timestamp
}

function normalizeSession(id: string, data: any): LiveChatSessionData & { id: string } {
  const toIso = (value: any): any => {
    try {
      if (value && typeof value.toDate === 'function') {
        return value.toDate().toISOString();
      }
      return value;
    } catch {
      return value;
    }
  };

  return {
    id,
    ...data,
    startedAt: toIso(data?.startedAt),
    completedAt: toIso(data?.completedAt),
    createdAt: toIso(data?.createdAt),
    updatedAt: toIso(data?.updatedAt),
    images: (data?.images || []).map((img: any) => ({
      ...img,
      timestamp: toIso(img?.timestamp),
    })),
    messages: (data?.messages || []).map((m: any) => ({
      ...m,
      timestamp: toIso(m?.timestamp),
    })),
  } as LiveChatSessionData & { id: string };
}

/**
 * Create a new live chat session
 */
export async function create(uid: string, data: {
  sessionId: string;
  model: string;
  frameSize?: string;
  style?: string;
  startedAt: string; // ISO string
}): Promise<{ sessionDocId: string }> {
  const col = adminDb.collection('liveChatSessions');
  const now = admin.firestore.FieldValue.serverTimestamp();
  
  const sessionData: Omit<LiveChatSessionData, 'id'> = {
    sessionId: data.sessionId,
    uid,
    model: data.model,
    frameSize: data.frameSize ?? null,
    style: data.style ?? null,
    startedAt: admin.firestore.Timestamp.fromDate(new Date(data.startedAt)),
    status: 'active',
    images: [], // Single array for all images
    messages: [], // Array of prompts/messages for reference
    imageUrls: [],
    totalImages: 0,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await col.add(sessionData);
  return { sessionDocId: docRef.id };
}

/**
 * Update an existing live chat session
 */
export async function update(sessionDocId: string, updates: Partial<LiveChatSessionData>): Promise<void> {
  const ref = adminDb.collection('liveChatSessions').doc(sessionDocId);
  
  const firestoreUpdates: any = {
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Convert ISO strings to Firestore Timestamps
  if (updates.startedAt && typeof updates.startedAt === 'string') {
    firestoreUpdates.startedAt = admin.firestore.Timestamp.fromDate(new Date(updates.startedAt));
  }
  if (updates.completedAt && typeof updates.completedAt === 'string') {
    firestoreUpdates.completedAt = admin.firestore.Timestamp.fromDate(new Date(updates.completedAt));
  }
  if (updates.images) {
    // Ensure images array is properly formatted with Firestore Timestamps
    firestoreUpdates.images = updates.images.map((img: any) => {
      const imageData: any = { ...img };
      // Convert timestamp if it's a string
      if (imageData.timestamp && typeof imageData.timestamp === 'string') {
        imageData.timestamp = admin.firestore.Timestamp.fromDate(new Date(imageData.timestamp));
      } else if (!imageData.timestamp && imageData.timestamp !== null) {
        // If timestamp is missing but not explicitly null, preserve it as is (might be Firestore Timestamp already)
      }
      return imageData;
    });
    console.log('[LiveChatSession] Updating session with', firestoreUpdates.images.length, 'images');
  }
  if (updates.messages) {
    firestoreUpdates.messages = updates.messages.map((m: any) => ({
      ...m,
      timestamp: m.timestamp && typeof m.timestamp === 'string'
        ? admin.firestore.Timestamp.fromDate(new Date(m.timestamp))
        : m.timestamp,
    }));
  }

  await ref.update(firestoreUpdates);
}

/**
 * Get a session by document ID
 */
export async function get(sessionDocId: string): Promise<(LiveChatSessionData & { id: string }) | null> {
  const ref = adminDb.collection('liveChatSessions').doc(sessionDocId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return normalizeSession(snap.id, snap.data());
}

/**
 * Find a session by sessionId
 */
export async function findBySessionId(sessionId: string): Promise<(LiveChatSessionData & { id: string }) | null> {
  const col = adminDb.collection('liveChatSessions');
  const snap = await col.where('sessionId', '==', sessionId).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return normalizeSession(doc.id, doc.data());
}

/**
 * Find a session by any image URL in the session
 * This is the key function for restoring sessions when clicking on an image
 */
export async function findByImageUrl(imageUrl: string): Promise<(LiveChatSessionData & { id: string }) | null> {
  const col = adminDb.collection('liveChatSessions');
  
  console.log('[LiveChatSession] Finding session by imageUrl:', imageUrl);
  
  // Query sessions where imageUrls array contains the imageUrl
  const snap = await col.where('imageUrls', 'array-contains', imageUrl).limit(10).get(); // Get more to find the right one
  
  if (snap.empty) {
    console.log('[LiveChatSession] No session found for imageUrl:', imageUrl);
    return null;
  }
  
  console.log('[LiveChatSession] Found', snap.docs.length, 'session(s) with imageUrl');
  
  // Get the most recent session if multiple exist (shouldn't happen, but safety)
  const docs = snap.docs.sort((a, b) => {
    const aTime = a.data()?.updatedAt?.toDate?.()?.getTime() || 0;
    const bTime = b.data()?.updatedAt?.toDate?.()?.getTime() || 0;
    return bTime - aTime; // Descending
  });
  
  const doc = docs[0];
  const sessionData = doc.data();
  const normalized = normalizeSession(doc.id, sessionData);
  
  console.log('[LiveChatSession] Returning session:', {
    id: doc.id,
    sessionId: normalized.sessionId,
    totalImages: normalized.totalImages,
    imageUrlsCount: normalized.imageUrls.length,
    imagesCount: normalized.images.length,
  });
  
  return normalized;
}

/**
 * Find all sessions for a user
 */
export async function findByUserId(uid: string, params: {
  limit?: number;
  cursor?: string;
  status?: 'active' | 'completed' | 'failed';
}): Promise<{ sessions: (LiveChatSessionData & { id: string })[]; nextCursor?: string }> {
  try {
    if (!uid) {
      console.error('[LiveChatSession] findByUserId: uid is required');
      return { sessions: [], nextCursor: undefined };
    }

    const col = adminDb.collection('liveChatSessions');
    let q: FirebaseFirestore.Query = col.where('uid', '==', uid).orderBy('updatedAt', 'desc');
    
    if (params.status) {
      q = q.where('status', '==', params.status);
    }
    
    if (params.cursor) {
      const cursorDoc = await col.doc(params.cursor).get();
      if (cursorDoc.exists) {
        q = q.startAfter(cursorDoc);
      }
    }
    
    const limit = params.limit || 20;
    const snap = await q.limit(limit + 1).get();
    
    const sessions = snap.docs.slice(0, limit).map(d => normalizeSession(d.id, d.data()));
    const nextCursor = snap.docs.length > limit ? snap.docs[limit - 1].id : undefined;
    
    console.log('[LiveChatSession] findByUserId: found', sessions.length, 'sessions', { uid, limit, hasMore: !!nextCursor });
    
    return { sessions, nextCursor };
  } catch (error: any) {
    console.error('[LiveChatSession] findByUserId error:', error);
    
    // If it's a Firestore index error, return empty array instead of crashing
    if (error?.code === 9 || error?.message?.includes('index') || error?.message?.includes('requires an index')) {
      console.warn('[LiveChatSession] Firestore index required. Please create a composite index for liveChatSessions collection: uid (Ascending) and updatedAt (Descending)');
      return { sessions: [], nextCursor: undefined };
    }
    
    // Re-throw other errors
    throw error;
  }
}

/**
 * Add a new message with images to a session
 * This adds images to the single images array in order
 */
export async function addMessage(sessionDocId: string, message: {
  prompt: string;
  images: Array<{
    id: string;
    url: string;
    storagePath?: string;
    originalUrl?: string;
    firebaseUrl?: string;
  }>;
  timestamp: string; // ISO string
}): Promise<void> {
  // Get the session directly from Firestore to ensure we have the latest data
  const ref = adminDb.collection('liveChatSessions').doc(sessionDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Session not found');
  
  const sessionData = snap.data() as any;
  const session = normalizeSession(sessionDocId, sessionData);

  console.log('[LiveChatSession] Adding message to session:', {
    sessionDocId,
    currentImagesCount: session.images.length,
    currentImages: session.images.map(img => ({ url: img.url, order: img.order })),
    newImagesCount: message.images.length,
    prompt: message.prompt,
  });

  // Calculate order for new images (continue from last order)
  const lastOrder = session.images.length > 0 
    ? Math.max(...session.images.map(img => img.order || 0))
    : 0;
  
  console.log('[LiveChatSession] Last order:', lastOrder, 'Adding', message.images.length, 'new images');
  
  const newImages = message.images.map((img, idx) => ({
    ...img,
    order: lastOrder + idx + 1,
    prompt: message.prompt, // Store prompt with image
    timestamp: admin.firestore.Timestamp.fromDate(new Date(message.timestamp)),
  }));

  // Add new images to the single images array
  const updatedImages = [...session.images, ...newImages];
  
  console.log('[LiveChatSession] Total images after adding:', updatedImages.length);
  
  // Update imageUrls array for quick lookup
  const updatedImageUrls = updatedImages.map(img => img.url);

  // Add message to messages array (for reference)
  const updatedMessages = [
    ...session.messages,
    {
      prompt: message.prompt,
      timestamp: admin.firestore.Timestamp.fromDate(new Date(message.timestamp)),
    },
  ];

  // Use Firestore transaction to ensure atomic update
  try {
    await adminDb.runTransaction(async (transaction) => {
      const sessionRef = adminDb.collection('liveChatSessions').doc(sessionDocId);
      const sessionDoc = await transaction.get(sessionRef);
      
      if (!sessionDoc.exists) {
        throw new Error('Session not found during transaction');
      }
      
      const currentData = sessionDoc.data() as any;
      const currentImages = currentData.images || [];
      
      console.log('[LiveChatSession] Transaction - Current images:', currentImages.length);
      console.log('[LiveChatSession] Transaction - Adding new images:', newImages.length);
      console.log('[LiveChatSession] Transaction - Current status:', currentData.status);
      
      // Merge with existing images (in case of race condition)
      const existingImageUrls = new Set(currentImages.map((img: any) => img.url));
      const uniqueNewImages = newImages.filter(img => !existingImageUrls.has(img.url));
      
      if (uniqueNewImages.length === 0) {
        console.log('[LiveChatSession] Transaction - All images already exist, skipping update');
        return;
      }
      
      const finalImages = [...currentImages, ...uniqueNewImages];
      const finalImageUrls = finalImages.map((img: any) => img.url);
      const finalMessages = [
        ...(currentData.messages || []),
        {
          prompt: message.prompt,
          timestamp: admin.firestore.Timestamp.fromDate(new Date(message.timestamp)),
        },
      ];
      
      // Reactivate session if it was completed (user is continuing to edit)
      const shouldReactivate = currentData.status === 'completed';
      
      transaction.update(sessionRef, {
        images: finalImages.map((img: any) => ({
          ...img,
          timestamp: img.timestamp && typeof img.timestamp === 'string'
            ? admin.firestore.Timestamp.fromDate(new Date(img.timestamp))
            : img.timestamp,
        })),
        messages: finalMessages,
        imageUrls: finalImageUrls,
        totalImages: finalImages.length,
        // Reactivate session if it was completed
        status: shouldReactivate ? 'active' : currentData.status,
        // Clear completedAt if reactivating
        ...(shouldReactivate ? { completedAt: admin.firestore.FieldValue.delete() } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      if (shouldReactivate) {
        console.log('[LiveChatSession] Transaction - Reactivating completed session');
      }
      
      console.log('[LiveChatSession] Transaction - Final images count:', finalImages.length);
    });
    
    console.log('[LiveChatSession] Successfully updated session with', updatedImages.length, 'total images');
  } catch (error) {
    console.error('[LiveChatSession] Transaction failed, falling back to regular update:', error);
    // Fallback to regular update if transaction fails
    // Reactivate session if it was completed
    const shouldReactivate = session.status === 'completed';
    await update(sessionDocId, {
      images: updatedImages as any,
      messages: updatedMessages as any,
      imageUrls: updatedImageUrls,
      totalImages: updatedImages.length,
      // Reactivate session if it was completed
      ...(shouldReactivate ? { status: 'active' as const, completedAt: null } : {}),
    });
  }
}

export const liveChatSessionRepository = {
  create,
  update,
  get,
  findBySessionId,
  findByImageUrl,
  findByUserId,
  addMessage,
};

