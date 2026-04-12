/**
 * Routes Layer - Central Export
 * All route modules should be exported from here for consistent imports
 */

import { Router } from "express";
import bflRoutes from "./bfl";
import falRoutes from "./fal";
import minimaxRoutes from "./minimax";
import runwayRoutes from "./runway";
import authRoutes from "./authRoutes";
import creditsRoutes from "./credits";
import generationsRoutes from "./generations";
import publicGenerationsRoutes from "./publicGenerations";
import engagementRoutes from "./engagement";
import redeemCodeRoutes from "./redeemCodes";
import proxyRoutes from "./proxy";
import stickerRoutes from "./stickers";
import replicateRoutes from "./replicate";
import canvasRoutes from "./canvas";
import promptEnhancerRoutes from "./promptEnhancer";
import replaceRoutes from "./replace";
import reimagineRoutes from "./reimagine";
import libraryRoutes from "./library";
import uploadsRoutes from "./uploads";
import wildmindRoutes from "./wildmind";
import wildmindImageRoutes from "./wildmindimage";
import chatCompanionRoutes from "./chatCompanion";
import chatAssistantRoutes from "./chatAssistant";
import chatAssistantModelsRoutes from "./chatAssistantModels";
import chatAssistantThreadsRoutes from "./chatAssistantThreads";
import chatAssistantUploadsRoutes from "./chatAssistantUploads";
import subscriptionsRoutes from "./subscriptions";
import webhooksRoutes from "./webhooks";
import workflowsRoutes from "./workflows";
import billingRoutes from "./billing";
import plansRoutes from "./plans";
import fxRoutes from "./fx";
import { contentModerationMiddleware } from "../middlewares/contentModeration";
import { moderationGuard } from "../middlewares/moderationGuard";

const router = Router();

router.use("/auth", authRoutes);

// Moderation guard — enforces admin-panel bans, suspensions, IP blocks, and device blocks.
// Applied globally to all non-auth routes. No-ops when req.uid is not set (unauthenticated).
// requireAuth sets req.uid per-route BEFORE this runs for its specific request.
router.use(
  [
    "/bfl",
    "/fal",
    "/minimax",
    "/runway",
    "/generations",
    "/library",
    "/uploads",
    "/credits",
    "/feed",
    "/engagement",
    "/redeem-codes",
    "/proxy",
    "/stickers",
    "/replicate",
    "/canvas",
    "/prompt-enhancer",
    "/replace",
    "/reimagine",
    "/wildmind",
    "/wildmindimage",
    "/chat",
    "/subscriptions",
    "/plans",
    "/webhooks",
    "/workflows",
    "/billing",
  ],
  moderationGuard,
);

router.use(
  [
    "/bfl",
    "/fal",
    "/minimax",
    "/runway",
    "/replicate",
    "/prompt-enhancer",
    "/replace",
    "/reimagine",
    "/wildmind",
    "/wildmindimage",
  ],
  contentModerationMiddleware,
);
router.use("/bfl", bflRoutes);
router.use("/fal", falRoutes);
router.use("/minimax", minimaxRoutes);
router.use("/runway", runwayRoutes);
router.use("/generations", generationsRoutes);
router.use("/library", libraryRoutes);
router.use("/uploads", uploadsRoutes);
router.use("/credits", creditsRoutes);
router.use("/feed", publicGenerationsRoutes);
router.use("/engagement", engagementRoutes);
router.use("/redeem-codes", redeemCodeRoutes);
router.use("/proxy", proxyRoutes);
router.use("/stickers", stickerRoutes);
router.use("/replicate", replicateRoutes);
router.use("/canvas", canvasRoutes);
router.use("/prompt-enhancer", promptEnhancerRoutes);
router.use("/replace", replaceRoutes);
router.use("/reimagine", reimagineRoutes);
router.use("/wildmind", wildmindRoutes);
router.use("/wildmindimage", wildmindImageRoutes);
router.use("/chat", chatCompanionRoutes);
router.use("/chat/assistant", chatAssistantRoutes);
router.use("/chat/assistant/models", chatAssistantModelsRoutes);
router.use("/chat/assistant/threads", chatAssistantThreadsRoutes);
router.use("/chat/assistant/attachments", chatAssistantUploadsRoutes);
router.use("/subscriptions", subscriptionsRoutes);
router.use("/plans", plansRoutes);
router.use("/webhooks", webhooksRoutes);
router.use("/workflows", workflowsRoutes);
router.use("/billing", billingRoutes);
router.use("/fx", fxRoutes);

export default router;
