import axios from "axios";
import { ApiError } from "../utils/errorHandler";
import {
  RunwayTextToImageRequest,
  RunwayTextToImageResponse,
} from "../types/runway";
import { runwayRepository } from "../repository/runwayRepository";
import RunwayML from "@runwayml/sdk";

const RUNWAY_API_BASE = "https://api.dev.runwayml.com";
const RUNWAY_VERSION = "2024-11-06";

function getRunwayClient(): RunwayML {
  const apiKey = process.env.RUNWAY_API_KEY as string;
  if (!apiKey) throw new ApiError("Runway API key not configured", 500);
  return new RunwayML({ apiKey });
}

async function textToImage(
  payload: RunwayTextToImageRequest
): Promise<RunwayTextToImageResponse> {
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
  try {
    await runwayRepository.createTaskRecord({
      mode: "text_to_image",
      model,
      ratio,
      promptText,
      seed,
      taskId: created.id,
    });
  } catch {}
  return { taskId: created.id, status: "pending" };
}

async function getStatus(id: string): Promise<any> {
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
    return task;
  } catch (e: any) {
    if (e?.status === 404)
      throw new ApiError("Task not found or was deleted/canceled", 404);
    throw new ApiError("Runway API request failed", 500, e);
  }
}

async function videoGenerate(
  body: any
): Promise<{
  success: boolean;
  taskId: string;
  mode: string;
  endpoint: string;
}> {
  const client = getRunwayClient();
  const { mode, imageToVideo, videoToVideo, textToVideo, videoUpscale } =
    body || {};
  if (mode === "image_to_video") {
    const created = await client.imageToVideo.create(imageToVideo);
    return {
      success: true,
      taskId: created.id,
      mode,
      endpoint: "/v1/image_to_video",
    };
  }
  if (mode === "text_to_video") {
    const created = await client.textToVideo.create(textToVideo);
    return {
      success: true,
      taskId: created.id,
      mode,
      endpoint: "/v1/text_to_video",
    };
  }
  if (mode === "video_to_video") {
    const created = await client.videoToVideo.create(videoToVideo);
    return {
      success: true,
      taskId: created.id,
      mode,
      endpoint: "/v1/video_to_video",
    };
  }
  if (mode === "video_upscale") {
    const created = await client.videoUpscale.create(videoUpscale);
    return {
      success: true,
      taskId: created.id,
      mode,
      endpoint: "/v1/video_upscale",
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
