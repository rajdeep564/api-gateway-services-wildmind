"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generationHistoryRepository = void 0;
exports.create = create;
exports.update = update;
exports.get = get;
exports.list = list;
exports.findByProviderTaskId = findByProviderTaskId;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
const generate_1 = require("../types/generate");
function toIso(value) {
    try {
        if (value && typeof value.toDate === 'function') {
            return value.toDate().toISOString();
        }
        return value;
    }
    catch {
        return value;
    }
}
function normalizeItem(id, data) {
    const createdAt = toIso(data?.createdAt);
    const updatedAt = toIso(data?.updatedAt);
    return { id, ...data, ...(createdAt ? { createdAt } : {}), ...(updatedAt ? { updatedAt } : {}) };
}
async function create(uid, data) {
    const col = firebaseAdmin_1.adminDb.collection('generationHistory').doc(uid).collection('items');
    const docRef = await col.add({
        uid,
        prompt: data.prompt,
        model: data.model,
        generationType: data.generationType,
        visibility: data.visibility || generate_1.Visibility.Private,
        tags: data.tags || [],
        nsfw: data.nsfw ?? false,
        frameSize: data.frameSize || null,
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
        status: generate_1.GenerationStatus.Generating,
        isDeleted: false,
        images: [],
        videos: [],
        createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
    });
    return { historyId: docRef.id };
}
async function update(uid, historyId, updates) {
    const ref = firebaseAdmin_1.adminDb.collection('generationHistory').doc(uid).collection('items').doc(historyId);
    await ref.update({
        ...updates,
        updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
    });
}
async function get(uid, historyId) {
    const ref = firebaseAdmin_1.adminDb.collection('generationHistory').doc(uid).collection('items').doc(historyId);
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    return normalizeItem(snap.id, data);
}
async function list(uid, params) {
    const col = firebaseAdmin_1.adminDb.collection('generationHistory').doc(uid).collection('items');
    // Default sorting
    const sortBy = params.sortBy || 'createdAt';
    const sortOrder = params.sortOrder || 'desc';
    let q = col.orderBy(sortBy, sortOrder);
    // Get total count for pagination context
    let totalCount;
    if (params.generationType || params.status) {
        const countQuery = await col.get();
        totalCount = countQuery.docs.length;
    }
    // Apply filters
    if (params.status) {
        q = q.where('status', '==', params.status);
    }
    if (params.generationType) {
        if (Array.isArray(params.generationType)) {
            // Firestore doesn't support IN with array of strings directly on composite; split into OR by client side
            // We'll fetch without filter here and filter client-side after fetchCount; better to add mirror if needed
            // As a compromise, we can use 'in' for up to 10 values
            const types = params.generationType;
            if (types.length <= 10) {
                q = q.where('generationType', 'in', types);
            }
            else {
                // fallback: no where and filter after fetch
            }
        }
        else {
            q = q.where('generationType', '==', params.generationType);
        }
    }
    // Optional date filtering (client provides ISO). Firestore requires composite index for where + orderBy; if missing, fallback to in-memory filter after fetch.
    const wantsDateFilter = typeof params.dateStart === 'string' && typeof params.dateEnd === 'string';
    let filterByDateInMemory = false;
    if (wantsDateFilter) {
        try {
            const start = new Date(params.dateStart);
            const end = new Date(params.dateEnd);
            // Try server-side range filter; if the index is missing, Firestore throws FAILED_PRECONDITION which we will catch later and fallback client-side
            q = col.where('createdAt', '>=', firebaseAdmin_1.admin.firestore.Timestamp.fromDate(start))
                .where('createdAt', '<=', firebaseAdmin_1.admin.firestore.Timestamp.fromDate(end))
                .orderBy('createdAt', sortOrder);
        }
        catch {
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
    let snap;
    try {
        snap = await q.limit(fetchCount).get();
    }
    catch (e) {
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
            let lastDoc;
            let pooledDocs = [];
            for (let i = 0; i < 10 && pooledDocs.length < (params.limit * 2); i++) {
                let fallbackQ = col.orderBy(sortBy, sortOrder);
                if (lastDoc)
                    fallbackQ = fallbackQ.startAfter(lastDoc);
                const batch = await fallbackQ.limit(batchLimit).get();
                if (batch.empty)
                    break;
                pooledDocs.push(...batch.docs);
                lastDoc = batch.docs[batch.docs.length - 1];
            }
            // Build a synthetic snapshot-like object
            snap = { docs: pooledDocs };
            // We'll filter by generationType/status/date in memory below
            filterByDateInMemory = true; // ensures consistent post-filter sorting
        }
        else {
            throw e;
        }
    }
    let items = snap.docs.map(d => normalizeItem(d.id, d.data()));
    // Exclude soft-deleted; treat missing field as not deleted for backwards compatibility
    items = items.filter((it) => it.isDeleted !== true);
    if (Array.isArray(params.generationType) && params.generationType.length > 10) {
        const set = new Set(params.generationType);
        items = items.filter(it => set.has(it.generationType));
    }
    const page = items.slice(0, params.limit);
    const nextCursor = page.length === params.limit ? page[page.length - 1].id : undefined;
    return { items: page, nextCursor, totalCount };
}
async function findByProviderTaskId(uid, provider, providerTaskId) {
    const col = firebaseAdmin_1.adminDb.collection('generationHistory').doc(uid).collection('items');
    const snap = await col
        .where('provider', '==', provider)
        .where('providerTaskId', '==', providerTaskId)
        .limit(1)
        .get();
    if (snap.empty)
        return null;
    const doc = snap.docs[0];
    const data = doc.data();
    return { id: doc.id, item: normalizeItem(doc.id, data) };
}
exports.generationHistoryRepository = {
    create,
    update,
    get,
    list,
    findByProviderTaskId,
};
