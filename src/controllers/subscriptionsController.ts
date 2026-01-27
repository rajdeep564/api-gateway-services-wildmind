import { Request, Response } from "express";
import axios from "axios";
import "../types/http";

const CREDIT_SERVICE_URL =
  process.env.CREDIT_SERVICE_URL || "http://credit-service:3000";

/**
 * Proxy requests to credit-service subscriptions endpoints
 */

// Create subscription
export const createSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { planCode, billingDetails } = req.body;

    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/subscriptions/create`,
      {
        userId,
        planCode,
        ...billingDetails,
      }
    );

    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Create subscription error:", error.response?.data || error.message);
      res
        .status(error.response?.status || 500)
        .json(error.response?.data || { error: "Failed to create subscription" });
    } else {
      console.error("Create subscription error:", error);
      res.status(500).json({ error: "Failed to create subscription" });
    }
  }
};

// Get current subscription
export const getCurrentSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const response = await axios.get(
      `${CREDIT_SERVICE_URL}/subscriptions/me/${userId}`
    );

    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 404) {
        return res.json({ success: true, data: null });
      }
      
      console.error("Get subscription error:", error.response?.data || error.message);
      res
        .status(error.response?.status || 500)
        .json(error.response?.data || { error: "Failed to get subscription" });
    } else {
      console.error("Get subscription error:", error);
      res.status(500).json({ error: "Failed to get subscription" });
    }
  }
};

// Cancel subscription
export const cancelSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { immediate = false } = req.body;

    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/subscriptions/cancel`,
      {
        userId,
        immediate,
      }
    );

    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Cancel subscription error:", error.response?.data || error.message);
      res
        .status(error.response?.status || 500)
        .json(error.response?.data || { error: "Failed to cancel subscription" });
    } else {
      console.error("Cancel subscription error:", error);
      res.status(500).json({ error: "Failed to cancel subscription" });
    }
  }
};

// Change plan
export const changePlan = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { newPlanCode, immediate = true } = req.body;

    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/subscriptions/change-plan`,
      {
        userId,
        newPlanCode,
        immediate,
      }
    );

    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Change plan error:", error.response?.data || error.message);
      res
        .status(error.response?.status || 500)
        .json(error.response?.data || { error: "Failed to change plan" });
    } else {
      console.error("Change plan error:", error);
      res.status(500).json({ error: "Failed to change plan" });
    }
  }
};

// Verify payment (optional - if using embedded modal instead of redirect)
export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const userId = req.uid;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { razorpayPaymentId, razorpaySubscriptionId, razorpaySignature } =
      req.body;

    const response = await axios.post(
      `${CREDIT_SERVICE_URL}/subscriptions/verify`,
      {
        razorpayPaymentId,
        razorpaySubscriptionId,
        razorpaySignature,
      }
    );

    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Verify payment error:", error.response?.data || error.message);
      res
        .status(error.response?.status || 500)
        .json(error.response?.data || { error: "Failed to verify payment" });
    } else {
      console.error("Verify payment error:", error);
      res.status(500).json({ error: "Failed to verify payment" });
    }
  }
};
