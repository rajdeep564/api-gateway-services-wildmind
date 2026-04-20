import { Request, Response, NextFunction } from "express";
import { ApiError } from "../../../utils/errorHandler";
import { postSuccessDebit } from "../../../utils/creditDebit";
import {
  cadTo3d,
  CadTo3dRequest,
} from "../../../services/workflows/architecture/cadTo3dService";

export async function cadTo3dController(
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
      projectType,
      spaces,
      designTheme,
      materials,
      lighting,
      cameraAngle,
      furniture,
      renderQuality,
      isPublic,
      output_format,
      size,
      model,
    } = req.body || {};

    if (!image) {
      throw new ApiError("image URL or data URI is required", 400);
    }

    const requestPayload: CadTo3dRequest = {
      image,
      projectType,
      spaces,
      designTheme,
      materials,
      lighting,
      cameraAngle,
      furniture,
      renderQuality,
      isPublic,
      output_format,
      size,
      model,
    };

    // Service call
    const result = await cadTo3d(uid, requestPayload);

    // Credit deduction logic (90 credits)
    const CREDIT_COST = 90;
    const ctx: any = { creditCost: CREDIT_COST };

    await postSuccessDebit(
      uid,
      result,
      ctx,
      "replicate",
      "cad-to-3d",
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
