"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicGenerationsRepository = void 0;
exports.listPublic = listPublic;
exports.getPublicById = getPublicById;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
function normalizePublicItem(id, data) {
    const { uid, prompt, model, generationType, status, visibility, tags, nsfw, images, videos, audios, createdBy, isPublic, createdAt, updatedAt, isDeleted, aspectRatio, frameSize, aspect_ratio } = data;
    return {
        id,
        uid,
        prompt,
        model,
        generationType,
        status,
        visibility,
        tags,
        nsfw,
        images,
        videos,
        audios,
        createdBy,
        isPublic,
        isDeleted,
        createdAt,
        updatedAt: updatedAt || createdAt,
        aspectRatio: aspectRatio || frameSize || aspect_ratio,
        frameSize: frameSize || aspect_ratio || aspectRatio
    };
}
async function listPublic(params) {
    const col = firebaseAdmin_1.adminDb.collection('generations');
    // Default sorting
    const sortBy = params.sortBy || 'createdAt';
    const sortOrder = params.sortOrder || 'desc';
    // Projection: fetch only the fields needed for the feed to reduce payload size
    const projectionFields = [
        'prompt', 'model', 'generationType', 'status', 'visibility', 'tags', 'nsfw',
        'images', 'videos', 'audios', 'createdBy', 'isPublic', 'isDeleted', 'createdAt', 'updatedAt',
        'aspectRatio', 'frameSize', 'aspect_ratio'
    ];
    let q = col.select(...projectionFields).orderBy(sortBy, sortOrder);
    // Only show public; we will exclude deleted after fetch so old docs without the flag still appear
    q = q.where('isPublic', '==', true);
    // Apply filters
    // Try server-side filtering for generationType if possible (<=10 values for 'in')
    let clientFilterTypes;
    if (params.generationType) {
        if (Array.isArray(params.generationType)) {
            const arr = params.generationType.map(s => String(s));
            if (arr.length > 0 && arr.length <= 10) {
                try {
                    q = q.where('generationType', 'in', arr);
                    clientFilterTypes = undefined;
                }
                catch {
                    // fall back to client-side
                    clientFilterTypes = arr;
                }
            }
            else {
                clientFilterTypes = arr;
            }
        }
        else {
            // Single value can be server-side filtered
            try {
                q = q.where('generationType', '==', String(params.generationType));
                clientFilterTypes = undefined;
            }
            catch {
                clientFilterTypes = [String(params.generationType)];
            }
        }
    }
    if (params.status) {
        q = q.where('status', '==', params.status);
    }
    if (params.createdBy) {
        q = q.where('createdBy.uid', '==', params.createdBy);
    }
    // Optional date filtering based on createdAt timestamp
    let filterByDateInMemory = false;
    if (params.dateStart && params.dateEnd) {
        try {
            const start = new Date(params.dateStart);
            const end = new Date(params.dateEnd);
            // Try server-side range filter; requires composite index for where + orderBy
            q = q.where('createdAt', '>=', firebaseAdmin_1.admin.firestore.Timestamp.fromDate(start))
                .where('createdAt', '<=', firebaseAdmin_1.admin.firestore.Timestamp.fromDate(end));
        }
        catch {
            filterByDateInMemory = true;
        }
    }
    // Handle cursor-based pagination (AFTER filters)
    if (params.cursor) {
        const cursorDoc = await col.doc(params.cursor).get();
        if (cursorDoc.exists) {
            q = q.startAfter(cursorDoc);
        }
    }
    // Skip total count to reduce query cost/latency; Firestore count queries require aggregation indexes
    let totalCount = undefined;
    // If we need to filter in-memory (generationType arrays OR mode !== 'all'), fetch a larger page to increase chances of filling the page
    const needsInMemoryFilter = Boolean(clientFilterTypes) || (params.mode && params.mode !== 'all') || Boolean(params.search);
    const fetchMultiplier = clientFilterTypes ? 3 : 2; // be less aggressive with overfetching
    const fetchLimit = needsInMemoryFilter ? Math.min(Math.max(params.limit * fetchMultiplier, params.limit), 150) : params.limit;
    const snap = await q.limit(fetchLimit).get();
    let items = snap.docs.map(d => normalizePublicItem(d.id, d.data()));
    if (clientFilterTypes) {
        items = items.filter((it) => clientFilterTypes.includes(String(it.generationType || '').toLowerCase()));
    }
    // Optional mode-based filtering by media presence (more robust than generationType)
    if (params.mode && params.mode !== 'all') {
        if (params.mode === 'video') {
            items = items.filter((it) => Array.isArray(it.videos) && it.videos.length > 0);
        }
        else if (params.mode === 'image') {
            items = items.filter((it) => Array.isArray(it.images) && it.images.length > 0);
        }
        else if (params.mode === 'music') {
            items = items.filter((it) => Array.isArray(it.audios) && it.audios.length > 0 || String(it.generationType || '').toLowerCase() === 'text-to-music');
        }
    }
    // Optional in-memory date filter fallback
    if (filterByDateInMemory && params.dateStart && params.dateEnd) {
        const startMs = new Date(params.dateStart).getTime();
        const endMs = new Date(params.dateEnd).getTime();
        items = items.filter((it) => {
            const ts = (it.createdAt && (it.createdAt.seconds ? it.createdAt.seconds * 1000 : Date.parse(it.createdAt))) || 0;
            return ts >= startMs && ts <= endMs;
        });
    }
    // Optional free-text prompt search (case-insensitive substring)
    if (params.search && params.search.trim().length > 0) {
        const needle = params.search.toLowerCase();
        items = items.filter((it) => {
            const p = String(it.prompt || '').toLowerCase();
            return p.includes(needle);
        });
    }
    // Exclude soft-deleted; treat missing as not deleted for old docs
    items = items.filter((it) => it.isDeleted !== true);
    const page = items.slice(0, params.limit);
    // Compute next cursor: prefer the last of the returned page; if fewer than limit items but we fetched a full window, advance cursor by the last doc of the snapshot so the client can continue
    let nextCursor;
    if (page.length === params.limit) {
        nextCursor = page[page.length - 1].id;
    }
    else if (snap.docs.length === fetchLimit) {
        // We likely have more docs beyond our filter window; advance by last doc in snapshot
        nextCursor = snap.docs[snap.docs.length - 1].id;
    }
    else {
        nextCursor = undefined;
    }
    return { items: page, nextCursor, totalCount };
}
async function getPublicById(generationId) {
    const ref = firebaseAdmin_1.adminDb.collection('generations').doc(generationId);
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    if (data.isPublic !== true)
        return null; // Only return if public
    return normalizePublicItem(snap.id, data);
}
exports.publicGenerationsRepository = {
    listPublic,
    getPublicById,
};
