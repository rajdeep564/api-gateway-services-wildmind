"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PIXVERSE_PRICING_VERSION = void 0;
exports.computePixverseVideoCost = computePixverseVideoCost;
exports.computePixverseCostFromSku = computePixverseCostFromSku;
const creditDistribution_1 = require("../../data/creditDistribution");
exports.PIXVERSE_PRICING_VERSION = 'pixverse-v1';
function normDuration(d) {
    if (d == null)
        return '';
    const s = String(d).trim().toLowerCase();
    const m = s.match(/(5|8)/);
    return m ? (m[1] + 's') : '';
}
function normQuality(q) {
    if (!q)
        return '';
    const s = String(q).trim().toLowerCase();
    const m = s.match(/(360|540|720|1080)/);
    return m ? (m[1] + 'p') : '';
}
function findCreditsExact(name) {
    const row = creditDistribution_1.creditDistributionData.find(m => m.modelName.toLowerCase() === name.toLowerCase());
    return row?.creditsPerGeneration ?? null;
}
function resolveDisplay(kind, duration, qualityOrResolution) {
    const d = normDuration(duration);
    const q = normQuality(qualityOrResolution);
    const parts = ['PixVerse 5', kind.toUpperCase(), d, q].filter(Boolean);
    return parts.join(' ').trim();
}
async function computePixverseVideoCost(req) {
    const { mode, kind, type, duration, quality, resolution } = (req.body || {});
    const raw = String(mode || kind || type || '').toLowerCase();
    const selected = raw === 'i2v' ? 'i2v' : (raw === 't2v' || raw.length === 0 ? 't2v' : '');
    if (!selected)
        throw new Error('PixVerse pricing: mode must be one of t2v|i2v');
    const disp = resolveDisplay(selected, duration, quality || resolution);
    const base = findCreditsExact(disp);
    if (base == null) {
        throw new Error(`Unsupported PixVerse pricing for "${disp}". Please add the SKU to creditDistribution.`);
    }
    const dur = normDuration(duration);
    const qual = normQuality(quality || resolution);
    return { cost: Math.ceil(base), pricingVersion: exports.PIXVERSE_PRICING_VERSION, meta: { model: disp, duration: dur || undefined, resolution: qual || undefined } };
}
function computePixverseCostFromSku(sku) {
    const base = findCreditsExact(sku);
    if (base == null)
        throw new Error('Unsupported PixVerse SKU');
    return { cost: Math.ceil(base), pricingVersion: exports.PIXVERSE_PRICING_VERSION, meta: { model: sku } };
}
