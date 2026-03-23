/**
 * WildMind AI Orchestrator — Route File
 *
 * Mounts at: /api/orchestrator
 *
 * POST /api/orchestrator/plan             → Preview plan (saves to planStore, awaiting_approval)
 * POST /api/orchestrator/approve/:planId  → Approve plan (security check → enqueue BullMQ)
 * POST /api/orchestrator/generate         → Legacy: direct generation
 * GET  /api/orchestrator/status/:jobId    → Poll job status
 */

import { Router } from "express";
import { requireAuth } from "../middlewares/authMiddleware";
import { userOrchestratorLimiter } from "../middlewares/rateLimiter";
import * as orchestratorController from "../controllers/orchestratorController";

const router = Router();

router.use(requireAuth);
// Per-user rate limit for plan and approve (keys by req.uid); GET status skipped
router.use(userOrchestratorLimiter);

/** POST /api/orchestrator/plan — generates plan, saves to planStore, returns planId */
router.post("/plan", orchestratorController.previewPlan);

/**
 * POST /api/orchestrator/approve/:planId
 * User approves reviewed plan. Security: ownership check + plan expiry.
 * Body (optional): { modelOverrides: Record<stepId, modelId> }
 * Response: 202 { jobId }
 */
router.post("/approve/:planId", orchestratorController.approvePlan);

/** POST /api/orchestrator/generate — legacy direct submission */
router.post("/generate", orchestratorController.submitGeneration);

/** GET /api/orchestrator/status/:jobId — poll running job */
router.get("/status/:jobId", orchestratorController.getGenerationStatus);

export default router;

