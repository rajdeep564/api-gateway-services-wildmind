import { Request } from 'express';

export const REPLICATE_PRICING_VERSION = 'replicate-v1';

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
const COST_SEEDREAM4 = 80;
const COST_SEEDREAM45 = 100; // Bytedance Seedream-4.5 (from creditDistribution: creditsPerGeneration = 100)
const COST_IDEOGRAM_V3_TURBO = 90;
const COST_MAGIC_IMAGE_REFINER = 84;
const COST_IDEOGRAM_3_QUALITY = 210;
const COST_LUCID_ORIGIN = 183;
const COST_PHOENIX_1_0 = 180;
// TODO: Update with actual pricing for new Turbo model
// Z Image Turbo pricing (from creditDistribution: creditsPerGeneration = 26)
const COST_Z_IMAGE_TURBO = 26;
const COST_NANO_BANANA_PRO_1K = 300;
const COST_NANO_BANANA_PRO_2K = 300;
const COST_NANO_BANANA_PRO_4K = 500;

export async function computeReplicateBgRemoveCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { model } = req.body || {};
  const normalized = String(model || '').toLowerCase();
  let cost = COST_REMOVE_BG;
  if (normalized.includes('bria/eraser')) cost = COST_BRIA_ERASER;
  else if (normalized.includes('851-labs/background-remover')) cost = COST_BACKGROUND_REMOVER;
  return { cost: Math.ceil(cost), pricingVersion: REPLICATE_PRICING_VERSION, meta: { model: normalized } };
}

export async function computeReplicateUpscaleCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { model } = req.body || {};
  const normalized = String(model || '').toLowerCase();
  let cost: number;
  // Crystal Upscaler has resolution-based pricing
  if (normalized.includes('crystal')) {
    const resRaw = String((req.body as any)?.resolution || '').toLowerCase();
    // Normalize a few common forms (e.g., 1920x1080 -> 1080p)
    const res = ((): string => {
      if (!resRaw) return '1080p';
      if (resRaw.includes('1080')) return '1080p';
      if (resRaw.includes('1440')) return '1440p';
      if (resRaw.includes('2160') || resRaw.includes('4k')) return '2160p';
      if (resRaw.includes('6k')) return '6k';
      if (resRaw.includes('8k')) return '8k';
      if (resRaw.includes('12k')) return '12k';
      // If numeric, map by thresholds (<=1080 => 1080p, <=1440 => 1440p, etc.)
      const m = resRaw.match(/(\d{3,4})p/);
      if (m) {
        const p = Number(m[1]);
        if (p <= 1080) return '1080p';
        if (p <= 1440) return '1440p';
        if (p <= 2160) return '2160p';
      }
      return '1080p';
    })();
    switch (res) {
      case '1080p': cost = COST_CRYSTAL_1080P; break;
      case '1440p': cost = COST_CRYSTAL_1440P; break;
      case '2160p': cost = COST_CRYSTAL_2160P; break;
      case '6k': cost = COST_CRYSTAL_6K; break;
      case '8k': cost = COST_CRYSTAL_8K; break;
      case '12k': cost = COST_CRYSTAL_12K; break;
      default: cost = COST_CRYSTAL_1080P; break;
    }
    return { cost: Math.ceil(cost), pricingVersion: REPLICATE_PRICING_VERSION, meta: { model: normalized, resolution: res } };
  }
  if (normalized.includes('philz1337x/clarity-upscaler')) cost = COST_CLARITY_UPSCALER;
  else if (normalized.includes('fermatresearch/magic-image-refiner')) cost = COST_MAGIC_IMAGE_REFINER;
  else if (normalized.includes('nightmareai/real-esrgan')) cost = COST_REAL_ESRGAN;
  else if (normalized.includes('mv-lab/swin2sr')) cost = COST_SWIN2SR;
  else cost = COST_CLARITY_UPSCALER;
  return { cost: Math.ceil(cost), pricingVersion: REPLICATE_PRICING_VERSION, meta: { model: normalized } };
}

export async function computeReplicateImageGenCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { model } = req.body || {};
  const normalized = String(model || '').toLowerCase();
  let cost = COST_SEEDREAM4;
  // Seedream 4.5 - check before seedream-4
  if (normalized.includes('seedream-4.5') || normalized.includes('bytedance/seedream-4.5')) {
    cost = COST_SEEDREAM45;
  }
  // Ideogram Turbo matches
  if (
    normalized.includes('ideogram-ai/ideogram-v3-turbo') ||
    (normalized.includes('ideogram') && normalized.includes('turbo'))
  ) {
    cost = COST_IDEOGRAM_V3_TURBO;
  }
  if (normalized.includes('fermatresearch/magic-image-refiner')) cost = COST_MAGIC_IMAGE_REFINER;
  // Ideogram 3 Quality matches
  if (
    normalized.includes('ideogram-ai/ideogram-v3-quality') ||
    normalized.includes('ideogram 3 quality') ||
    normalized.includes('ideogram-3-quality') ||
    (normalized.includes('ideogram') && normalized.includes('quality'))
  ) {
    cost = COST_IDEOGRAM_3_QUALITY;
  }
  if (normalized.includes('leonardoai/lucid-origin') || normalized.includes('lucid origin') || normalized.includes('lucid-origin')) cost = COST_LUCID_ORIGIN;
  if (normalized.includes('phoenix 1.0') || normalized.includes('phoenix-1.0')) cost = COST_PHOENIX_1_0;
  // Z-Image Turbo: Free (0 credits) for launch offer
  if (
    normalized.includes('z-image-turbo') || 
    normalized.includes('zimage-turbo') ||
    normalized.includes('prunaai/z-image-turbo') ||
    normalized.includes('new-turbo-model') || 
    normalized.includes('placeholder-model-name')
  ) {
    cost = 0; // Free for launch offer
  }
  // Google Nano Banana Pro - resolution-based pricing
  if (normalized.includes('google/nano-banana-pro') || normalized.includes('nano-banana-pro')) {
    const resolution = String((req.body as any)?.resolution || '2K').toUpperCase();
    if (resolution === '4K') {
      cost = COST_NANO_BANANA_PRO_4K;
    } else {
      // Default to 1K/2K pricing (300 credits)
      cost = COST_NANO_BANANA_PRO_2K;
    }
  }
  return { cost: Math.ceil(cost), pricingVersion: REPLICATE_PRICING_VERSION, meta: { model: normalized } };
}


