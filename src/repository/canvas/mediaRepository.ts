import { adminDb, admin } from '../../config/firebaseAdmin';
import { CanvasMedia } from '../../types/canvas';

export async function createMedia(
  media: Omit<CanvasMedia, 'id' | 'createdAt' | 'updatedAt'>
): Promise<CanvasMedia> {
  const mediaRef = adminDb.collection('canvasMedia').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  
  const mediaDoc: CanvasMedia = {
    id: mediaRef.id,
    url: media.url,
    storagePath: media.storagePath,
    origin: media.origin,
    projectId: media.projectId,
    referencedByCount: media.referencedByCount || 0,
    metadata: media.metadata,
    createdAt: now as any,
    updatedAt: now as any,
  };

  await mediaRef.set(mediaDoc);
  return mediaDoc;
}

export async function getMedia(mediaId: string): Promise<CanvasMedia | null> {
  const mediaRef = adminDb.collection('canvasMedia').doc(mediaId);
  const snap = await mediaRef.get();
  
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() } as CanvasMedia;
}

export async function incrementRef(mediaId: string): Promise<void> {
  const mediaRef = adminDb.collection('canvasMedia').doc(mediaId);
  await mediaRef.update({
    referencedByCount: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function decrementRef(mediaId: string): Promise<void> {
  const mediaRef = adminDb.collection('canvasMedia').doc(mediaId);
  await mediaRef.update({
    referencedByCount: admin.firestore.FieldValue.increment(-1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function getUnreferencedMedia(
  olderThanDays: number = 7,
  limit: number = 100
): Promise<CanvasMedia[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  
  const mediaRef = adminDb.collection('canvasMedia');
  const query = mediaRef
    .where('referencedByCount', '==', 0)
    .where('createdAt', '<', admin.firestore.Timestamp.fromDate(cutoffDate))
    .limit(limit);
  
  const snap = await query.get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CanvasMedia));
}

export async function listUnreferencedMedia(limit: number = 100): Promise<CanvasMedia[]> {
  const mediaRef = adminDb.collection('canvasMedia');
  const query = mediaRef
    .where('referencedByCount', '==', 0)
    .limit(limit);
  
  const snap = await query.get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CanvasMedia));
}

export async function deleteMedia(mediaId: string): Promise<void> {
  const mediaRef = adminDb.collection('canvasMedia').doc(mediaId);
  await mediaRef.delete();
}

export const mediaRepository = {
  createMedia,
  getMedia,
  incrementRef,
  decrementRef,
  getUnreferencedMedia,
  listUnreferencedMedia,
  deleteMedia,
};

