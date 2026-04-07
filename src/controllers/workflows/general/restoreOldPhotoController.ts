import { Request, Response, NextFunction } from "express";
import {
  restoreOldPhoto,
  RestoreOldPhotoRequest,
} from "../../../services/workflows/general/restoreOldPhotoService";
import { ApiError } from "../../../utils/errorHandler";
import { postSuccessDebit } from "../../../utils/creditDebit";

/**
 * Controller for restoring old photos
 */
export async function restoreOldPhotoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      throw new ApiError("User not authenticated", 401);
    }

    const {
      image,
      image_input,
      uploadedImages,
      prompt,
      frameSize,
      aspect_ratio,
      size,
      output_format,
      style,
      model,
      isPublic,
    } = req.body || {};

    const primaryImage =
      Array.isArray(image_input) && image_input.length > 0
        ? image_input[0]
        : Array.isArray(uploadedImages) && uploadedImages.length > 0
          ? uploadedImages[0]
          : image;

    if (!primaryImage) {
      throw new ApiError("image URL is required", 400);
    }

    const requestPayload: RestoreOldPhotoRequest = {
      imageUrl: primaryImage,
      image_input: Array.isArray(image_input) ? image_input : undefined,
      uploadedImages: Array.isArray(uploadedImages)
        ? uploadedImages
        : undefined,
      prompt,
      frameSize,
      aspect_ratio,
      size,
      output_format,
      style,
      model,
      isPublic,
    };

    // Service call
    const result = await restoreOldPhoto(uid, requestPayload);

    // Credit deduction logic
    const CREDIT_COST = 100;
    const ctx: any = { creditCost: CREDIT_COST };

    await postSuccessDebit(uid, result, ctx, "replicate", "restore-old-photo");

    const responseData = {
      images: result.images, // Array from service
      historyId: result.historyId,
      model: result.model,
      status: "completed",
    };

    res.json({
      responseStatus: "success",
      message: "OK",
      data: responseData,
    });
  } catch (error) {
    next(error);
  }
}
