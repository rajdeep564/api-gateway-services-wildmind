import { Request, Response, NextFunction } from "express";
import { ApiError } from "../../../utils/errorHandler";
import { postSuccessDebit } from "../../../utils/creditDebit";
import {
  deconstructOutfit,
  DeconstructOutfitRequest,
} from "../../../services/workflows/fashion/deconstructOutfitService";

export async function deconstructOutfitController(
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
      additionalNotes,
      isPublic,
      output_format,
      size,
      model,
    } = req.body || {};

    if (!image) {
      throw new ApiError("image URL or data URI is required", 400);
    }

    const requestPayload: DeconstructOutfitRequest = {
      image,
      additionalNotes,
      isPublic,
      output_format,
      size,
      model,
    };

    // Service call
    const result = await deconstructOutfit(uid, requestPayload);

    // Credit deduction (90 credits)
    const CREDIT_COST = 90;
    const ctx: any = { creditCost: CREDIT_COST };

    await postSuccessDebit(
      uid,
      result,
      ctx,
      "replicate",
      "fashion-deconstruct-outfit",
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
