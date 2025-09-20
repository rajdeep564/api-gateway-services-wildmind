import {
  FalGenerateRequest,
  FalGenerateResponse,
  FalGeneratedImage,
} from "../types/fal";
import { ApiError } from "../utils/errorHandler";
import { falRepository } from "../repository/falRepository";
import { fal } from "@fal-ai/client";
import axios from "axios";

async function generate(
  payload: FalGenerateRequest
): Promise<FalGenerateResponse> {
  const {
    prompt,
    userPrompt,
    model,
    n = 1,
    uploadedImages = [],
    output_format = "jpeg",
  } = payload;

  const falKey = process.env.FAL_KEY as string;
  if (!falKey) throw new ApiError("FAL AI API key not configured", 500);
  if (!prompt) throw new ApiError("Prompt is required", 400);

  fal.config({ credentials: falKey });

  const historyId = await falRepository.createGenerationRecord(payload);

  // Only gemini-25-flash-image supported for now
  const modelEndpoint =
    uploadedImages.length > 0
      ? "fal-ai/gemini-25-flash-image/edit"
      : "fal-ai/gemini-25-flash-image";

  try {
    const imagePromises = Array.from({ length: n }, async (_, index) => {
      const input: any = { prompt, output_format, num_images: 1 };
      if (modelEndpoint.endsWith("/edit")) {
        input.image_urls = uploadedImages.slice(0, 4);
      }

      const result = await fal.subscribe(modelEndpoint, {
        input,
        logs: true,
      });

      let imageUrl = "";
      if (result?.data?.images?.length > 0) {
        imageUrl = result.data.images[0].url;
      }
      if (!imageUrl)
        throw new ApiError("No image URL returned from FAL API", 502);

      return {
        url: imageUrl,
        originalUrl: imageUrl,
        id: result.requestId || `fal-${Date.now()}-${index}`,
      } as FalGeneratedImage;
    });

    const images = await Promise.all(imagePromises);
    await falRepository.updateGenerationRecord(historyId, {
      status: "completed",
      images,
    });
    return { images, historyId, model, status: "completed" };
  } catch (err: any) {
    const message = err?.message || "Failed to generate images with FAL API";
    await falRepository.updateGenerationRecord(historyId, {
      status: "failed",
      error: message,
    });
    throw new ApiError(message, 500);
  }
}

export const falService = {
  generate,
};
