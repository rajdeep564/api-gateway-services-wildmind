"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MINIMAX_PRICING_VERSION = void 0;
exports.computeMinimaxImageCost = computeMinimaxImageCost;
exports.computeMinimaxMusicCost = computeMinimaxMusicCost;
exports.computeMinimaxVideoCost = computeMinimaxVideoCost;
exports.computeMinimaxVideoCostFromParams = computeMinimaxVideoCostFromParams;
const creditDistribution_1 = require("../../data/creditDistribution");
exports.MINIMAX_PRICING_VERSION = 'minimax-v1';
function findCreditsExact(name) {
    const row = creditDistribution_1.creditDistributionData.find(m => m.modelName.toLowerCase() === name.toLowerCase());
    return row?.creditsPerGeneration ?? null;
}
async function computeMinimaxImageCost(req) {
    const { n = 1 } = req.body || {};
    const base = findCreditsExact('Minimax Image-01');
    if (base == null)
        throw new Error('Unsupported Minimax image');
    const count = Math.max(1, Math.min(10, Number(n)));
    const cost = Math.ceil(base * count);
    return { cost, pricingVersion: exports.MINIMAX_PRICING_VERSION, meta: { model: 'Minimax Image-01', n: count } };
}
async function computeMinimaxMusicCost(_req) {
    const base = findCreditsExact('Music 1.5 (Up to 90s)');
    if (base == null)
        throw new Error('Unsupported Minimax music');
    return { cost: Math.ceil(base), pricingVersion: exports.MINIMAX_PRICING_VERSION, meta: { model: 'Music 1.5 (Up to 90s)' } };
}
async function computeMinimaxVideoCost(req) {
    const { model, duration, resolution } = req.body || {};
    let display = '';
    if (model === 'MiniMax-Hailuo-02') {
        const dur = String(duration || '').trim();
        const res = String(resolution || '').toUpperCase();
        if (res === '512P' && dur === '6')
            display = 'Minimax-Hailuo-02 512P 6s';
        else if (res === '512P' && dur === '10')
            display = 'Minimax-Hailuo-02 512P 10s';
        else if (res === '768P' && dur === '6')
            display = 'Minimax-Hailuo-02 768P 6s';
        else if (res === '768P' && dur === '10')
            display = 'Minimax-Hailuo-02 768P 10s';
        else if (res === '1080P' && dur === '6')
            display = 'Minimax-Hailuo-02 1080P 6s';
    }
    else if (model === 'T2V-01-Director') {
        display = 'T2V-01-Director';
    }
    else if (model === 'I2V-01-Director') {
        display = 'I2V-01-Director';
    }
    else if (model === 'S2V-01') {
        display = 'S2V-01';
    }
    const base = display ? findCreditsExact(display) : null;
    if (base == null)
        throw new Error('Unsupported Minimax video');
    return { cost: Math.ceil(base), pricingVersion: exports.MINIMAX_PRICING_VERSION, meta: { model: display, duration: duration ?? undefined, resolution: resolution ?? undefined } };
}
async function computeMinimaxVideoCostFromParams(model, duration, resolution) {
    let display = '';
    if (model === 'MiniMax-Hailuo-02') {
        const dur = String(duration || '').trim();
        const res = String(resolution || '').toUpperCase();
        if (res === '512P' && dur === '6')
            display = 'Minimax-Hailuo-02 512P 6s';
        else if (res === '512P' && dur === '10')
            display = 'Minimax-Hailuo-02 512P 10s';
        else if (res === '768P' && dur === '6')
            display = 'Minimax-Hailuo-02 768P 6s';
        else if (res === '768P' && dur === '10')
            display = 'Minimax-Hailuo-02 768P 10s';
        else if (res === '1080P' && dur === '6')
            display = 'Minimax-Hailuo-02 1080P 6s';
    }
    else if (model === 'T2V-01-Director') {
        display = 'T2V-01-Director';
    }
    else if (model === 'I2V-01-Director') {
        display = 'I2V-01-Director';
    }
    else if (model === 'S2V-01') {
        display = 'S2V-01';
    }
    const base = display ? findCreditsExact(display) : null;
    if (base == null)
        throw new Error('Unsupported Minimax video');
    return { cost: Math.ceil(base), pricingVersion: exports.MINIMAX_PRICING_VERSION, meta: { model: display, duration: duration ?? undefined, resolution: resolution ?? undefined } };
}
