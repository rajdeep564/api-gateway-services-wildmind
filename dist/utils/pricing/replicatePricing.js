"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPLICATE_PRICING_VERSION = void 0;
exports.computeReplicateBgRemoveCost = computeReplicateBgRemoveCost;
exports.computeReplicateUpscaleCost = computeReplicateUpscaleCost;
exports.computeReplicateImageGenCost = computeReplicateImageGenCost;
exports.REPLICATE_PRICING_VERSION = 'replicate-v1';
// Costs in credits (scaled from sheet; integerized via Math.ceil in compute)
const COST_BACKGROUND_REMOVER = 31; // credits per generation (sheet free column scaled)
const COST_REMOVE_BG = 31;
const COST_CLARITY_UPSCALER = 62;
const COST_REAL_ESRGAN = 32.4;
const COST_SWIN2SR = 43;
const COST_SEEDREAM4 = 90;
const COST_IDEOGRAM_V3_TURBO = 90;
const COST_MAGIC_IMAGE_REFINER = 84;
async function computeReplicateBgRemoveCost(req) {
    const { model } = req.body || {};
    const normalized = String(model || '').toLowerCase();
    const cost = normalized.includes('851-labs/background-remover') ? COST_BACKGROUND_REMOVER : COST_REMOVE_BG;
    return { cost: Math.ceil(cost), pricingVersion: exports.REPLICATE_PRICING_VERSION, meta: { model: normalized } };
}
async function computeReplicateUpscaleCost(req) {
    const { model } = req.body || {};
    const normalized = String(model || '').toLowerCase();
    let cost;
    if (normalized.includes('philz1337x/clarity-upscaler'))
        cost = COST_CLARITY_UPSCALER;
    else if (normalized.includes('fermatresearch/magic-image-refiner'))
        cost = COST_MAGIC_IMAGE_REFINER;
    else if (normalized.includes('nightmareai/real-esrgan'))
        cost = COST_REAL_ESRGAN;
    else if (normalized.includes('mv-lab/swin2sr'))
        cost = COST_SWIN2SR;
    else
        cost = COST_CLARITY_UPSCALER;
    return { cost: Math.ceil(cost), pricingVersion: exports.REPLICATE_PRICING_VERSION, meta: { model: normalized } };
}
async function computeReplicateImageGenCost(req) {
    const { model } = req.body || {};
    const normalized = String(model || '').toLowerCase();
    let cost = COST_SEEDREAM4;
    if (normalized.includes('ideogram-ai/ideogram-v3-turbo'))
        cost = COST_IDEOGRAM_V3_TURBO;
    if (normalized.includes('fermatresearch/magic-image-refiner'))
        cost = COST_MAGIC_IMAGE_REFINER;
    return { cost: Math.ceil(cost), pricingVersion: exports.REPLICATE_PRICING_VERSION, meta: { model: normalized } };
}
