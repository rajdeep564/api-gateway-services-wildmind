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
  frameSize?: string;
  aspect_ratio?: string;
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
    frameSize: data.frameSize || null,
    aspect_ratio: data.aspect_ratio || data.frameSize || null,
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
    isDeleted: false,
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
  search?: string;
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
  // Exclude soft-deleted; treat missing field as not deleted for backwards compatibility
  items = items.filter((it: any) => it.isDeleted !== true);

  // Apply in-memory filters for status, generationType, and optional date range
  if (params.status) {
    const want = String(params.status).toLowerCase();
    items = items.filter((it) => String((it as any).status).toLowerCase() === want);
  }

  if (Array.isArray(params.generationType as any)) {
    const types = params.generationType as any as string[];
    const set = new Set(types);
    items = items.filter((it) => set.has((it as any).generationType));
  } else if (typeof params.generationType === 'string' && params.generationType.length > 0) {
    const want = String(params.generationType);
    items = items.filter((it) => String((it as any).generationType) === want);
  }

  if (typeof params.dateStart === 'string' && typeof params.dateEnd === 'string') {
    const startDate = new Date(params.dateStart);
    const endDate = new Date(params.dateEnd);
    items = items.filter((it) => {
      try {
        const created = new Date((it as any).createdAt || (it as any).updatedAt);
        return created >= startDate && created <= endDate;
      } catch {
        return true;
      }
    });
  }

  // Ensure stable sort after in-memory filtering
  // Optional free-text search by prompt (case-insensitive)
  if (params.search && params.search.trim().length > 0) {
    const needle = params.search.toLowerCase();
    items = items.filter((it: any) => String((it as any).prompt || '').toLowerCase().includes(needle));
  }

  items.sort((a: any, b: any) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    const ax = typeof av === 'string' && /\d{4}-\d{2}-\d{2}T/.test(av) ? new Date(av).getTime() : av;
    const bx = typeof bv === 'string' && /\d{4}-\d{2}-\d{2}T/.test(bv) ? new Date(bv).getTime() : bv;
    const cmp = ax > bx ? 1 : ax < bx ? -1 : 0;
    return sortOrder === 'asc' ? cmp : -cmp;
  });
  
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

export async function findBySoraVideoId(uid: string, soraVideoId: string): Promise<{ id: string; item: GenerationHistoryItem } | null> {
  const col = adminDb.collection('generationHistory').doc(uid).collection('items');
  const snap = await col
    .where('soraVideoId', '==', soraVideoId)
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
  findBySoraVideoId,
};


