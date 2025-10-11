"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runwayRepository = void 0;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
async function createTaskRecord(data) {
    const doc = await firebaseAdmin_1.adminDb.collection("generations").add({
        provider: "runway",
        mode: data.mode,
        model: data.model,
        ratio: data.ratio ?? null,
        promptText: data.promptText ?? null,
        seed: data.seed ?? null,
        taskId: data.taskId,
        status: "pending",
        outputs: [],
        isPublic: data.isPublic ?? false,
        createdBy: data.createdBy
            ? {
                uid: data.createdBy.uid,
                username: data.createdBy.username || null,
                email: data.createdBy.email || null,
            }
            : null,
        createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
    });
    return doc.id;
}
async function updateTaskRecord(id, update) {
    await firebaseAdmin_1.adminDb
        .collection("generations")
        .doc(id)
        .update({
        status: update.status,
        outputs: update.outputs ?? [],
        error: update.error ?? null,
        updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
    });
}
exports.runwayRepository = {
    createTaskRecord,
    updateTaskRecord,
};
