import { adminDb, admin } from '../config/firebaseAdmin';
import { GenerationHistoryItem, GenerationStatus, Visibility, GenerationType } from '../types/generate';

function toIso(value: any): any {
  try {
    if (value && typeof (value as any).toDate === 'function') {
      return (value as any).toDate().toISOString();
    }
    return value;
  } catch {
    return value;
  }
}

function normalizeItem(id: string, data: any): GenerationHistoryItem {
  const createdAt = toIso(data?.createdAt);
  const updatedAt = toIso(data?.updatedAt);
  return { id, ...data, ...(createdAt ? { createdAt } : {}), ...(updatedAt ? { updatedAt } : {}) } as GenerationHistoryItem;
}

export async function create(uid: string, data: {
  prompt: string;
  model: string;
  generationType: GenerationType | string;
  visibility?: Visibility | string;
  tags?: string[];
  nsfw?: boolean;
  isPublic?: boolean;
  createdBy?: { uid: string; username?: string; email?: string };
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
    isPublic: data.isPublic ?? false,
    createdBy: data.createdBy ? {
      uid: data.createdBy.uid,
      username: data.createdBy.username || null,
      email: data.createdBy.email || null,
    } : {
      uid,
      username: null,
      email: null,
    },
    status: GenerationStatus.Generating,
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
  return normalizeItem(snap.id, data);
}

export async function list(uid: string, params: {
  limit: number;
  cursor?: string;
  status?: 'generating' | 'completed' | 'failed';
  generationType?: GenerationType | string;
  sortBy?: 'createdAt' | 'updatedAt' | 'prompt';
  sortOrder?: 'asc' | 'desc';
  dateStart?: string;
  dateEnd?: string;
}): Promise<{ items: GenerationHistoryItem[]; nextCursor?: string; totalCount?: number }> {
  const col = adminDb.collection('generationHistory').doc(uid).collection('items');
  
  // Default sorting
  const sortBy = params.sortBy || 'createdAt';
  const sortOrder = params.sortOrder || 'desc';
  
  let q: FirebaseFirestore.Query = col.orderBy(sortBy, sortOrder);
  
  // Get total count for pagination context
  let totalCount: number | undefined;
  if (params.generationType || params.status) {
    const countQuery = await col.get();
    totalCount = countQuery.docs.length;
  }
  
  // Apply filters
  if (params.status) {
    q = q.where('status', '==', params.status);
  }
  
  if (params.generationType) {
    if (Array.isArray(params.generationType as any)) {
      // Firestore doesn't support IN with array of strings directly on composite; split into OR by client side
      // We'll fetch without filter here and filter client-side after fetchCount; better to add mirror if needed
      // As a compromise, we can use 'in' for up to 10 values
      const types = params.generationType as any as string[];
      if (types.length <= 10) {
        q = q.where('generationType', 'in', types);
      } else {
        // fallback: no where and filter after fetch
      }
    } else {
      q = q.where('generationType', '==', params.generationType);
    }
  }
  
  // Optional date filtering (client provides ISO). Firestore requires composite index for where + orderBy; if missing, fallback to in-memory filter after fetch.
  const wantsDateFilter = typeof params.dateStart === 'string' && typeof params.dateEnd === 'string';
  let filterByDateInMemory = false;
  if (wantsDateFilter) {
    try {
      const start = new Date(params.dateStart as string);
      const end = new Date(params.dateEnd as string);
      // Try server-side range filter; if the index is missing, Firestore throws FAILED_PRECONDITION which we will catch later and fallback client-side
      q = col.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start))
             .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(end))
             .orderBy('createdAt', sortOrder);
    } catch {
      filterByDateInMemory = true;
    }
  }

  // Handle cursor-based pagination (must be applied AFTER where/orderBy)
  if (params.cursor) {
    const cursorDoc = await col.doc(params.cursor).get();
    if (cursorDoc.exists) {
      q = q.startAfter(cursorDoc);
    }
  }
  
  const fetchCount = params.status || params.generationType ? 
    Math.max(params.limit * 2, params.limit) : 
    Math.max(params.limit * 4, params.limit);
  
  let snap: FirebaseFirestore.QuerySnapshot;
  try {
    snap = await q.limit(fetchCount).get();
  } catch (e: any) {
    // Fallback for missing composite index (e.g., generationType + createdAt sorting)
    const codeStr = String(e?.code || '').toLowerCase();
    const msgStr = String(e?.message || '').toLowerCase();
    const isMissingIndexError =
      // Firestore web/node SDK may emit either string or numeric code
      codeStr === 'failed-precondition' ||
      e?.code === 9 ||
      String(e?.code || e?.message || '').toUpperCase().includes('FAILED_PRECONDITION') ||
      /index|composite/i.test(String(e?.message || ''));
    if (isMissingIndexError) {
      // Iteratively scan by createdAt in the requested order until we can satisfy the page
      const batchLimit = Math.max(params.limit * 10, 100);
      let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      let pooledDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (let i = 0; i < 10 && pooledDocs.length < (params.limit * 2); i++) {
        let fallbackQ: FirebaseFirestore.Query = col.orderBy(sortBy, sortOrder);
        if (lastDoc) fallbackQ = fallbackQ.startAfter(lastDoc);
        const batch = await fallbackQ.limit(batchLimit).get();
        if (batch.empty) break;
        pooledDocs.push(...batch.docs);
        lastDoc = batch.docs[batch.docs.length - 1];
      }
      // Build a synthetic snapshot-like object
      snap = { docs: pooledDocs } as any;
      // We'll filter by generationType/status/date in memory below
      filterByDateInMemory = true; // ensures consistent post-filter sorting
    } else {
      throw e;
    }
  }
  
  let items: GenerationHistoryItem[] = snap.docs.map(d => normalizeItem(d.id, d.data() as any));
  
  // In-memory filters when needed (date range or fallback for missing index)
  if (filterByDateInMemory && wantsDateFilter) {
    try {
      const startMs = Date.parse(params.dateStart as string);
      const endMs = Date.parse(params.dateEnd as string);
      items = items.filter(it => {
        const ms = Date.parse((it as any).createdAt || (it as any).timestamp || '');
        return !isNaN(ms) && ms >= startMs && ms <= endMs;
      });
    } catch {}
  }
  // In-memory type and status filtering if fallback path
  if (filterByDateInMemory || wantsDateFilter) {
    if (params.generationType) {
      if (Array.isArray(params.generationType as any)) {
        const set = new Set(params.generationType as any as string[]);
        items = items.filter(it => set.has((it as any).generationType));
      } else {
        items = items.filter(it => (it as any).generationType === params.generationType);
      }
    }
    if (params.status) {
      items = items.filter(it => (it as any).status === params.status);
    }
    // Sort in-memory to honor sortOrder when we bypassed server index
    items.sort((a, b) => {
      const ams = Date.parse((a as any).createdAt || (a as any).timestamp || '');
      const bms = Date.parse((b as any).createdAt || (b as any).timestamp || '');
      return (params.sortOrder === 'asc' ? ams - bms : bms - ams);
    });
  }
  if (Array.isArray(params.generationType as any) && (params.generationType as any).length > 10) {
    const set = new Set((params.generationType as any as string[]));
    items = items.filter(it => set.has((it as any).generationType));
  }
  
  const page = items.slice(0, params.limit);
  const nextCursor = page.length === params.limit ? page[page.length - 1].id : undefined;
  
  return { items: page, nextCursor, totalCount };
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
  return { id: doc.id, item: normalizeItem(doc.id, data) };
}

export const generationHistoryRepository = {
  create,
  update,
  get,
  list,
  findByProviderTaskId,
};


