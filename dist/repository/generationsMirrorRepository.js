"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generationsMirrorRepository = void 0;
exports.upsertFromHistory = upsertFromHistory;
exports.updateFromHistory = updateFromHistory;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
async function upsertFromHistory(uid, historyId, historyDoc, createdBy) {
    const ref = firebaseAdmin_1.adminDb.collection('generations').doc(historyId);
    await ref.set({
        ...historyDoc,
        createdBy,
        uid,
        id: historyId,
        updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        ...(historyDoc.createdAt ? { createdAt: historyDoc.createdAt } : { createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp() }),
    }, { merge: true });
}
async function updateFromHistory(uid, historyId, updates) {
    const ref = firebaseAdmin_1.adminDb.collection('generations').doc(historyId);
    await ref.set({
        ...updates,
        uid,
        id: historyId,
        updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}
exports.generationsMirrorRepository = {
    upsertFromHistory,
    updateFromHistory,
};
