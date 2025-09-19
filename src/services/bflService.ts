import {
  BflGenerateRequest,
  BflGenerateResponse,
  GeneratedImage,
  FrameSize,
} from "../types/bfl";
import { ApiError } from "../utils/errorHandler";
import { ALLOWED_MODELS } from "../middlewares/validateBflGenerate";
import { bflRepository } from "../repository/bflRepository";
import { bflutils } from "../utils/bflutils";
import { ImageStorageService } from "./imageStorageService";
import { logger } from "../utils/logger";



async function pollForResults(
  pollingUrl: string,
  apiKey: string
): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const pollResponse = await fetch(pollingUrl, {
      headers: { accept: "application/json", "x-key": apiKey },
    });
    if (!pollResponse.ok) {
      let errorPayload: any = undefined;
      try {
        errorPayload = await pollResponse.json();
      } catch (_) {
        try {
          const text = await pollResponse.text();
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
    const result = await pollResponse.json();
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
  payload: BflGenerateRequest
): Promise<BflGenerateResponse> {
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
  if (!ALLOWED_MODELS.includes(model)) throw new ApiError("Unsupported model", 400);

  // create generation record (stubbed DB)
  const historyId = await bflRepository.createGenerationRecord(payload);

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

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "x-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        let errorPayload: any = undefined;
        try {
          errorPayload = await response.json();
        } catch (_) {
          try {
            const text = await response.text();
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

      const data = await response.json();
      if (!data.polling_url) throw new ApiError("No polling URL received", 502);

      const imageUrl = await pollForResults(data.polling_url, apiKey);
      return {
        url: imageUrl,
        originalUrl: imageUrl,
        id: data.id as string,
      } as GeneratedImage;
    });

    const bflImages = await Promise.all(imagePromises);
    
    // Upload generated images to Zata AI storage
    logger.info({ 
      imageCount: bflImages.length, 
      prompt: payload.prompt?.substring(0, 50) + '...',
      model: payload.model 
    }, 'Uploading generated images to Zata');
    
    const zataUploadResults = await ImageStorageService.downloadAndUploadMultipleToZata(
      bflImages.map(img => img.url),
      bflImages.map((img, index) => 
        ImageStorageService.generateImageKey(payload.prompt, payload.model, index)
      )
    );

    // Create final images array with Zata URLs
    const images: GeneratedImage[] = bflImages.map((bflImage, index) => {
      const zataResult = zataUploadResults[index];
      
      if (zataResult.success && zataResult.zataUrl) {
        // Use Zata URL as the primary URL, keep original as backup
        return {
          id: bflImage.id,
          url: zataResult.zataUrl,
          originalUrl: bflImage.originalUrl,
          zataUrl: zataResult.zataUrl,
          zataKey: zataResult.zataKey,
          bflUrl: bflImage.url
        };
      } else {
        // Fallback to original BFL URL if Zata upload failed
        logger.warn({ 
          bflUrl: bflImage.url, 
          error: zataResult.error 
        }, 'Zata upload failed, using original BFL URL');
        
        return {
          id: bflImage.id,
          url: bflImage.url,
          originalUrl: bflImage.originalUrl,
          bflUrl: bflImage.url,
          zataUploadError: zataResult.error
        };
      }
    });

    await bflRepository.updateGenerationRecord(historyId, {
      status: "completed",
      images,
      frameSize,
    });
    
    return { images };
  } catch (err: any) {
    const message = err?.message || "Failed to generate images";
    await bflRepository.updateGenerationRecord(historyId, {
      status: "failed",
      error: message,
    });
    throw err;
  }
}

export const bflService = {
  generate,
  pollForResults
}
