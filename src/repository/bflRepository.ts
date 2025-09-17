import { BflGenerateRequest, GeneratedImage, FrameSize } from '../types/bfl';
import { adminDb, admin } from '../config/firebaseAdmin';

 async function createGenerationRecord(req: BflGenerateRequest): Promise<string> {
  const colRef = adminDb.collection('generations');
  const docRef = await colRef.add({
    prompt: req.prompt,
    model: req.model,
    n: req.n ?? 1,
    frameSize: req.frameSize ?? '1:1',
    style: req.style ?? null,
    status: 'generating',
    images: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return docRef.id;
}

 async function updateGenerationRecord(
  id: string,
  data: { status: 'completed' | 'failed'; images?: GeneratedImage[]; error?: string; frameSize?: FrameSize; style?: string }
): Promise<void> {
  const docRef = adminDb.collection('generations').doc(id);
  await docRef.update({
    ...data,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

export const bflRepository = {
  createGenerationRecord,
  updateGenerationRecord
}
