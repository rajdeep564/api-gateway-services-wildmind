"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.falRepository = void 0;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
async function createGenerationRecord(req, createdBy) {
    const colRef = firebaseAdmin_1.adminDb.collection("generations");
    const docRef = await colRef.add({
        prompt: req.prompt,
        model: req.model,
        n: req.n ?? 1,
        status: "generating",
        images: [],
        videos: [],
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
    return docRef.id;
}
async function updateGenerationRecord(id, data) {
    const docRef = firebaseAdmin_1.adminDb.collection("generations").doc(id);
    await docRef.update({
        ...data,
        updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
    });
}
exports.falRepository = {
    createGenerationRecord,
    updateGenerationRecord,
};
