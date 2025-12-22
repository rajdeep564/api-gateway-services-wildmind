import { Request, Response, NextFunction } from "express";

// Moderation disabled: always allow the request to proceed.
export function contentModerationMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction
) {
  return next();
}
