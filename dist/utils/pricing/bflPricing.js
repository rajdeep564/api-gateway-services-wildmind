"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeBflCost = computeBflCost;
exports.computeBflFillCost = computeBflFillCost;
exports.computeBflExpandCost = computeBflExpandCost;
exports.computeBflCannyCost = computeBflCannyCost;
exports.computeBflDepthCost = computeBflDepthCost;
exports.computeBflExpandWithFillCost = computeBflExpandWithFillCost;
const creditDistribution_1 = require("../../data/creditDistribution");
const bflutils_1 = require("../bflutils");
async function computeBflCost(req) {
    const { model, n = 1, frameSize, width, height, output_format } = req.body || {};
    const basePerImage = bflutils_1.bflutils.getCreditsPerImage(model);
    if (basePerImage == null) {
        throw new Error('Unsupported model');
    }
    const count = Math.max(1, Math.min(10, Number(n)));
    // Charge based solely on model and count
    const cost = Math.ceil(basePerImage * count);
    const meta = { model, n: count, frameSize, width, height, output_format };
    return { cost, pricingVersion: creditDistribution_1.PRICING_VERSION, meta };
}
async function computeBflFillCost(req) {
    const basePerImage = bflutils_1.bflutils.getCreditsPerImage('flux-pro-1.0-fill');
    if (basePerImage == null)
        throw new Error('Unsupported model');
    const cost = Math.ceil(basePerImage * 1);
    return { cost, pricingVersion: creditDistribution_1.PRICING_VERSION, meta: { model: 'flux-pro-1.0-fill', n: 1 } };
}
async function computeBflExpandCost(req) {
    const basePerImage = bflutils_1.bflutils.getCreditsPerImage('flux-pro-1.0-expand');
    if (basePerImage == null)
        throw new Error('Unsupported model');
    const cost = Math.ceil(basePerImage * 1);
    return { cost, pricingVersion: creditDistribution_1.PRICING_VERSION, meta: { model: 'flux-pro-1.0-expand', n: 1 } };
}
async function computeBflCannyCost(req) {
    const basePerImage = bflutils_1.bflutils.getCreditsPerImage('flux-pro-1.0-canny');
    if (basePerImage == null)
        throw new Error('Unsupported model');
    const cost = Math.ceil(basePerImage * 1);
    return { cost, pricingVersion: creditDistribution_1.PRICING_VERSION, meta: { model: 'flux-pro-1.0-canny', n: 1 } };
}
async function computeBflDepthCost(req) {
    const basePerImage = bflutils_1.bflutils.getCreditsPerImage('flux-pro-1.0-depth');
    if (basePerImage == null)
        throw new Error('Unsupported model');
    const cost = Math.ceil(basePerImage * 1);
    return { cost, pricingVersion: creditDistribution_1.PRICING_VERSION, meta: { model: 'flux-pro-1.0-depth', n: 1 } };
}
async function computeBflExpandWithFillCost(req) {
    const basePerImage = bflutils_1.bflutils.getCreditsPerImage('flux-pro-1.0-fill');
    if (basePerImage == null)
        throw new Error('Unsupported model');
    const cost = Math.ceil(basePerImage * 1);
    return { cost, pricingVersion: creditDistribution_1.PRICING_VERSION, meta: { model: 'flux-pro-1.0-fill', n: 1 } };
}
