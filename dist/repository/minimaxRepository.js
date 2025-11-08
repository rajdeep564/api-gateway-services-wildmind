"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.minimaxRepository = void 0;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
async function createGenerationRecord(req, createdBy) {
    const doc = await firebaseAdmin_1.adminDb.collection("generations").add({
        provider: "minimax",
        prompt: req.prompt,
        model: "image-01",
        n: req.n ?? 1,
        status: "generating",
        images: [],
        isPublic: req.isPublic ?? false,
        createdBy: createdBy
            ? {
                uid: createdBy.uid,
                username: createdBy.username || null,
                email: createdBy.email || null,
            }
            : null,
        createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
    });
    return doc.id;
}
async function updateGenerationRecord(id, data) {
    await firebaseAdmin_1.adminDb
        .collection("generations")
        .doc(id)
        .update({
        ...data,
        updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
    });
}
exports.minimaxRepository = {
    createGenerationRecord,
    updateGenerationRecord,
};
