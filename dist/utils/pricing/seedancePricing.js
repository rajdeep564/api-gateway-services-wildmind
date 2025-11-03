"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEEDANCE_PRICING_VERSION = void 0;
exports.computeSeedanceVideoCost = computeSeedanceVideoCost;
exports.computeSeedanceCostFromSku = computeSeedanceCostFromSku;
const creditDistribution_1 = require("../../data/creditDistribution");
exports.SEEDANCE_PRICING_VERSION = 'seedance-v1';
function normalizeDuration(d) {
    if (d == null)
        return undefined;
    const s = String(d).toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : undefined;
}
function normalizeResolution(r) {
    if (!r)
        return undefined;
    const s = String(r).toLowerCase();
    if (s.includes('480'))
        return '480p';
    if (s.includes('720'))
        return '720p';
    if (s.includes('1080'))
        return '1080p';
    return undefined;
}
async function computeSeedanceVideoCost(req) {
    const { model, mode, kind, duration, resolution } = (req.body || {});
    const selectedMode = (String(kind || mode || '').toLowerCase() === 'i2v') ? 'i2v' : 't2v';
    const dur = normalizeDuration(duration);
    const res = normalizeResolution(resolution);
    const modelStr = String(model || '').toLowerCase();
    const tier = modelStr.includes('lite') ? 'Lite' : 'Pro';
    if (!dur || !res) {
        throw new Error('Seedance pricing: duration and resolution are required');
    }
    const display = `Seedance 1.0 ${tier} ${selectedMode.toUpperCase()} ${dur}s ${res}`;
    const row = creditDistribution_1.creditDistributionData.find(m => m.modelName === display);
    if (!row) {
        throw new Error(`Unsupported Seedance pricing for "${display}". Please add this SKU to creditDistribution.`);
    }
    return { cost: Math.ceil(row.creditsPerGeneration), pricingVersion: exports.SEEDANCE_PRICING_VERSION, meta: { model: display, duration: dur, resolution: res, tier } };
}
function computeSeedanceCostFromSku(sku) {
    const row = creditDistribution_1.creditDistributionData.find(m => m.modelName === sku);
    if (!row)
        throw new Error(`Unsupported Seedance pricing for "${sku}"`);
    return { cost: Math.ceil(row.creditsPerGeneration), pricingVersion: exports.SEEDANCE_PRICING_VERSION, meta: { model: sku } };
}
