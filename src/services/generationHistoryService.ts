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

export const generationHistoryService = {
  startGeneration,
  markGenerationCompleted,
  markGenerationFailed,
  getUserGeneration,
  listUserGenerations,
};
