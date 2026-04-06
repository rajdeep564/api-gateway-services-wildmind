import { Request, Response, NextFunction } from "express";
import { ApiError } from "../../../utils/errorHandler";
import { postSuccessDebit } from "../../../utils/creditDebit";
import {
  lineDrawingToPhoto,
  LineDrawingToPhotoRequest,
} from "../../../services/workflows/general/lineDrawingToPhotoService";

export async function lineDrawingToPhotoController(
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

    const requestPayload: LineDrawingToPhotoRequest = {
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
    const result = await lineDrawingToPhoto(uid, requestPayload);

    // Credit deduction logic (80 credits)
    const CREDIT_COST = 90;
    const ctx: any = { creditCost: CREDIT_COST };

    await postSuccessDebit(
      uid,
      result,
      ctx,
      "replicate",
      "line-drawing-to-photo",
    );

    const responseData = {
      images: result.images,
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
