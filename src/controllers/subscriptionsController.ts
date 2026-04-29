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

/**
 * Proxy requests to credit-service subscriptions endpoints
 */

// Create subscription
export const createSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized", code: "UNAUTHORIZED", status: 401 });
    }

    const { planCode, billingDetails } = req.body;

    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/subscriptions/create`,
      {
        userId,
        planCode,
        billingDetails: billingDetails ?? {},
      },
      { headers: creditServiceAuthHeaders(req) },
    );

    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Create subscription error:",
      axios.isAxiosError(error) ? error.response?.data || error.message : error,
    );
    const { status, payload } = normalizeApiError(
      error,
      "Failed to create subscription",
    );
    res.status(status).json(payload);
  }
};

// Get current subscription
export const getCurrentSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized", code: "UNAUTHORIZED", status: 401 });
    }

    const response = await axios.get(
      `${CREDIT_SERVICE_URL}/subscriptions/me/${userId}`,
      { headers: creditServiceAuthHeaders(req) },
    );

    res.json(response.data);
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 404) {
        return res.json({ success: true, data: null });
      }

      // Subscription metadata should not block the generation UI.
      // Treat upstream 5xx/network issues as "no subscription" and allow the app to continue.
      if (
        !error.response ||
        (error.response.status >= 500 && error.response.status <= 599)
      ) {
        console.error(
          "Get subscription upstream unavailable:",
          error.response?.data || error.message,
        );
        return res.status(503).json({
          message: "Subscription status is temporarily unavailable",
          code: "SUBSCRIPTION_STATUS_UNAVAILABLE",
          status: 503,
        });
      }
    }
    console.error(
      "Get subscription error:",
      axios.isAxiosError(error) ? error.response?.data || error.message : error,
    );
    const { status, payload } = normalizeApiError(
      error,
      "Failed to get subscription",
    );
    res.status(status).json(payload);
  }
};

// Cancel subscription
export const cancelSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized", code: "UNAUTHORIZED", status: 401 });
    }

    const { immediate = false } = req.body;

    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/subscriptions/cancel`,
      {
        userId,
        immediate,
      },
      { headers: creditServiceAuthHeaders(req) },
    );

    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Cancel subscription error:",
      axios.isAxiosError(error) ? error.response?.data || error.message : error,
    );
    const { status, payload } = normalizeApiError(
      error,
      "Failed to cancel subscription",
    );
    res.status(status).json(payload);
  }
};

// Recover halted/past-due subscription
export const recoverSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized", code: "UNAUTHORIZED", status: 401 });
    }

    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/subscriptions/recover`,
      { userId },
      { headers: creditServiceAuthHeaders(req) },
    );

    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Recover subscription error:",
      axios.isAxiosError(error) ? error.response?.data || error.message : error,
    );
    const { status, payload } = normalizeApiError(
      error,
      "Failed to recover subscription",
    );
    res.status(status).json(payload);
  }
};

// Change plan
export const changePlan = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized", code: "UNAUTHORIZED", status: 401 });
    }

    const { newPlanCode, immediate = true } = req.body;

    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/subscriptions/change-plan`,
      {
        userId,
        newPlanCode,
        immediate,
      },
      { headers: creditServiceAuthHeaders(req) },
    );

    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Change plan error:",
      axios.isAxiosError(error) ? error.response?.data || error.message : error,
    );
    const { status, payload } = normalizeApiError(error, "Failed to change plan");
    res.status(status).json(payload);
  }
};

// Verify payment (optional - if using embedded modal instead of redirect)
export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized", code: "UNAUTHORIZED", status: 401 });
    }

    const { razorpayPaymentId, razorpaySubscriptionId, razorpaySignature } =
      req.body;

    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/subscriptions/verify`,
      {
        razorpayPaymentId,
        razorpaySubscriptionId,
        razorpaySignature,
      },
      { headers: creditServiceAuthHeaders(req) },
    );

    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Verify payment error:",
      axios.isAxiosError(error) ? error.response?.data || error.message : error,
    );
    const { status, payload } = normalizeApiError(
      error,
      "Failed to verify payment",
    );
    res.status(status).json(payload);
  }
};

export const verifyUpgradeOrder = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized", code: "UNAUTHORIZED", status: 401 });
    }

    const { razorpayPaymentId } = req.body;

    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/subscriptions/verify-upgrade-order`,
      {
        userId,
        razorpayPaymentId,
      },
      { headers: creditServiceAuthHeaders(req) },
    );

    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Verify upgrade order error:",
      axios.isAxiosError(error) ? error.response?.data || error.message : error,
    );
    const { status, payload } = normalizeApiError(
      error,
      "Failed to verify upgrade payment",
    );
    res.status(status).json(payload);
  }
};
/**
 * Check for expired subscriptions (Admin/Cron)
 */
export const checkExpiry = async (req: Request, res: Response) => {
  try {
    const adminSecret = process.env.CREDIT_SERVICE_ADMIN_SECRET;
    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/subscriptions/check-expiry`,
      {},
      {
        headers: adminSecret
          ? { Authorization: `Bearer ${adminSecret}` }
          : creditServiceAuthHeaders(req),
      },
    );

    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Check expiry error:",
      axios.isAxiosError(error) ? error.response?.data || error.message : error,
    );
    const { status, payload } = normalizeApiError(
      error,
      "Failed to check expiry",
    );
    res.status(status).json(payload);
  }
};
