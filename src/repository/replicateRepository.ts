import { adminDb } from '../config/firebaseAdmin';

export async function createGenerationRecord(data: any, createdBy: { uid: string; username?: string; email?: string } | undefined) {
  const docRef = await adminDb.collection('replicateGenerations').add({
    ...data,
    createdBy: createdBy || null,
    status: 'submitted',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return docRef.id;
}

export async function updateGenerationRecord(id: string, updates: any) {
  await adminDb.collection('replicateGenerations').doc(id).set({ ...updates, updatedAt: new Date().toISOString() }, { merge: true });
}

export const replicateRepository = { createGenerationRecord, updateGenerationRecord };


