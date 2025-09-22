import {
  BflGenerateRequest,
  BflGenerateResponse,
  GeneratedImage,
  FrameSize,
} from "../types/bfl";
import { ApiError } from "../utils/errorHandler";
import { ALLOWED_MODELS } from "../middlewares/validators/bfl/validateBflGenerate";
import { bflRepository } from "../repository/bflRepository";
import { bflutils } from "../utils/bflutils";
import axios from "axios";
import { generationHistoryRepository } from "../repository/generationHistoryRepository";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import { authRepository } from "../repository/auth/authRepository";
import { GenerationHistoryItem } from "../types/generate";

async function pollForResults(
  pollingUrl: string,
  apiKey: string
): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const pollResponse = await axios.get(pollingUrl, {
      headers: { accept: "application/json", "x-key": apiKey },
      validateStatus: () => true,
    });
    if (pollResponse.status < 200 || pollResponse.status >= 300) {
      let errorPayload: any = undefined;
      try {
        errorPayload = pollResponse.data;
      } catch (_) {
        try {
          const text = String(pollResponse.data);
          errorPayload = { message: text };
        } catch {}
      }
      const reason =
        (errorPayload && (errorPayload.message || errorPayload.error)) ||
        "Unknown error";
      throw new ApiError(
        `Polling failed: ${reason}`,
        pollResponse.status,
        errorPayload
      );
    }
    const result = pollResponse.data;
    if (result.status === "Ready") {
      return result.result.sample as string;
    }
    if (result.status === "Error" || result.status === "Failed") {
      throw new ApiError("Generation failed", 500, result);
    }
  }
  throw new ApiError("Timeout waiting for image generation", 504);
}

export async function generate(
  uid: string,
  payload: BflGenerateRequest
): Promise<BflGenerateResponse & { historyId?: string }> {
  const {
    prompt,
    model,
    n = 1,
    frameSize = "1:1",
    uploadedImages = [],
    width,
    height,
  } = payload;

  const apiKey = process.env.BFL_API_KEY as string;
  if (!apiKey) throw new ApiError("API key not configured", 500);
  if (!prompt) throw new ApiError("Prompt is required", 400);
  if (!ALLOWED_MODELS.includes(model))
    throw new ApiError("Unsupported model", 400);

  // create legacy generation record (existing repo)
  const legacyId = await bflRepository.createGenerationRecord(payload);
  // create authoritative history first
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt,
    model,
    generationType: (payload as any).generationType || 'text-to-image',
    visibility: (payload as any).visibility || 'private',
    tags: (payload as any).tags,
    nsfw: (payload as any).nsfw,
  });

  try {
    const imagePromises = Array.from({ length: n }, async () => {
      const normalizedModel = (model as string)
        .toLowerCase()
        .replace(/\s+/g, "-");
      const endpoint = `https://api.bfl.ai/v1/${normalizedModel}`;

      let body: any = { prompt };
      if (normalizedModel.includes("kontext")) {
        body.aspect_ratio = frameSize;
        body.output_format = "jpeg";
        if (Array.isArray(uploadedImages) && uploadedImages.length > 0) {
          const [img1, img2, img3, img4] = uploadedImages;
          if (img1) body.input_image = img1;
          if (img2) body.input_image_2 = img2;
          if (img3) body.input_image_3 = img3;
          if (img4) body.input_image_4 = img4;
        }
      } else if (
        normalizedModel === "flux-pro" ||
        normalizedModel === "flux-pro-1.1" ||
        normalizedModel === "flux-pro-1.1-ultra"
      ) {
        if (width && height) {
          body.width = width;
          body.height = height;
        } else {
          const { width: convertedWidth, height: convertedHeight } =
            bflutils.getDimensions(frameSize as FrameSize);
          body.width = convertedWidth;
          body.height = convertedHeight;
        }
        body.output_format = "jpeg";
      } else if (normalizedModel === "flux-dev") {
        const { width: convertedWidth, height: convertedHeight } =
          bflutils.getDimensions(frameSize as FrameSize);
        body.width = convertedWidth;
        body.height = convertedHeight;
        body.output_format = "jpeg";
      } else {
        body.aspect_ratio = frameSize;
        body.output_format = "jpeg";
      }

      const response = await axios.post(endpoint, body, {
        headers: {
          accept: "application/json",
          "x-key": apiKey,
          "Content-Type": "application/json",
        },
        validateStatus: () => true,
      });
      if (response.status < 200 || response.status >= 300) {
        let errorPayload: any = undefined;
        try {
          errorPayload = response.data;
        } catch (_) {
          try {
            const text = String(response.data);
            errorPayload = { message: text };
          } catch {}
        }
        const reason =
          (errorPayload && (errorPayload.message || errorPayload.error)) ||
          "Unknown error";
        throw new ApiError(
          `Failed to initiate image generation: ${reason}`,
          response.status,
          errorPayload
        );
      }
      const data = response.data;
      if (!data.polling_url) throw new ApiError("No polling URL received", 502);

      const imageUrl = await pollForResults(data.polling_url, apiKey);
      return {
        url: imageUrl,
        originalUrl: imageUrl,
        id: data.id as string,
      } as GeneratedImage;
    });

    const images = await Promise.all(imagePromises);
    await bflRepository.updateGenerationRecord(legacyId, {
      status: "completed",
      images,
      frameSize,
    });
    // update authoritative history and mirror
    await generationHistoryRepository.update(uid, historyId, {
      status: 'completed',
      images,
      // persist optional fields
      ...(frameSize ? { frameSize: frameSize as any } : {}),
    } as Partial<GenerationHistoryItem>);
    try {
      const creator = await authRepository.getUserById(uid);
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) {
        await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
          uid,
          username: creator?.username,
          displayName: (creator as any)?.displayName,
          photoURL: creator?.photoURL,
        });
      }
    } catch {}
    return { images, historyId };
  } catch (err: any) {
    const message = err?.message || "Failed to generate images";
    await bflRepository.updateGenerationRecord(legacyId, {
      status: "failed",
      error: message,
    });
    try {
      await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) {
        await generationsMirrorRepository.updateFromHistory(uid, historyId, fresh);
      }
    } catch {}
    throw err;
  }
}

export const bflService = {
  generate,
  pollForResults,
};
