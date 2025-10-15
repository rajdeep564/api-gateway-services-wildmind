import { adminDb, admin } from '../config/firebaseAdmin';
import { GenerationHistoryItem } from '../types/generate';

interface CreatedBy {
  uid: string;
  username?: string;
  displayName?: string;
  photoURL?: string;
}

export async function upsertFromHistory(uid: string, historyId: string, historyDoc: GenerationHistoryItem, createdBy: CreatedBy): Promise<void> {
  try {
    // eslint-disable-next-line no-console
    console.log('[Mirror][Upsert]', { historyId, uid, isPublic: (historyDoc as any)?.isPublic, visibility: (historyDoc as any)?.visibility, generationType: (historyDoc as any)?.generationType });
  } catch {}
  const ref = adminDb.collection('generations').doc(historyId);
  await ref.set({
    ...historyDoc,
    createdBy,
    uid,
    id: historyId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(historyDoc.createdAt ? { createdAt: historyDoc.createdAt } : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
  }, { merge: true });
}

export async function updateFromHistory(uid: string, historyId: string, updates: Partial<GenerationHistoryItem>): Promise<void> {
  try {
    // eslint-disable-next-line no-console
    console.log('[Mirror][Update]', { historyId, uid, isPublic: (updates as any)?.isPublic, visibility: (updates as any)?.visibility, generationType: (updates as any)?.generationType });
  } catch {}
  const ref = adminDb.collection('generations').doc(historyId);
  await ref.set({
    ...updates,
    uid,
    id: historyId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  } as any, { merge: true });
}

export async function remove(historyId: string): Promise<void> {
  const ref = adminDb.collection('generations').doc(historyId);
  await ref.delete();
}

export const generationsMirrorRepository = {
  upsertFromHistory,
  updateFromHistory,
  remove,
};


