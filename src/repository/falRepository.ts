import { FalGenerateRequest, FalGeneratedImage } from "../types/fal";
import { adminDb, admin } from "../config/firebaseAdmin";

async function createGenerationRecord(
  req: FalGenerateRequest
): Promise<string> {
  const doc = await adminDb.collection("generations").add({
    provider: "fal",
    prompt: req.prompt,
    model: req.model,
    n: req.n ?? 1,
    status: "generating",
    images: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return doc.id;
}

async function updateGenerationRecord(
  id: string,
  data: {
    status: "completed" | "failed";
    images?: FalGeneratedImage[];
    error?: string;
  }
): Promise<void> {
  await adminDb
    .collection("generations")
    .doc(id)
    .update({
      ...data,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

export const falRepository = {
  createGenerationRecord,
  updateGenerationRecord,
};
