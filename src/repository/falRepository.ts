import { FalGenerateRequest, FalGeneratedImage } from "../types/fal";
import { adminDb, admin } from "../config/firebaseAdmin";

async function createGenerationRecord(

  req: {
    prompt: string;
    model: string;
    n?: number;
    isPublic?: boolean;
    resolution?: string;
    duration?: string | number;
    aspect_ratio?: string;
    image_url?: string;
    end_image_url?: string;
    generate_audio?: boolean;
    seed?: number;
    end_user_id?: string;
  },
  createdBy?: { uid: string; username?: string; email?: string }
): Promise<string> {
  const colRef = adminDb.collection("generations");
  const docRef = await colRef.add({
    prompt: req.prompt,
    model: req.model,
    n: req.n ?? 1,
    status: "generating",
    images: [],
    videos: [],
    isPublic: req.isPublic ?? false,
    resolution: req.resolution ?? null,
    duration: req.duration ?? null,
    aspect_ratio: req.aspect_ratio ?? null,
    generate_audio:
      typeof req.generate_audio === "boolean" ? req.generate_audio : null,
    seed: typeof req.seed === "number" ? req.seed : null,
    end_user_id: req.end_user_id ?? null,
    createdBy: createdBy
      ? {
          uid: createdBy.uid,
          username: createdBy.username || null,
          email: createdBy.email || null,
        }
      : null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return docRef.id;
}

async function updateGenerationRecord(
  id: string,
  data: {
    status: "completed" | "failed";
    images?: Array<{ id: string; url: string; storagePath?: string; originalUrl?: string }>;
    videos?: Array<{ id: string; url: string; storagePath?: string; thumbUrl?: string }>;
    error?: string;
  }
): Promise<void> {
  const docRef = adminDb.collection("generations").doc(id);
  await docRef.update({
    ...data,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export const falRepository = {
  createGenerationRecord,
  updateGenerationRecord,
};
