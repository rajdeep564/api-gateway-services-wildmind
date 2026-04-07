import { Request, Response } from "express";
import axios from "axios";

const CREDIT_SERVICE_URL =
  process.env.CREDIT_SERVICE_URL || "http://credit-service:3000";

export const getSubscriptionCatalog = async (_req: Request, res: Response) => {
  try {
    const response = await axios.get(
      `${CREDIT_SERVICE_URL}/plans/subscription-catalog`,
    );
    res.json(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        "Get subscription catalog error:",
        error.response?.data || error.message,
      );
      res
        .status(error.response?.status || 500)
        .json(
          error.response?.data || {
            error: "Failed to fetch subscription catalog",
          },
        );
      return;
    }

    console.error("Get subscription catalog error:", error);
    res.status(500).json({ error: "Failed to fetch subscription catalog" });
  }
};
