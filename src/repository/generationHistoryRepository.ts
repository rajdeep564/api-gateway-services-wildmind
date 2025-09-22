import { adminDb, admin } from '../config/firebaseAdmin';
import { GenerationHistoryItem, GenerationStatus, Visibility, GenerationType } from '../types/generate';

export async function create(uid: string, data: {
  prompt: string;
  model: string;
  generationType: GenerationType | string;
  visibility?: Visibility | string;
  tags?: string[];
  nsfw?: boolean;
}): Promise<{ historyId: string }> {
  const col = adminDb.collection('generationHistory').doc(uid).collection('items');
  const docRef = await col.add({
    uid,
    prompt: data.prompt,
    model: data.model,
    generationType: data.generationType,
    visibility: (data.visibility as Visibility) || Visibility.Private,
    tags: data.tags || [],
    nsfw: data.nsfw ?? false,
    status: GenerationStatus.Generating,
    isPublicReady: false,
    images: [],
    videos: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { historyId: docRef.id };
}

export async function update(uid: string, historyId: string, updates: Partial<GenerationHistoryItem>): Promise<void> {
  const ref = adminDb.collection('generationHistory').doc(uid).collection('items').doc(historyId);
  await ref.update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  } as any);
}

export async function get(uid: string, historyId: string): Promise<GenerationHistoryItem | null> {
  const ref = adminDb.collection('generationHistory').doc(uid).collection('items').doc(historyId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  return { id: snap.id, ...data } as GenerationHistoryItem;
}

export async function list(uid: string, params: {
  limit: number;
  cursor?: string;
  status?: 'generating' | 'completed' | 'failed';
  generationType?: GenerationType | string;
}): Promise<{ items: GenerationHistoryItem[]; nextCursor?: string }> {
  let q: FirebaseFirestore.Query = adminDb.collection('generationHistory').doc(uid).collection('items')
    .orderBy('createdAt', 'desc');
  if (params.status) q = q.where('status', '==', params.status);
  if (params.generationType) q = q.where('generationType', '==', params.generationType);
  if (params.cursor) {
    const cursorDoc = await adminDb.collection('generationHistory').doc(uid).collection('items').doc(params.cursor).get();
    if (cursorDoc.exists) q = q.startAfter(cursorDoc);
  }
  q = q.limit(params.limit);
  const snap = await q.get();
  const items: GenerationHistoryItem[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const nextCursor = snap.size === params.limit ? snap.docs[snap.docs.length - 1].id : undefined;
  return { items, nextCursor };
}

export async function findByProviderTaskId(uid: string, provider: string, providerTaskId: string): Promise<{ id: string; item: GenerationHistoryItem } | null> {
  const col = adminDb.collection('generationHistory').doc(uid).collection('items');
  const snap = await col
    .where('provider', '==', provider)
    .where('providerTaskId', '==', providerTaskId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data() as any;
  return { id: doc.id, item: { id: doc.id, ...data } as GenerationHistoryItem };
}

export const generationHistoryRepository = {
  create,
  update,
  get,
  list,
  findByProviderTaskId,
};


