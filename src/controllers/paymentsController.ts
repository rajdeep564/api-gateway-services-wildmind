import { Request, Response } from "express";
import axios from "axios";
import "../types/http";
import { normalizeApiError } from "../utils/errorHandler";

const CREDIT_SERVICE_URL =
  process.env.CREDIT_SERVICE_URL || "http://credit-service:3000";

function creditServiceAuthHeaders(
  req: Request,
): Record<string, string> | undefined {
  if (req.verifiedAuthToken) {
    return { Authorization: `Bearer ${req.verifiedAuthToken}` };
  }
  const auth = req.headers.authorization;
  if (!auth) return undefined;
  return { Authorization: auth };
}

export const listCreditPacks = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized", code: "UNAUTHORIZED", status: 401 });
    }

    const response = await axios.get(
      `${CREDIT_SERVICE_URL}/payments/packs/${userId}`,
      { headers: creditServiceAuthHeaders(req) },
    );
    return res.json(response.data);
  } catch (error: any) {
    const { status, payload } = normalizeApiError(error, "Failed to list packs");
    return res.status(status).json(payload);
  }
};

export const createCreditOrder = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized", code: "UNAUTHORIZED", status: 401 });
    }
    const { packCode } = req.body as { packCode?: string };
    if (!packCode) {
      return res
        .status(400)
        .json({ message: "packCode is required", code: "BAD_REQUEST", status: 400 });
    }
    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/payments/create-order`,
      { userId, packCode },
      { headers: creditServiceAuthHeaders(req) },
    );
    return res.json(response.data);
  } catch (error: any) {
    const { status, payload } = normalizeApiError(
      error,
      "Failed to create order",
    );
    return res.status(status).json(payload);
  }
};

export const verifyCreditOrder = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized", code: "UNAUTHORIZED", status: 401 });
    }
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
    };

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        message: "Missing Razorpay payment fields",
        code: "BAD_REQUEST",
        status: 400,
      });
    }

    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/payments/verify`,
      {
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        userId,
      },
      { headers: creditServiceAuthHeaders(req) },
    );
    return res.json(response.data);
  } catch (error: any) {
    const { status, payload } = normalizeApiError(
      error,
      "Failed to verify payment",
    );
    return res.status(status).json(payload);
  }
};
