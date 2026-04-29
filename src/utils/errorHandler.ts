export class ApiError extends Error {
  statusCode: number;
  code?: string;
  data?: any;

  constructor(message: string, statusCode = 500, data?: any, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.data = data;
    this.code = code;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

// Express error-handling middleware
import { Request, Response, NextFunction } from "express";

export type ApiErrorPayload = {
  message: string;
  code?: string;
  status?: number;
};

export function normalizeApiError(
  err: any,
  fallbackMessage = "Internal Server Error",
): { status: number; payload: ApiErrorPayload } {
  const status =
    (typeof err?.statusCode === "number" && err.statusCode) ||
    (typeof err?.status === "number" && err.status) ||
    (typeof err?.response?.status === "number" && err.response.status) ||
    500;

  const message =
    err?.response?.data?.message ||
    err?.message ||
    fallbackMessage;
  const code =
    err?.response?.data?.code ||
    err?.code ||
    undefined;

  return {
    status,
    payload: {
      message,
      ...(typeof code === "string" && code ? { code } : {}),
      status,
    },
  };
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { status, payload } = normalizeApiError(err);
  try {
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  } catch {}
  res.status(status).json(payload);
}
