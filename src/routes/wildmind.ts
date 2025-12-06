import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import * as generateController from '../controllers/canvas/generateController';
import { falController } from '../controllers/falController';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { computeFalOutpaintCost } from '../utils/pricing/falPricing';
import { validateFalBriaExpand } from '../middlewares/validators/fal/validateFalGenerate';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * WildMind Unified Routes
 * These routes are designed to be called directly from the frontend (bypassing Next.js proxy)
 * to avoid Vercel timeouts on long-running operations.
 */

// Erase: Uses existing canvas logic
// Payload must match expected structure: { image, mask?, prompt?, meta: { source: 'canvas', projectId } }
router.post('/erase', generateController.eraseForCanvas);

// Replace: Uses existing canvas logic
// Payload must match: { image, mask?, prompt (required), meta: { source: 'canvas', projectId } }
router.post('/replace', generateController.replaceForCanvas);

// Expand: Uses Fal Bria logic (previously /api/fal/bria/expand)
// Validates checks and credit costing included
router.post(
    '/expand',
    validateFalBriaExpand,
    makeCreditCost("fal", "bria_expand", (req) => computeFalOutpaintCost(req)),
    falController.briaExpandImage
);

export default router;
