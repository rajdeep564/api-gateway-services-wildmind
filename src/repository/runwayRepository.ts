import { adminDb, admin } from "../config/firebaseAdmin";

type RunwayMode =
  | "text_to_image"
  | "image_to_video"
  | "text_to_video"
  | "video_to_video"
  | "video_upscale";

async function createTaskRecord(data: {
  mode: RunwayMode;
  model: string;
  ratio?: string;
  promptText?: string;
  seed?: number;
  taskId: string;
}): Promise<string> {
  const doc = await adminDb.collection("generations").add({
    provider: "runway",
    mode: data.mode,
    model: data.model,
    ratio: data.ratio ?? null,
    promptText: data.promptText ?? null,
    seed: data.seed ?? null,
    taskId: data.taskId,
    status: "pending",
    outputs: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return doc.id;
}

async function updateTaskRecord(
  id: string,
  update: {
    status:
      | "PENDING"
      | "RUNNING"
      | "SUCCEEDED"
      | "FAILED"
      | "CANCELLED"
      | "THROTTLED";
    outputs?: string[];
    error?: string;
  }
): Promise<void> {
  await adminDb
    .collection("generations")
    .doc(id)
    .update({
      status: update.status,
      outputs: update.outputs ?? [],
      error: update.error ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

export const runwayRepository = {
  createTaskRecord,
  updateTaskRecord,
};
