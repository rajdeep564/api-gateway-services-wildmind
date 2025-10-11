"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNWAY_PRICING_VERSION = void 0;
exports.computeRunwayImageCost = computeRunwayImageCost;
exports.computeRunwayCostFromHistoryModel = computeRunwayCostFromHistoryModel;
exports.computeRunwayCostFromSku = computeRunwayCostFromSku;
exports.computeRunwayVideoCost = computeRunwayVideoCost;
const creditDistribution_1 = require("../../data/creditDistribution");
exports.RUNWAY_PRICING_VERSION = 'runway-v1';
function findCreditsExact(name) {
    const row = creditDistribution_1.creditDistributionData.find(m => m.modelName.toLowerCase() === name.toLowerCase());
    return row?.creditsPerGeneration ?? null;
}
async function computeRunwayImageCost(req) {
    const { model, sku } = req.body || {};
    let display = '';
    if (typeof sku === 'string' && sku.length > 0) {
        display = sku;
    }
    else {
        if (model === 'gen4_image')
            display = 'Runway Gen 4 Image 720p';
        else if (model === 'gen4_image_turbo')
            display = 'Runway Gen 4 Image Turbo';
    }
    const base = display ? findCreditsExact(display) : null;
    if (base == null)
        throw new Error('Unsupported Runway image model');
    const cost = Math.ceil(base * 1);
    return { cost, pricingVersion: exports.RUNWAY_PRICING_VERSION, meta: { model: display } };
}
function computeRunwayCostFromHistoryModel(historyModel) {
    let display = '';
    if (historyModel === 'gen4_image')
        display = 'Runway Gen 4 Image 720p';
    else if (historyModel === 'gen4_image_turbo')
        display = 'Runway Gen 4 Image Turbo';
    const base = display ? findCreditsExact(display) : null;
    if (base == null)
        throw new Error('Unsupported Runway image history model');
    return { cost: Math.ceil(base), pricingVersion: exports.RUNWAY_PRICING_VERSION, meta: { model: display } };
}
function computeRunwayCostFromSku(sku) {
    const base = findCreditsExact(sku);
    if (base == null)
        throw new Error('Unsupported Runway SKU');
    return { cost: Math.ceil(base), pricingVersion: exports.RUNWAY_PRICING_VERSION, meta: { model: sku } };
}
async function computeRunwayVideoCost(req) {
    const { sku } = req.body || {};
    if (typeof sku !== 'string' || sku.length === 0)
        throw new Error('sku is required for Runway video pricing');
    return computeRunwayCostFromSku(sku);
}
