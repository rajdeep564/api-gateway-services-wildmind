"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FAL_PRICING_VERSION = void 0;
exports.computeFalImageCost = computeFalImageCost;
exports.computeFalVeoTtvSubmitCost = computeFalVeoTtvSubmitCost;
exports.computeFalVeoI2vSubmitCost = computeFalVeoI2vSubmitCost;
exports.computeFalVeoCostFromModel = computeFalVeoCostFromModel;
const creditDistribution_1 = require("../../data/creditDistribution");
exports.FAL_PRICING_VERSION = 'fal-v1';
function findCredits(modelName) {
    const row = creditDistribution_1.creditDistributionData.find(m => m.modelName.toLowerCase() === modelName.toLowerCase());
    return row?.creditsPerGeneration ?? null;
}
async function computeFalImageCost(req) {
    const { uploadedImages = [], n = 1, model } = req.body || {};
    // Prefer explicit Imagen 4 variants if selected by client; fallback to Google Nano Banana rows
    let display = null;
    const m = (model || '').toLowerCase();
    if (m.includes('imagen-4')) {
        if (m.includes('ultra'))
            display = 'Imagen 4 Ultra';
        else if (m.includes('fast'))
            display = 'Imagen 4 Fast';
        else
            display = 'Imagen 4';
    }
    else {
        // Map Gemini image to our Google rows (choose I2I when uploadedImages provided)
        display = Array.isArray(uploadedImages) && uploadedImages.length > 0
            ? 'Google nano banana (I2I)'
            : 'Google nano banana (T2I)';
    }
    const base = display ? findCredits(display) : null;
    if (base == null)
        throw new Error('Unsupported FAL image model');
    const count = Math.max(1, Math.min(10, Number(n)));
    const cost = Math.ceil(base * count);
    return { cost, pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, n: count } };
}
function resolveVeoDisplay(isFast, kind, duration) {
    const dur = (duration || '8s').toLowerCase();
    if (isFast) {
        if (kind === 't2v') {
            if (dur.startsWith('4'))
                return 'veo3 fast t2v 4s';
            if (dur.startsWith('6'))
                return 'veo3 fast t2v 6s';
            return 'veo3 fast t2v 8s';
        }
        return 'veo3 fast i2v 8s';
    }
    else {
        if (kind === 't2v') {
            if (dur.startsWith('4'))
                return 'veo3 t2v 4s';
            if (dur.startsWith('6'))
                return 'veo3 t2v 6s';
            return 'veo3 t2v 8s';
        }
        return 'veo3 i2v 8s';
    }
}
async function computeFalVeoTtvSubmitCost(req, isFast) {
    const { duration } = req.body || {};
    const display = resolveVeoDisplay(isFast, 't2v', duration);
    const base = findCredits(display);
    if (base == null)
        throw new Error('Unsupported FAL Veo T2V pricing');
    return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, duration: duration || '8s' } };
}
async function computeFalVeoI2vSubmitCost(req, isFast) {
    const { duration } = req.body || {};
    const display = resolveVeoDisplay(isFast, 'i2v', duration);
    const base = findCredits(display);
    if (base == null)
        throw new Error('Unsupported FAL Veo I2V pricing');
    return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, duration: duration || '8s' } };
}
function computeFalVeoCostFromModel(model) {
    // Default to 8s variants based on model path
    const normalized = model.toLowerCase();
    let display = '';
    if (normalized === 'fal-ai/veo3')
        display = 'veo3 t2v 8s';
    else if (normalized === 'fal-ai/veo3/fast')
        display = 'veo3 fast t2v 8s';
    else if (normalized === 'fal-ai/veo3/image-to-video')
        display = 'veo3 i2v 8s';
    else if (normalized === 'fal-ai/veo3/fast/image-to-video')
        display = 'veo3 fast i2v 8s';
    const base = display ? findCredits(display) : null;
    if (base == null)
        throw new Error('Unsupported FAL Veo model');
    return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, duration: '8s' } };
}
