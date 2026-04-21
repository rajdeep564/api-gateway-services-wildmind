import { Request, Response, NextFunction } from "express";
import { ApiError } from "../../../utils/errorHandler";
import { postSuccessDebit } from "../../../utils/creditDebit";
import {
  rampwalk,
  RampwalkRequest,
} from "../../../services/workflows/fashion/rampwalkService";

export async function rampwalkController(
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
      rampwalkStyle,
      isPublic,
      output_format,
      size,
      model,
    } = req.body || {};

    if (!image) {
      throw new ApiError("image URL or data URI is required", 400);
    }

    if (!rampwalkStyle) {
      throw new ApiError("rampwalkStyle is required", 400);
    }

    const requestPayload: RampwalkRequest = {
      image,
      rampwalkStyle,
      isPublic,
      output_format,
      size,
      model,
    };

    // Service call
    const result = await rampwalk(uid, requestPayload);

    // Credit deduction (90 credits)
    const CREDIT_COST = 90;
    const ctx: any = { creditCost: CREDIT_COST };

    await postSuccessDebit(
      uid,
      result,
      ctx,
      "replicate",
      "fashion-rampwalk",
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
