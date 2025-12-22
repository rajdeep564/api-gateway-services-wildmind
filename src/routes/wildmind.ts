import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import * as generateController from '../controllers/canvas/generateController';
import { falController } from '../controllers/falController';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { validateFalBriaExpand } from '../middlewares/validators/fal/validateFalGenerate';
import type { Request } from 'express';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * WildMind Unified Routes
 * These routes are designed to be called directly from the frontend (bypassing Next.js proxy)
 * to avoid Vercel timeouts on long-running operations.
 */

// Shared cost calculator for erase/replace (Google Nano Banana ~98 credits)
async function computeWildmindEditCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
    const model = (req.body?.model || 'google_nano_banana') as string;
    const cost = model === 'google_nano_banana' ? 98 : 98; // keep same for now
    return {
        cost,
        pricingVersion: 'wildmind-edit-v1',
        meta: { model, operation: 'canvas-edit' },
    };
}

// Bria expand (replicate/bria/expand-image) fixed 100 credits
async function computeWildmindExpandCost(_req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
    return {
        cost: 100,
        pricingVersion: 'replicate-bria-expand-v1',
        meta: { model: 'replicate/bria/expand-image', operation: 'canvas-expand' },
    };
}

// Erase: Uses existing canvas logic
// Payload must match expected structure: { image, mask?, prompt?, meta: { source: 'canvas', projectId } }
router.post('/erase',
    makeCreditCost("wildmind", "erase", computeWildmindEditCost),
    generateController.eraseForCanvas);

// Replace: Uses existing canvas logic
// Payload must match: { image, mask?, prompt (required), meta: { source: 'canvas', projectId } }
router.post('/replace',
    makeCreditCost("wildmind", "replace", computeWildmindEditCost),
    generateController.replaceForCanvas);

// Expand: Uses Fal Bria logic (previously /api/fal/bria/expand)
// Validates checks and credit costing included
router.post(
    '/expand',
    validateFalBriaExpand,
    makeCreditCost("wildmind", "expand", computeWildmindExpandCost),
    falController.briaExpandImage
);

export default router;
