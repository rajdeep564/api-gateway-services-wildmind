import { generationHistoryRepository } from "../repository/generationHistoryRepository";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import {
  GenerationStatus,
  CreateGenerationPayload,
  CompleteGenerationPayload,
  FailGenerationPayload,
  GenerationHistoryItem,
} from "../types/generate";
import { authRepository } from "../repository/auth/authRepository";
import { ApiError } from "../utils/errorHandler";

export async function startGeneration(
  uid: string,
  payload: CreateGenerationPayload
): Promise<{ historyId: string } & { item: GenerationHistoryItem }> {
  const { historyId } = await generationHistoryRepository.create(uid, payload);
  const item = await generationHistoryRepository.get(uid, historyId);
  if (!item) throw new ApiError("Failed to read created history item", 500);
  try {
    const creator = await authRepository.getUserById(uid);
    await generationsMirrorRepository.upsertFromHistory(uid, historyId, item, {
      uid,
      username: creator?.username,
      displayName: (creator as any)?.displayName,
      photoURL: creator?.photoURL,
    });
  } catch {}
  return { historyId, item };
}

export async function markGenerationCompleted(
  uid: string,
  historyId: string,
  updates: Omit<CompleteGenerationPayload, "status"> & { status: "completed" }
): Promise<void> {
  const existing = await generationHistoryRepository.get(uid, historyId);
  if (!existing) throw new ApiError("History item not found", 404);
  if (existing.status !== GenerationStatus.Generating)
    throw new ApiError("Invalid status transition", 400);
  const next: Partial<GenerationHistoryItem> = {
    status: GenerationStatus.Completed,
    images: updates.images,
    videos: updates.videos,
    isPublic: updates.isPublic ?? existing.isPublic ?? false,
    tags: updates.tags ?? existing.tags,
    nsfw: updates.nsfw ?? existing.nsfw,
  };
  await generationHistoryRepository.update(uid, historyId, next);
  try {
    const creator = await authRepository.getUserById(uid);
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh) {
      await generationsMirrorRepository.upsertFromHistory(
        uid,
        historyId,
        fresh,
        {
          uid,
          username: creator?.username,
          displayName: (creator as any)?.displayName,
          photoURL: creator?.photoURL,
        }
      );
    }
  } catch {}
}

export async function markGenerationFailed(
  uid: string,
  historyId: string,
  payload: Omit<FailGenerationPayload, "status"> & { status: "failed" }
): Promise<void> {
  const existing = await generationHistoryRepository.get(uid, historyId);
  if (!existing) throw new ApiError("History item not found", 404);
  if (existing.status !== GenerationStatus.Generating)
    throw new ApiError("Invalid status transition", 400);
  await generationHistoryRepository.update(uid, historyId, {
    status: GenerationStatus.Failed,
    error: payload.error,
  });
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh) {
      await generationsMirrorRepository.updateFromHistory(
        uid,
        historyId,
        fresh
      );
    }
  } catch {}
}

export async function getUserGeneration(
  uid: string,
  historyId: string
): Promise<GenerationHistoryItem | null> {
  return generationHistoryRepository.get(uid, historyId);
}

export async function listUserGenerations(
  uid: string,
  params: {
    limit: number;
    cursor?: string;
    status?: "generating" | "completed" | "failed";
    generationType?: string | string[];
    sortBy?: 'createdAt' | 'updatedAt' | 'prompt';
    sortOrder?: 'asc' | 'desc';
    dateStart?: string;
    dateEnd?: string;
  }
): Promise<{ items: GenerationHistoryItem[]; nextCursor?: string; totalCount?: number }> {
  // Delegate to repository; it handles optional in-memory date-range fallback when indexes are missing
  return generationHistoryRepository.list(uid, params as any);
}

export async function softDelete(uid: string, historyId: string): Promise<void> {
  
  const existing = await generationHistoryRepository.get(uid, historyId);
  if (!existing) throw new ApiError('History item not found', 404);
  await generationHistoryRepository.update(uid, historyId, { isDeleted: true, isPublic: false } as any);
  try {
    await generationsMirrorRepository.updateFromHistory(uid, historyId, { isDeleted: true, isPublic: false } as any);
  } catch (e) {
    try {
      await generationsMirrorRepository.remove(historyId);
    } catch {}
  }
}

export async function update(uid: string, historyId: string, updates: Partial<GenerationHistoryItem>): Promise<void> {
  const existing = await generationHistoryRepository.get(uid, historyId);
  if (!existing) throw new ApiError('History item not found', 404);

  // Support per-media privacy updates
  let nextDoc: Partial<GenerationHistoryItem> = { ...updates };

  // If client sends { image: { id, isPublic } } then update matching image in arrays
  const anyImageUpdate = (updates as any)?.image;
  if (anyImageUpdate && typeof anyImageUpdate === 'object') {
    const imgUpd = anyImageUpdate as any;
    const images = Array.isArray(existing.images) ? [...(existing.images as any[])] : [];
    const idx = images.findIndex((im: any) => (imgUpd.id && im.id === imgUpd.id) || (imgUpd.url && im.url === imgUpd.url) || (imgUpd.storagePath && im.storagePath === imgUpd.storagePath));
    if (idx >= 0) {
      images[idx] = { ...images[idx], ...imgUpd };
      nextDoc.images = images as any;
    }
  }

  // If client sends { video: { id, isPublic } } then update matching video in arrays
  const anyVideoUpdate = (updates as any)?.video;
  if (anyVideoUpdate && typeof anyVideoUpdate === 'object') {
    const vdUpd = anyVideoUpdate as any;
    const videos = Array.isArray(existing.videos) ? [...(existing.videos as any[])] : [];
    const idx = videos.findIndex((vd: any) => (vdUpd.id && vd.id === vdUpd.id) || (vdUpd.url && vd.url === vdUpd.url) || (vdUpd.storagePath && vd.storagePath === vdUpd.storagePath));
    if (idx >= 0) {
      videos[idx] = { ...videos[idx], ...vdUpd };
      nextDoc.videos = videos as any;
    }
  }

  // Recompute document-level isPublic as true if any media item is explicitly public
  if (nextDoc.images || nextDoc.videos || typeof (updates as any)?.isPublic === 'boolean') {
    const imgs = (nextDoc.images || existing.images || []) as any[];
    const vds = (nextDoc.videos || existing.videos || []) as any[];
    const anyPublic = imgs.some((im: any) => im?.isPublic === true) || vds.some((vd: any) => vd?.isPublic === true);
    nextDoc.isPublic = anyPublic;
  }

  await generationHistoryRepository.update(uid, historyId, nextDoc);

  try {
    await generationsMirrorRepository.updateFromHistory(uid, historyId, nextDoc);
  } catch (e) {
    console.warn('Failed to update mirror repository:', e);
  }
}

export const generationHistoryService = {
  startGeneration,
  markGenerationCompleted,
  markGenerationFailed,
  getUserGeneration,
  listUserGenerations,
  softDelete,
  update,
};
