export class ApiError extends Error {
  statusCode: number;
  data?: any;

  constructor(message: string, statusCode = 500, data?: any) {
    super(message);
    this.statusCode = statusCode;
    this.data = data;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

// Express error-handling middleware
import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const status = err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  const data = err.data || null;
  try {
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  } catch {}
  res.status(status).json({
    responseStatus: "error",
    message,
    data,
  });
}
