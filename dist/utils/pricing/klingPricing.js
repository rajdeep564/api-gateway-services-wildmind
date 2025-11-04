"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KLING_PRICING_VERSION = void 0;
exports.computeKlingVideoCost = computeKlingVideoCost;
exports.computeKlingCostFromSku = computeKlingCostFromSku;
const creditDistribution_1 = require("../../data/creditDistribution");
exports.KLING_PRICING_VERSION = 'kling-v1';
function findCreditsExact(name) {
    const row = creditDistribution_1.creditDistributionData.find(m => m.modelName.toLowerCase() === name.toLowerCase());
    return row?.creditsPerGeneration ?? null;
}
function normalizeDuration(d) {
    if (d == null)
        return '';
    const s = String(d).trim().toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? `${m[1]}s` : '';
}
function normalizeResolution(r) {
    if (r == null)
        return '';
    const s = String(r).trim().toLowerCase();
    if (s.includes('1080'))
        return '1080p';
    if (s.includes('720'))
        return '720p';
    return '';
}
function resolveKind(body) {
    const raw = (body.kind || body.type || body.mode || '').toString().trim().toLowerCase();
    if (raw === 't2v' || raw === 'text-to-video' || raw === 'text_to_video' || raw === 'text2video')
        return 't2v';
    if (raw === 'i2v' || raw === 'image-to-video' || raw === 'image_to_video' || raw === 'img2video' || raw === 'image2video')
        return 'i2v';
    // Fallback: infer from presence of image/start_image
    if (body.image || body.start_image)
        return 'i2v';
    if (body.prompt)
        return 't2v';
    return '';
}
async function computeKlingVideoCost(req) {
    const b = (req.body || {});
    const model = (b.model || '').toString().toLowerCase();
    const kind = resolveKind(b);
    if (!kind)
        throw new Error('Kling pricing: mode is required and must be one of t2v|i2v');
    const dur = normalizeDuration(b.duration) || '5s';
    const meta = { duration: dur, kind };
    let sku = '';
    if (model.includes('kling-v2.5-turbo-pro')) {
        sku = `Kling 2.5 Turbo Pro ${kind.toUpperCase()} ${dur}`;
        meta.family = 'kling-2.5-turbo-pro';
    }
    else if (model.includes('kling-v2.1-master')) {
        sku = `Kling 2.1 Master ${kind.toUpperCase()} ${dur}`;
        meta.family = 'kling-2.1-master';
    }
    else if (model.includes('kling-v2.1')) {
        // v2.1 base: resolution determined by mode standard/pro or explicit resolution
        const res = (() => {
            const tier = (b.kling_mode || b.video_mode || b.video_tier || b.quality || b.resolution || b.mode || '').toString().toLowerCase();
            if (tier === 'pro' || tier.includes('1080'))
                return '1080p';
            if (tier === 'standard' || tier.includes('720'))
                return '720p';
            const r2 = normalizeResolution(b.resolution);
            return (r2 || '720p');
        })();
        sku = `Kling 2.1 ${kind.toUpperCase()} ${dur} ${res}`;
        meta.family = 'kling-2.1';
        meta.resolution = res;
    }
    else {
        // Default to 2.5 Turbo Pro if model not specified
        sku = `Kling 2.5 Turbo Pro ${kind.toUpperCase()} ${dur}`;
        meta.family = 'kling-2.5-turbo-pro';
    }
    const credits = findCreditsExact(sku);
    if (credits == null) {
        throw new Error(`Unsupported Kling pricing for "${sku}". Please add this SKU to creditDistribution.`);
    }
    return { cost: Math.ceil(credits), pricingVersion: exports.KLING_PRICING_VERSION, meta };
}
function computeKlingCostFromSku(sku) {
    const credits = findCreditsExact(sku);
    if (credits == null)
        throw new Error('Unsupported Kling SKU');
    return { cost: Math.ceil(credits), pricingVersion: exports.KLING_PRICING_VERSION, meta: { model: sku } };
}
