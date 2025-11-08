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
const COST_BRIA_ERASER = 100; // Per sheet: user cost $0.05 -> 100 credits
const COST_CLARITY_UPSCALER = 62;
const COST_REAL_ESRGAN = 32.4;
const COST_SWIN2SR = 43;
// Crystal Upscaler per-resolution costs (credits)
const COST_CRYSTAL_1080P = 220;
const COST_CRYSTAL_1440P = 420;
const COST_CRYSTAL_2160P = 820; // 4K/2160p
const COST_CRYSTAL_6K = 1620;
const COST_CRYSTAL_8K = 3220;
const COST_CRYSTAL_12K = 6420;
const COST_SEEDREAM4 = 90;
const COST_IDEOGRAM_V3_TURBO = 90;
const COST_MAGIC_IMAGE_REFINER = 84;
const COST_IDEOGRAM_3_QUALITY = 210;
const COST_LUCID_ORIGIN = 183;
const COST_PHOENIX_1_0 = 180;
async function computeReplicateBgRemoveCost(req) {
    const { model } = req.body || {};
    const normalized = String(model || '').toLowerCase();
    let cost = COST_REMOVE_BG;
    if (normalized.includes('bria/eraser'))
        cost = COST_BRIA_ERASER;
    else if (normalized.includes('851-labs/background-remover'))
        cost = COST_BACKGROUND_REMOVER;
    return { cost: Math.ceil(cost), pricingVersion: exports.REPLICATE_PRICING_VERSION, meta: { model: normalized } };
}
async function computeReplicateUpscaleCost(req) {
    const { model } = req.body || {};
    const normalized = String(model || '').toLowerCase();
    let cost;
    // Crystal Upscaler has resolution-based pricing
    if (normalized.includes('crystal')) {
        const resRaw = String(req.body?.resolution || '').toLowerCase();
        // Normalize a few common forms (e.g., 1920x1080 -> 1080p)
        const res = (() => {
            if (!resRaw)
                return '1080p';
            if (resRaw.includes('1080'))
                return '1080p';
            if (resRaw.includes('1440'))
                return '1440p';
            if (resRaw.includes('2160') || resRaw.includes('4k'))
                return '2160p';
            if (resRaw.includes('6k'))
                return '6k';
            if (resRaw.includes('8k'))
                return '8k';
            if (resRaw.includes('12k'))
                return '12k';
            // If numeric, map by thresholds (<=1080 => 1080p, <=1440 => 1440p, etc.)
            const m = resRaw.match(/(\d{3,4})p/);
            if (m) {
                const p = Number(m[1]);
                if (p <= 1080)
                    return '1080p';
                if (p <= 1440)
                    return '1440p';
                if (p <= 2160)
                    return '2160p';
            }
            return '1080p';
        })();
        switch (res) {
            case '1080p':
                cost = COST_CRYSTAL_1080P;
                break;
            case '1440p':
                cost = COST_CRYSTAL_1440P;
                break;
            case '2160p':
                cost = COST_CRYSTAL_2160P;
                break;
            case '6k':
                cost = COST_CRYSTAL_6K;
                break;
            case '8k':
                cost = COST_CRYSTAL_8K;
                break;
            case '12k':
                cost = COST_CRYSTAL_12K;
                break;
            default:
                cost = COST_CRYSTAL_1080P;
                break;
        }
        return { cost: Math.ceil(cost), pricingVersion: exports.REPLICATE_PRICING_VERSION, meta: { model: normalized, resolution: res } };
    }
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
    // Ideogram Turbo matches
    if (normalized.includes('ideogram-ai/ideogram-v3-turbo') ||
        (normalized.includes('ideogram') && normalized.includes('turbo'))) {
        cost = COST_IDEOGRAM_V3_TURBO;
    }
    if (normalized.includes('fermatresearch/magic-image-refiner'))
        cost = COST_MAGIC_IMAGE_REFINER;
    // Ideogram 3 Quality matches
    if (normalized.includes('ideogram-ai/ideogram-v3-quality') ||
        normalized.includes('ideogram 3 quality') ||
        normalized.includes('ideogram-3-quality') ||
        (normalized.includes('ideogram') && normalized.includes('quality'))) {
        cost = COST_IDEOGRAM_3_QUALITY;
    }
    if (normalized.includes('leonardoai/lucid-origin') || normalized.includes('lucid origin') || normalized.includes('lucid-origin'))
        cost = COST_LUCID_ORIGIN;
    if (normalized.includes('phoenix 1.0') || normalized.includes('phoenix-1.0'))
        cost = COST_PHOENIX_1_0;
    return { cost: Math.ceil(cost), pricingVersion: exports.REPLICATE_PRICING_VERSION, meta: { model: normalized } };
}
