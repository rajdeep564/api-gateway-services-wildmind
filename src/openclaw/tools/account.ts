/**
 * get_credit_balance — returns current user's credit balance (from context.userId only).
 * upgrade_plan — stub; points to subscription.
 */

import type { ToolRegistration } from "../types";
import { readUserCredits } from "../../repository/creditsRepository";

export const getCreditBalanceTool: ToolRegistration = {
  definition: {
    name: "get_credit_balance",
    description: "Get the current user's available credit balance for generations.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  handler: async (_args, context) => {
    const balance = await readUserCredits(context.userId);
    return { credits: balance };
  },
};

export const upgradePlanTool: ToolRegistration = {
  definition: {
    name: "upgrade_plan",
    description: "Direct the user to upgrade or manage their subscription plan.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  handler: async (_args, context) => {
    return {
      message: "You can upgrade or manage your plan in the Subscription section.",
      url: "/subscription",
      userId: context.userId,
    };
  },
};
