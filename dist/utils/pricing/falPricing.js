"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FAL_PRICING_VERSION = void 0;
exports.computeFalImageCost = computeFalImageCost;
exports.computeFalVeoTtvSubmitCost = computeFalVeoTtvSubmitCost;
exports.computeFalVeoI2vSubmitCost = computeFalVeoI2vSubmitCost;
exports.computeFalVeo31TtvSubmitCost = computeFalVeo31TtvSubmitCost;
exports.computeFalVeo31I2vSubmitCost = computeFalVeo31I2vSubmitCost;
exports.computeFalSora2I2vSubmitCost = computeFalSora2I2vSubmitCost;
exports.computeFalSora2ProI2vSubmitCost = computeFalSora2ProI2vSubmitCost;
exports.computeFalSora2T2vSubmitCost = computeFalSora2T2vSubmitCost;
exports.computeFalSora2ProT2vSubmitCost = computeFalSora2ProT2vSubmitCost;
exports.computeFalLtxV2ProI2vSubmitCost = computeFalLtxV2ProI2vSubmitCost;
exports.computeFalLtxV2FastI2vSubmitCost = computeFalLtxV2FastI2vSubmitCost;
exports.computeFalLtxV2ProT2vSubmitCost = computeFalLtxV2ProT2vSubmitCost;
exports.computeFalLtxV2FastT2vSubmitCost = computeFalLtxV2FastT2vSubmitCost;
exports.computeFalSora2RemixSubmitCost = computeFalSora2RemixSubmitCost;
exports.computeFalVeoCostFromModel = computeFalVeoCostFromModel;
exports.computeFalImage2SvgCost = computeFalImage2SvgCost;
exports.computeFalRecraftVectorizeCost = computeFalRecraftVectorizeCost;
exports.computeFalSeedVrUpscaleCost = computeFalSeedVrUpscaleCost;
exports.computeFalTopazUpscaleImageCost = computeFalTopazUpscaleImageCost;
const creditDistribution_1 = require("../../data/creditDistribution");
const generationHistoryRepository_1 = require("../../repository/generationHistoryRepository");
const probe_1 = require("../media/probe");
const imageProbe_1 = require("../media/imageProbe");
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
function resolveVeo31Display(isFast, kind, duration) {
    const dur = (duration || '8s').toLowerCase();
    if (isFast) {
        if (kind === 't2v') {
            if (dur.startsWith('4'))
                return 'Veo 3.1 Fast T2V 4s';
            if (dur.startsWith('6'))
                return 'Veo 3.1 Fast T2V 6s';
            return 'Veo 3.1 Fast T2V 8s';
        }
        return 'Veo 3.1 Fast I2V 8s';
    }
    else {
        if (kind === 't2v') {
            if (dur.startsWith('4'))
                return 'Veo 3.1 T2V 4s';
            if (dur.startsWith('6'))
                return 'Veo 3.1 T2V 6s';
            return 'Veo 3.1 T2V 8s';
        }
        return 'Veo 3.1 I2V 8s';
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
async function computeFalVeo31TtvSubmitCost(req, isFast) {
    const { duration, generate_audio } = req.body || {};
    const display = resolveVeo31Display(isFast, 't2v', duration);
    const base = findCredits(display);
    if (base == null)
        throw new Error('Unsupported FAL Veo 3.1 T2V pricing');
    // Apply 33% discount if generate_audio is explicitly false
    const discounted = (generate_audio === false) ? Math.ceil(base * 0.67) : Math.ceil(base);
    return { cost: discounted, pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, duration: duration || '8s', generate_audio: generate_audio !== false } };
}
async function computeFalVeo31I2vSubmitCost(req, isFast) {
    const { duration, generate_audio } = req.body || {};
    const display = resolveVeo31Display(isFast, 'i2v', duration);
    const base = findCredits(display);
    if (base == null)
        throw new Error('Unsupported FAL Veo 3.1 I2V pricing');
    const discounted = (generate_audio === false) ? Math.ceil(base * 0.67) : Math.ceil(base);
    return { cost: discounted, pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, duration: duration || '8s', generate_audio: generate_audio !== false } };
}
// Sora 2 pricing
async function computeFalSora2I2vSubmitCost(req) {
    const { duration } = req.body || {};
    const dur = String(duration ?? '8');
    let display = 'Sora 2 8s';
    if (dur.startsWith('4'))
        display = 'Sora 2 4s';
    else if (dur.startsWith('12'))
        display = 'Sora 2 12s';
    const base = findCredits(display);
    if (base == null)
        throw new Error('Unsupported Sora 2 I2V pricing');
    return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s` } };
}
async function computeFalSora2ProI2vSubmitCost(req) {
    const { duration, resolution } = req.body || {};
    const dur = String(duration ?? '8');
    const res = (String(resolution || 'auto').toLowerCase() === '1080p') ? '1080p' : '720p'; // map auto->720p
    const display = `Sora 2 Pro ${dur}s ${res}`;
    const base = findCredits(display);
    if (base == null)
        throw new Error('Unsupported Sora 2 Pro I2V pricing');
    return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s`, resolution: res } };
}
// Sora 2 T2V pricing (same credits as I2V)
async function computeFalSora2T2vSubmitCost(req) {
    const { duration } = req.body || {};
    const dur = String(duration ?? '8');
    let display = 'Sora 2 8s';
    if (dur.startsWith('4'))
        display = 'Sora 2 4s';
    else if (dur.startsWith('12'))
        display = 'Sora 2 12s';
    const base = findCredits(display);
    if (base == null)
        throw new Error('Unsupported Sora 2 T2V pricing');
    return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s` } };
}
async function computeFalSora2ProT2vSubmitCost(req) {
    const { duration, resolution } = req.body || {};
    const dur = String(duration ?? '8');
    const res = (String(resolution || 'auto').toLowerCase() === '1080p') ? '1080p' : '720p';
    const display = `Sora 2 Pro ${dur}s ${res}`;
    const base = findCredits(display);
    if (base == null)
        throw new Error('Unsupported Sora 2 Pro T2V pricing');
    return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s`, resolution: res } };
}
// LTX V2 pricing (Image-to-Video)
function computeLtxCredits(req, variant) {
    const { duration, resolution } = req.body || {};
    const dur = String(duration ?? '8');
    const resIn = String(resolution || '1080p').toLowerCase();
    const res = resIn.includes('2160') ? '2160p' : resIn.includes('1440') ? '1440p' : '1080p';
    const display = `LTX V2 ${variant} ${dur}s ${res}`;
    const base = findCredits(display);
    if (base == null)
        throw new Error(`Unsupported LTX V2 ${variant} pricing`);
    return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s`, resolution: res } };
}
async function computeFalLtxV2ProI2vSubmitCost(req) {
    return computeLtxCredits(req, 'Pro');
}
async function computeFalLtxV2FastI2vSubmitCost(req) {
    return computeLtxCredits(req, 'Fast');
}
// LTX V2 pricing (Text-to-Video) mirrors I2V
async function computeFalLtxV2ProT2vSubmitCost(req) { return computeLtxCredits(req, 'Pro'); }
async function computeFalLtxV2FastT2vSubmitCost(req) { return computeLtxCredits(req, 'Fast'); }
// Sora 2 Video-to-Video Remix pricing: infer from source video history
async function computeFalSora2RemixSubmitCost(req) {
    const uid = req.uid;
    const { source_history_id, video_id } = req.body || {};
    let source = null;
    if (source_history_id) {
        source = await generationHistoryRepository_1.generationHistoryRepository.get(uid, String(source_history_id));
    }
    else if (video_id) {
        const found = await generationHistoryRepository_1.generationHistoryRepository.findBySoraVideoId(uid, String(video_id));
        source = found?.item;
    }
    if (!source)
        throw new Error('Cannot determine pricing: source Sora video not found');
    const dur = String(source?.duration ?? '8');
    // Decide pro vs standard using model or resolution
    const srcModel = String(source?.model || '').toLowerCase();
    const srcRes = String(source?.resolution || '').toLowerCase();
    const isPro = srcModel.includes('/pro') || srcRes === '1080p';
    if (isPro) {
        const res = srcRes === '1080p' ? '1080p' : '720p';
        const display = `Sora 2 Pro ${dur}s ${res}`;
        const base = findCredits(display);
        if (base == null)
            throw new Error('Unsupported Sora 2 Pro remix pricing');
        return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s`, resolution: res, remixOf: source.id } };
    }
    const display = dur.startsWith('4') ? 'Sora 2 4s' : (dur.startsWith('12') ? 'Sora 2 12s' : 'Sora 2 8s');
    const base = findCredits(display);
    if (base == null)
        throw new Error('Unsupported Sora 2 remix pricing');
    return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s`, remixOf: source.id } };
}
function computeFalVeoCostFromModel(model, meta) {
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
    else if (normalized === 'fal-ai/veo3.1')
        display = 'Veo 3.1 T2V 8s';
    else if (normalized === 'fal-ai/veo3.1/fast')
        display = 'Veo 3.1 Fast T2V 8s';
    else if (normalized === 'fal-ai/veo3.1/image-to-video')
        display = 'Veo 3.1 I2V 8s';
    else if (normalized === 'fal-ai/veo3.1/fast/image-to-video')
        display = 'Veo 3.1 Fast I2V 8s';
    else if (normalized === 'fal-ai/veo3.1/first-last-frame-to-video')
        display = 'Veo 3.1 I2V 8s';
    else if (normalized === 'fal-ai/veo3.1/reference-to-video')
        display = 'Veo 3.1 I2V 8s';
    // Sora 2 mapping using stored meta for duration/resolution
    else if (normalized === 'fal-ai/sora-2/image-to-video') {
        const dur = String(meta?.duration ?? '8');
        if (dur.startsWith('4'))
            display = 'Sora 2 4s';
        else if (dur.startsWith('12'))
            display = 'Sora 2 12s';
        else
            display = 'Sora 2 8s';
    }
    else if (normalized === 'fal-ai/sora-2/image-to-video/pro') {
        const dur = String(meta?.duration ?? '8');
        const res = String(meta?.resolution ?? '720p').toLowerCase() === '1080p' ? '1080p' : '720p';
        display = `Sora 2 Pro ${dur}s ${res}`;
    }
    else if (normalized === 'fal-ai/sora-2/text-to-video') {
        const dur = String(meta?.duration ?? '8');
        if (dur.startsWith('4'))
            display = 'Sora 2 4s';
        else if (dur.startsWith('12'))
            display = 'Sora 2 12s';
        else
            display = 'Sora 2 8s';
    }
    else if (normalized === 'fal-ai/sora-2/text-to-video/pro') {
        const dur = String(meta?.duration ?? '8');
        const res = String(meta?.resolution ?? '720p').toLowerCase() === '1080p' ? '1080p' : '720p';
        display = `Sora 2 Pro ${dur}s ${res}`;
    }
    else if (normalized === 'fal-ai/sora-2/video-to-video/remix') {
        // Remix cost equals source Sora SKU; rely on stored source_* meta saved at submission time
        const dur = String(meta?.source_duration ?? meta?.duration ?? '8');
        const res = String(meta?.source_resolution ?? meta?.resolution ?? '720p').toLowerCase();
        const isPro = String(meta?.source_is_pro ?? '').toLowerCase() === 'true' || res === '1080p';
        if (isPro)
            display = `Sora 2 Pro ${dur}s ${res === '1080p' ? '1080p' : '720p'}`;
        else
            display = dur.startsWith('4') ? 'Sora 2 4s' : (dur.startsWith('12') ? 'Sora 2 12s' : 'Sora 2 8s');
    }
    else if (normalized === 'fal-ai/ltxv-2/image-to-video') {
        const dur = String(meta?.duration ?? '8');
        const resIn = String(meta?.resolution || '1080p').toLowerCase();
        const res = resIn.includes('2160') ? '2160p' : resIn.includes('1440') ? '1440p' : '1080p';
        display = `LTX V2 Pro ${dur}s ${res}`;
    }
    else if (normalized === 'fal-ai/ltxv-2/image-to-video/fast') {
        const dur = String(meta?.duration ?? '8');
        const resIn = String(meta?.resolution || '1080p').toLowerCase();
        const res = resIn.includes('2160') ? '2160p' : resIn.includes('1440') ? '1440p' : '1080p';
        display = `LTX V2 Fast ${dur}s ${res}`;
    }
    else if (normalized === 'fal-ai/ltxv-2/text-to-video') {
        const dur = String(meta?.duration ?? '8');
        const resIn = String(meta?.resolution || '1080p').toLowerCase();
        const res = resIn.includes('2160') ? '2160p' : resIn.includes('1440') ? '1440p' : '1080p';
        display = `LTX V2 Pro ${dur}s ${res}`;
    }
    else if (normalized === 'fal-ai/ltxv-2/text-to-video/fast') {
        const dur = String(meta?.duration ?? '8');
        const resIn = String(meta?.resolution || '1080p').toLowerCase();
        const res = resIn.includes('2160') ? '2160p' : resIn.includes('1440') ? '1440p' : '1080p';
        display = `LTX V2 Fast ${dur}s ${res}`;
    }
    const base = display ? findCredits(display) : null;
    if (base == null)
        throw new Error('Unsupported FAL Veo model');
    return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display } };
}
// Image utilities pricing
async function computeFalImage2SvgCost(_req) {
    const display = 'fal-ai/image2svg';
    const base = findCredits(display);
    if (base == null)
        throw new Error('Unsupported FAL image2svg pricing');
    return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display } };
}
async function computeFalRecraftVectorizeCost(_req) {
    const display = 'fal-ai/recraft/vectorize';
    const base = findCredits(display);
    if (base == null)
        throw new Error('Unsupported FAL recraft/vectorize pricing');
    return { cost: Math.ceil(base), pricingVersion: exports.FAL_PRICING_VERSION, meta: { model: display } };
}
// SeedVR2 Video Upscaler dynamic pricing
// Rule: $0.001 per megapixel of upscaled video data (width x height x frames)
// Credits conversion inferred from sheet: $1 ~= 2000 credits (since $0.05 => 100 credits)
const CREDITS_PER_USD = 2000;
async function computeFalSeedVrUpscaleCost(req) {
    const body = req.body || {};
    const url = body.video_url;
    if (!url)
        throw new Error('video_url is required');
    // Use validator-stashed probe if available; otherwise probe now
    const meta = req.seedvrProbe || await (0, probe_1.probeVideoMeta)(url);
    const durationSec = Number(meta?.durationSec || 0);
    const inW = Number(meta?.width || 0);
    const inH = Number(meta?.height || 0);
    let frames = Number(meta?.frames || 0);
    const fps = Number(meta?.fps || 0);
    if ((!frames || !isFinite(frames)) && isFinite(durationSec) && isFinite(fps) && fps > 0) {
        frames = Math.round(durationSec * fps);
    }
    if (!isFinite(durationSec) || durationSec <= 0 || !isFinite(inW) || !isFinite(inH) || inW <= 0 || inH <= 0 || !isFinite(frames) || frames <= 0) {
        throw new Error('Unable to compute video metadata for pricing');
    }
    if (durationSec > 30.5)
        throw new Error('Input video too long. Maximum allowed duration is 30 seconds.');
    // Compute output dimensions based on requested mode
    const mode = (body.upscale_mode === 'target' ? 'target' : 'factor');
    let outW = inW;
    let outH = inH;
    if (mode === 'factor') {
        const factor = Number(body.upscale_factor ?? 2);
        const f = Math.max(0.1, Math.min(10, isFinite(factor) ? factor : 2));
        outW = Math.max(1, Math.round(inW * f));
        outH = Math.max(1, Math.round(inH * f));
    }
    else {
        const target = String(body.target_resolution || '1080p').toLowerCase();
        const map = { '720p': 720, '1080p': 1080, '1440p': 1440, '2160p': 2160 };
        const targetH = map[target] || 1080;
        outH = targetH;
        outW = Math.max(1, Math.round(inW * (targetH / inH)));
    }
    const totalPixels = outW * outH * frames;
    const megapixels = totalPixels / 1000000;
    const dollars = megapixels * 0.001;
    const credits = Math.max(1, Math.ceil(dollars * CREDITS_PER_USD));
    return {
        cost: credits,
        pricingVersion: exports.FAL_PRICING_VERSION,
        meta: {
            model: 'fal-ai/seedvr/upscale/video',
            input: { width: inW, height: inH, durationSec, fps, frames },
            output: { width: outW, height: outH, frames },
            pricing: { megapixels, dollars, credits },
            mode,
            upscale_factor: mode === 'factor' ? Number(body.upscale_factor ?? 2) : undefined,
            target_resolution: mode === 'target' ? (body.target_resolution || '1080p') : undefined,
        }
    };
}
// Topaz Image Upscaler dynamic pricing
// Rule: 70 credits per output megapixel (width x height / 1e6)
async function computeFalTopazUpscaleImageCost(req) {
    const body = req.body || {};
    const url = body.image_url;
    if (!url)
        throw new Error('image_url is required');
    const meta = req.topazImageProbe || await (0, imageProbe_1.probeImageMeta)(url);
    const inW = Number(meta?.width || 0);
    const inH = Number(meta?.height || 0);
    if (!isFinite(inW) || !isFinite(inH) || inW <= 0 || inH <= 0)
        throw new Error('Unable to compute image dimensions for pricing');
    const factor = Math.max(0.1, Math.min(10, Number(body.upscale_factor ?? 2)));
    const outW = Math.max(1, Math.round(inW * factor));
    const outH = Math.max(1, Math.round(inH * factor));
    const megapixels = (outW * outH) / 1000000;
    const creditsPerMp = 70;
    const credits = Math.max(1, Math.ceil(megapixels * creditsPerMp));
    return {
        cost: credits,
        pricingVersion: exports.FAL_PRICING_VERSION,
        meta: {
            model: 'fal-ai/topaz/upscale/image',
            input: { width: inW, height: inH },
            output: { width: outW, height: outH },
            pricing: { megapixels, creditsPerMp, credits },
            upscale_factor: factor,
            topaz_model: body.model,
        },
    };
}
