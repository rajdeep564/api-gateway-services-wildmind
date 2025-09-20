import {
  MinimaxGenerateRequest,
  MinimaxGeneratedImage,
} from "../types/minimax";
import { adminDb, admin } from "../config/firebaseAdmin";

async function createGenerationRecord(
  req: MinimaxGenerateRequest
): Promise<string> {
  const doc = await adminDb.collection("generations").add({
    provider: "minimax",
    prompt: req.prompt,
    model: "image-01",
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
    images?: MinimaxGeneratedImage[];
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

export const minimaxRepository = {
  createGenerationRecord,
  updateGenerationRecord,
};
