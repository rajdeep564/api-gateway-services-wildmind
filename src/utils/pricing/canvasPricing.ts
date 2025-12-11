
import { Request } from 'express';
import { creditDistributionData, PRICING_VERSION } from '../../data/creditDistribution';
import { mapModelToBackend } from '../../services/canvas/generateService';
import { computeFalImageCost, computeFalVeoTtvSubmitCost, computeFalVeoI2vSubmitCost, computeFalVeo31TtvSubmitCost, computeFalVeo31I2vSubmitCost, computeFalSora2I2vSubmitCost, computeFalSora2ProI2vSubmitCost, computeFalSora2T2vSubmitCost, computeFalSora2ProT2vSubmitCost, computeFalSora2RemixSubmitCost, computeFalLtxV2ProI2vSubmitCost, computeFalLtxV2FastI2vSubmitCost, computeFalLtxV2ProT2vSubmitCost, computeFalLtxV2FastT2vSubmitCost, computeFalImage2SvgCost, computeFalRecraftVectorizeCost, computeFalBriaGenfillCost, computeFalSeedVrUpscaleCost, computeFalBirefnetVideoCost, computeFalTopazUpscaleImageCost, computeFalElevenTtsCost, computeFalElevenDialogueCost, computeFalChatterboxMultilingualCost, computeFalMayaTtsCost, computeFalOutpaintCost } from './falPricing';
import { computeBflCost, computeBflFillCost, computeBflExpandCost, computeBflCannyCost, computeBflDepthCost, computeBflExpandWithFillCost } from './bflPricing';
import { computeReplicateImageGenCost, computeReplicateUpscaleCost, computeReplicateBgRemoveCost, computeReplicateNextSceneCost } from './replicatePricing';
import { computeRunwayImageCost, computeRunwayVideoCost } from './runwayPricing';
import { computeMinimaxVideoCost } from './minimaxPricing';

export async function computeCanvasGenerateCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
    const { model } = req.body || {};

    // Use shared mapping logic to get the canonical backend model and service
    const { service, backendModel } = mapModelToBackend(model || '');

    // Create a proxy request with the backend model name
    const proxyReq = {
        ...req,
        body: {
            ...req.body,
            model: backendModel
        }
    } as Request;

    if (service === 'fal') {
        return computeFalImageCost(proxyReq);
    } else if (service === 'bfl') {
        // BFL models need special handling as they might map to different cost functions
        // But currently computeBflCost handles most of them via the model parameter
        // Let's pass the mapped model to it.
        // However, computeBflCost uses bflutils.getCreditsPerImage(model) which expects frontend-ish names or canonical names.
        // Let's check bflutils. It maps specific keys.
        // It seems safe to pass the backendModel if it's one of the canonical flux names.
        return computeBflCost(proxyReq);
    } else if (service === 'replicate') {
        return computeReplicateImageGenCost(proxyReq);
    } else if (service === 'runway') {
        return computeRunwayImageCost(proxyReq);
    }

    // Fallback
    return computeFalImageCost(proxyReq);
}

