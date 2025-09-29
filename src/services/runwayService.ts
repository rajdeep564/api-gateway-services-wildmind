import { ApiError } from "../utils/errorHandler";
import {
  RunwayTextToImageRequest,
  RunwayTextToImageResponse,
} from "../types/runway";
import { runwayRepository } from "../repository/runwayRepository";
import RunwayML from "@runwayml/sdk";
import { env } from "../config/env";
import { generationHistoryRepository } from "../repository/generationHistoryRepository";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import { authRepository } from "../repository/auth/authRepository";
import { uploadFromUrlToZata } from "../utils/storage/zataUpload";
import { creditsRepository } from "../repository/creditsRepository";
import { computeRunwayCostFromHistoryModel } from "../utils/pricing/runwayPricing";
//

// (SDK handles base/version internally)

function getRunwayClient(): RunwayML {
  const apiKey = env.runwayApiKey as string;
  if (!apiKey) throw new ApiError("Runway API key not configured", 500);
  return new RunwayML({ apiKey });
}

async function textToImage(
  uid: string,
  payload: RunwayTextToImageRequest
): Promise<RunwayTextToImageResponse & { historyId?: string }> {
  const { promptText, ratio, model, seed, uploadedImages, contentModeration } =
    payload;
  if (!promptText || !ratio || !model)
    throw new ApiError(
      "Missing required fields: promptText, ratio, model",
      400
    );
  if (!["gen4_image", "gen4_image_turbo"].includes(model))
    throw new ApiError("Invalid model", 400);
  if (
    model === "gen4_image_turbo" &&
    (!uploadedImages || uploadedImages.length === 0)
  ) {
    throw new ApiError(
      "gen4_image_turbo requires at least one reference image",
      400
    );
  }

  // Prefer SDK
  const client = getRunwayClient();
  // SDK expects referenceImages, not uploadedImages
  const referenceImages = (uploadedImages || []).map(
    (uri: string, i: number) => ({ uri, tag: `ref_${i + 1}` })
  );
  const created = await client.textToImage.create({
    model,
    promptText,
    ratio: ratio as any,
    ...(seed !== undefined ? { seed } : {}),
    ...(referenceImages.length > 0 ? { referenceImages } : {}),
    ...(contentModeration
      ? {
          contentModeration: {
            publicFigureThreshold: contentModeration.publicFigureThreshold as
              | "auto"
              | "low",
          },
        }
      : {}),
  });
  // Create authoritative history first
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: promptText,
    model,
    generationType: payload.generationType || 'text-to-image',
    visibility: (payload as any).visibility || 'private',
    tags: (payload as any).tags,
    nsfw: (payload as any).nsfw,
    isPublic: (payload as any).isPublic === true,
    createdBy,
  });
  try {
    await runwayRepository.createTaskRecord({
      mode: "text_to_image",
      model,
      ratio,
      promptText,
      seed,
      taskId: created.id,
      isPublic: (payload as any).isPublic === true,
      createdBy,
    });
  } catch {}
  // Store provider identifiers on history
  await generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id } as any);
  return { taskId: created.id, status: "pending", historyId };
}

