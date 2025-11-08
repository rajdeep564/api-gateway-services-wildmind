"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replicateRepository = void 0;
exports.createGenerationRecord = createGenerationRecord;
exports.updateGenerationRecord = updateGenerationRecord;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
async function createGenerationRecord(data, createdBy) {
    const docRef = await firebaseAdmin_1.adminDb.collection('replicateGenerations').add({
        ...data,
        createdBy: createdBy || null,
        status: 'submitted',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
    return docRef.id;
}
async function updateGenerationRecord(id, updates) {
    await firebaseAdmin_1.adminDb.collection('replicateGenerations').doc(id).set({ ...updates, updatedAt: new Date().toISOString() }, { merge: true });
}
exports.replicateRepository = { createGenerationRecord, updateGenerationRecord };
