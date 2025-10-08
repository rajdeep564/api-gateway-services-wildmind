"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicGenerationsRepository = void 0;
exports.listPublic = listPublic;
exports.getPublicById = getPublicById;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
function normalizePublicItem(id, data) {
    const { uid, prompt, model, generationType, status, visibility, tags, nsfw, images, videos, createdBy, isPublic, createdAt, updatedAt, isDeleted } = data;
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
        createdBy,
        isPublic,
        isDeleted,
        createdAt,
        updatedAt: updatedAt || createdAt
    };
}
async function listPublic(params) {
    const col = firebaseAdmin_1.adminDb.collection('generations');
    // Default sorting
    const sortBy = params.sortBy || 'createdAt';
    const sortOrder = params.sortOrder || 'desc';
    let q = col.orderBy(sortBy, sortOrder);
    // Only show public; we will exclude deleted after fetch so old docs without the flag still appear
    q = q.where('isPublic', '==', true);
    // Apply filters
    if (params.generationType) {
        q = q.where('generationType', '==', params.generationType);
    }
    if (params.status) {
        q = q.where('status', '==', params.status);
    }
    if (params.createdBy) {
        q = q.where('createdBy.uid', '==', params.createdBy);
    }
    // Handle cursor-based pagination (AFTER filters)
    if (params.cursor) {
        const cursorDoc = await col.doc(params.cursor).get();
        if (cursorDoc.exists) {
            q = q.startAfter(cursorDoc);
        }
    }
    // Get total count for pagination context
    let totalCount;
    if (params.generationType || params.status || params.createdBy) {
        const countQuery = await col.where('isPublic', '==', true).get();
        totalCount = countQuery.docs.length;
    }
    const fetchCount = Math.max(params.limit * 2, params.limit);
    const snap = await q.limit(fetchCount).get();
    let items = snap.docs.map(d => normalizePublicItem(d.id, d.data()));
    // Exclude soft-deleted; treat missing as not deleted for old docs
    items = items.filter((it) => it.isDeleted !== true);
    const page = items.slice(0, params.limit);
    const nextCursor = page.length === params.limit ? page[page.length - 1].id : undefined;
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
