import { Request, Response, NextFunction } from "express";
import { ApiError } from "../../../utils/errorHandler";
import { postSuccessDebit } from "../../../utils/creditDebit";
import {
  fashionStyling,
  FashionStylistRequest,
} from "../../../services/workflows/fashion/fashionStylistService";

export async function fashionStylistController(
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
      outfitImage,
      userImage,
      backgroundDetails,
      isPublic,
      output_format,
      size,
      model,
    } = req.body || {};

    if (!outfitImage) {
      throw new ApiError("Outfit image is required", 400);
    }

    if (!userImage) {
      throw new ApiError("User photo is required", 400);
    }

    if (!backgroundDetails) {
      throw new ApiError("Background details are required", 400);
    }

    const requestPayload: FashionStylistRequest = {
      outfitImage,
      userImage,
      backgroundDetails,
      isPublic,
      output_format,
      size,
      model,
    };

    // Service call
    const result = await fashionStyling(uid, requestPayload);

    // Credit deduction (90 credits)
    const CREDIT_COST = 90;
    const ctx: any = { creditCost: CREDIT_COST };

    await postSuccessDebit(
      uid,
      result,
      ctx,
      "replicate",
      "fashion-styling",
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