async function getStatus(uid: string, id: string): Promise<any> {
  if (!id) throw new ApiError("Task ID is required", 400);
  const client = getRunwayClient();
  try {
    const task = await client.tasks.retrieve(id);
    // Optionally persist status progression
    try {
      await runwayRepository.updateTaskRecord(id, {
        status: task.status as any,
        outputs: Array.isArray((task as any).output)
          ? (task as any).output
          : undefined,
      });
    } catch {}
    // When completed, attach outputs into history and mirror
    if (task.status === 'SUCCEEDED') {
      // Find history by providerTaskId (requires uid-scoped search)
      const found = await generationHistoryRepository.findByProviderTaskId(uid, 'runway', id);
      if (found) {
        const outputs = (task as any).output || [];
        const creator = await authRepository.getUserById(uid);
        const username = creator?.username || uid;
        // Upload each output to Zata (assume images for text_to_image; videos for others)
        const isImage = (task as any)?.type === 'text_to_image' || (found.item?.generationType === 'text-to-image');
        if (isImage) {
          const storedImages = await Promise.all((outputs as any[]).map(async (u: string, i: number) => {
            try {
              const { key, publicUrl } = await uploadFromUrlToZata({
                sourceUrl: u,
                keyPrefix: `users/${username}/image/${found.id}`,
                fileName: `image-${i + 1}`,
              });
              return { id: `${id}-${i}`, url: publicUrl, storagePath: key, originalUrl: u };
            } catch {
              return { id: `${id}-${i}`, url: u, originalUrl: u } as any;
            }
          }));
          await generationHistoryRepository.update(uid, found.id, { status: 'completed', images: storedImages } as any);
          try {
            const { cost, pricingVersion, meta } = computeRunwayCostFromHistoryModel(found.item.model);
            await creditsRepository.writeDebitIfAbsent(uid, found.id, cost, 'runway.generate', { ...meta, historyId: found.id, provider: 'runway', pricingVersion });
          } catch {}
        } else {
          const storedVideos = await Promise.all((outputs as any[]).map(async (u: string, i: number) => {
            try {
              const { key, publicUrl } = await uploadFromUrlToZata({
                sourceUrl: u,
                keyPrefix: `users/${username}/video/${found.id}`,
                fileName: `video-${i + 1}`,
              });
              return { id: `${id}-${i}`, url: publicUrl, storagePath: key, originalUrl: u };
            } catch {
              return { id: `${id}-${i}`, url: u, originalUrl: u } as any;
            }
          }));
          await generationHistoryRepository.update(uid, found.id, { status: 'completed', videos: storedVideos } as any);
          try {
            const { cost, pricingVersion, meta } = computeRunwayCostFromHistoryModel(found.item.model);
            await creditsRepository.writeDebitIfAbsent(uid, found.id, cost, 'runway.video', { ...meta, historyId: found.id, provider: 'runway', pricingVersion });
          } catch {}
        }
        try {
          const creator = await authRepository.getUserById(uid);
          const fresh = await generationHistoryRepository.get(uid, found.id);
          if (fresh) {
            await generationsMirrorRepository.upsertFromHistory(uid, found.id, fresh, {
              uid,
              username: creator?.username,
              displayName: (creator as any)?.displayName,
              photoURL: creator?.photoURL,
            });
          }
        } catch {}
      }
    }
    return task;
  } catch (e: any) {
    if (e?.status === 404)
      throw new ApiError("Task not found or was deleted/canceled", 404);
    throw new ApiError("Runway API request failed", 500, e);
  }
}

async function videoGenerate(
  uid: string,
  body: any
): Promise<{
  success: boolean;
  taskId: string;
  mode: string;
  endpoint: string;
  historyId?: string;
}> {
  const client = getRunwayClient();
  const { mode, imageToVideo, videoToVideo, textToVideo, videoUpscale } =
    body || {};
  if (mode === "image_to_video") {
    const created = await client.imageToVideo.create(imageToVideo);
    const prompt = (imageToVideo && imageToVideo.prompts && imageToVideo.prompts[0]?.text) || '';
    const { historyId } = await generationHistoryRepository.create(uid, { prompt, model: 'runway_video', generationType: body.generationType || 'text-to-video', visibility: (body as any).visibility || 'private', tags: (body as any).tags, nsfw: (body as any).nsfw } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id } as any);
    return {
      success: true,
      taskId: created.id,
      mode,
      endpoint: "/v1/image_to_video",
      historyId,
    };
  }
  if (mode === "text_to_video") {
    const created = await client.textToVideo.create(textToVideo);
    const prompt = textToVideo?.promptText || '';
    const { historyId } = await generationHistoryRepository.create(uid, { prompt, model: 'runway_video', generationType: body.generationType || 'text-to-video', visibility: (body as any).visibility || 'private', tags: (body as any).tags, nsfw: (body as any).nsfw } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id } as any);
    return {
      success: true,
      taskId: created.id,
      mode,
      endpoint: "/v1/text_to_video",
      historyId,
    };
  }
  if (mode === "video_to_video") {
    const created = await client.videoToVideo.create(videoToVideo);
    const prompt = (videoToVideo && videoToVideo.prompts && videoToVideo.prompts[0]?.text) || '';
    const { historyId } = await generationHistoryRepository.create(uid, { prompt, model: 'runway_video', generationType: body.generationType || 'text-to-video', visibility: (body as any).visibility || 'private', tags: (body as any).tags, nsfw: (body as any).nsfw } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id } as any);
    return {
      success: true,
      taskId: created.id,
      mode,
      endpoint: "/v1/video_to_video",
      historyId,
    };
  }
  if (mode === "video_upscale") {
    const created = await client.videoUpscale.create(videoUpscale);
    const prompt = '';
    const { historyId } = await generationHistoryRepository.create(uid, { prompt, model: 'runway_video_upscale', generationType: body.generationType || 'text-to-video', visibility: (body as any).visibility || 'private', tags: (body as any).tags, nsfw: (body as any).nsfw } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'runway', providerTaskId: created.id } as any);
    return {
      success: true,
      taskId: created.id,
      mode,
      endpoint: "/v1/video_upscale",
      historyId,
    };
  }
  throw new ApiError(
    "Invalid mode. Must be one of image_to_video, text_to_video, video_to_video, video_upscale",
    400
  );
}

export const runwayService = {
  textToImage,
  getStatus,
  videoGenerate,
};