export async function computeCanvasVideoCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
    // Video generation logic routing
    const { model } = req.body || {};
    // Basic routing based on model name prefix or known list
    const m = (model || '').toLowerCase();

    if (m.includes('minimax') || m.includes('hailuo')) {
        // Use Minimax
        return computeMinimaxVideoCost(req);
    } else if (m.includes('runway') || m.includes('gen3') || m.includes('act-two')) {
        return computeRunwayVideoCost(req);
    } else if (m.includes('fal') || m.includes('veo') || m.includes('ltx') || m.includes('sora')) {
        // Route to FAL video pricing functions
        // Determine specific function based on model
        const isFast = m.includes('fast');
        const isI2v = m.includes('image') || m.includes('i2v');

        if (m.includes('veo 3.1') || m.includes('veo3.1')) {
            return isI2v ? computeFalVeo31I2vSubmitCost(req, isFast) : computeFalVeo31TtvSubmitCost(req, isFast);
        } else if (m.includes('veo')) {
            return isI2v ? computeFalVeoI2vSubmitCost(req, isFast) : computeFalVeoTtvSubmitCost(req, isFast);
        } else if (m.includes('sora')) {
            if (m.includes('remix')) return computeFalSora2RemixSubmitCost(req);
            const isPro = m.includes('pro');
            if (isI2v) return isPro ? computeFalSora2ProI2vSubmitCost(req) : computeFalSora2I2vSubmitCost(req);
            return isPro ? computeFalSora2ProT2vSubmitCost(req) : computeFalSora2T2vSubmitCost(req);
        } else if (m.includes('ltx')) {
            const isPro = !m.includes('fast'); // Default to pro if not fast? Or explicitly check pro?
            // LTX logic in falPricing uses Pro/Fast variants
            // Check falPricing.ts: computeLtxCredits takes variant 'Pro' | 'Fast'
            if (isI2v) return isFast ? computeFalLtxV2FastI2vSubmitCost(req) : computeFalLtxV2ProI2vSubmitCost(req);
            return isFast ? computeFalLtxV2FastT2vSubmitCost(req) : computeFalLtxV2ProT2vSubmitCost(req);
        }
    } else if (m.includes('replicate') || m.includes('wan') || m.includes('seedance')) {
        // Basic Replicate video pricing (not heavily implemented in canvas currently? check requirements)
        // Assuming for now fallback or specific implementation. 
        // Wait, Wan and Seedance are in creditDistribution.
        // We should implement a basic lookup for them if they are accessed via canvas.
        // For now, let's assume they might be routed or handled.
        // But since `generateVideoForCanvas` handles mapVideoModelToBackend which returns service/backendModel.
        // If service is 'replicate', we might need `computeReplicateVideoCost`?
        // replicatePricing.ts doesn't have video function exported yet (only ImageGen, Upscale, BgRemove).
        // Let's rely on generic lookup if needed or throw for now if not supported.
    }

    throw new Error(`Unsupported canvas video model: ${model}`);
}

export async function computeCanvasUpscaleCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
    return computeReplicateUpscaleCost(req);
}

export async function computeCanvasRemoveBgCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
    return computeReplicateBgRemoveCost(req);
}

export async function computeCanvasVectorizeCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
    // Check if detail mode is on (Google Nano Banana + Recraft)
    const { mode } = req.body || {};

    // Base cost for Recraft Vectorize
    const recraftCost = await computeFalRecraftVectorizeCost(req);

    if (mode === 'detail') {
        // Add Google Nano Banana (T2I) cost = 98 credits
        // 98 + recraft (40) = 138
        // But let's look it up properly
        const nano = creditDistributionData.find(m => m.modelName === 'Google nano banana (T2I)');
        const nanoCost = nano?.creditsPerGeneration || 98;

        return {
            cost: recraftCost.cost + nanoCost,
            pricingVersion: PRICING_VERSION,
            meta: { ...recraftCost.meta, mode: 'detail', extraModel: 'Google nano banana (T2I)' }
        };
    }

    return recraftCost;
}

export async function computeCanvasEraseCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
    // Uses Runway Gen 4 Image Turbo (T2I)
    // Create a request-like object for runway pricing
    const proxyReq = {
        ...req,
        body: {
            ...req.body,
            model: 'gen4_image_turbo'
        }
    } as Request;
    return computeRunwayImageCost(proxyReq);
}

export async function computeCanvasReplaceCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
    // Uses Google Nano Banana (Inpainting) -> I2I pricing?
    // Credit sheet has "Google nano banana (I2I)" = 98 credits
    const nano = creditDistributionData.find(m => m.modelName === 'Google nano banana (I2I)');
    const cost = nano?.creditsPerGeneration || 98;
    return {
        cost,
        pricingVersion: PRICING_VERSION,
        meta: { model: 'Google nano banana (I2I)', mode: 'replace' }
    };
}

export async function computeCanvasScriptCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
    // Fixed cost for storyboard script generation
    const modelName = 'Storyboard Script Generation';
    const entry = creditDistributionData.find(m => m.modelName === modelName);
    const cost = entry?.creditsPerGeneration || 10; // Fallback to 10 if not found

    return {
        cost,
        pricingVersion: PRICING_VERSION,
        meta: { model: modelName }
    };
}

export async function computeCanvasNextSceneCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
    return computeReplicateNextSceneCost(req);
}
