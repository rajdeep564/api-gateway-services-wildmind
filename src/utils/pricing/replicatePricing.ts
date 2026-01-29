import { Request } from 'express';
import { creditDistributionData } from '../../data/creditDistribution';
import { probeImageMeta } from '../media/imageProbe';
import { ApiError } from '../errorHandler';

export const REPLICATE_PRICING_VERSION = 'replicate-v1';

function findCredits(modelName: string): number | null {
  const row = creditDistributionData.find(m => m.modelName.toLowerCase() === modelName.toLowerCase());
  return row?.creditsPerGeneration ?? null;
}

export async function computeReplicateBgRemoveCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { model } = req.body || {};
  const normalized = String(model || '').toLowerCase();

  // Map to creditDistribution modelName entries (no replicate/ prefix)
  let display = 'Lucataco/remove-bg'; // Default fallback

  if (normalized.includes('bria/eraser')) {
    // Handling Bria specifically if not in sheet or if name differs
    // Sheet has "fal-ai/bria/genfill" (100) and "replicate/bria/expand-image" (100).
    // If logic was 100, we can use "replicate/bria/expand-image" as proxy if eraser is not there, 
    // or just hardcode if we can't find it. 
    // Given previous code had COST_BRIA_ERASER = 100, and expand-image is 100.
    // I'll stick to a hardcoded logic for this ONE if it's not in sheet, 
    // BUT I suspect "replicate/bria/expand-image" might be covering it or it uses genfill.
    // I'll verify "replicate/bria/expand-image" exists. Yes.
    // I'll check if there is an eraser.
    // If not, I'll use hardcoded 100 but ideally add to sheet.
    // For now, let's keep it safe.
    return { cost: 100, pricingVersion: REPLICATE_PRICING_VERSION, meta: { model: normalized, note: 'Hardcoded Bria Eraser cost' } };
  }
  else if (normalized.includes('851-labs/background-remover')) display = '851-labs/background-remover';
  else display = 'Lucataco/remove-bg';

  const base = findCredits(display);
  // Default to 31 if not found (legacy fallback)
  const cost = base !== null ? Math.ceil(base) : 31;

  return { cost, pricingVersion: REPLICATE_PRICING_VERSION, meta: { model: display } };
}

export async function computeReplicateUpscaleCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { model } = req.body || {};
  // Mirror replicateService.upscale default: Crystal Upscaler when model is omitted.
  const normalized = String(model || 'philz1337x/crystal-upscaler').toLowerCase();
  let display = '';
  let meta: Record<string, any> = { model: normalized };

  // Crystal Upscaler: pixel-tier pricing (based on output pixels)
  // Tiers (total pixels):
  //  <= 4 MP    -> $0.05
  //  <= 8 MP    -> $0.10
  //  <= 16 MP   -> $0.20
  //  <= 25 MP   -> $0.40
  //  <= 50 MP   -> $0.80
  //  <= 100 MP  -> $1.60
  //  else       -> $3.20
  // User cost adds fixed $0.01 overcharge.
  // Credit cost MUST match the sheet exactly (fixed credits per tier).
  if (normalized.includes('crystal')) {
    const getNum = (v: any): number | undefined => {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return undefined;
      return n;
    };

    const width =
      getNum((req.body as any)?.width) ??
      getNum((req.body as any)?.inputWidth) ??
      getNum((req.body as any)?.w);
    const height =
      getNum((req.body as any)?.height) ??
      getNum((req.body as any)?.inputHeight) ??
      getNum((req.body as any)?.h);

    let inW = width;
    let inH = height;

    if (!inW || !inH) {
      const imageUrl = String((req.body as any)?.image || '');
      if (imageUrl) {
        const probed = await probeImageMeta(imageUrl);
        if (probed.width && probed.height) {
          inW = probed.width;
          inH = probed.height;
          meta.probed = true;
        }
      }
    }

    if (!inW || !inH || inW <= 0 || inH <= 0) {
      throw new ApiError('Unable to determine image dimensions for Crystal Upscaler pricing', 400);
    }

    const rawScale = getNum((req.body as any)?.scale_factor);
    const scaleFactor = Math.max(1, Math.min(4, rawScale ?? 2));

    const outW = Math.max(1, Math.round(inW * scaleFactor));
    const outH = Math.max(1, Math.round(inH * scaleFactor));
    const totalPixels = outW * outH;

    const baseCents = ((): number => {
      // Match credit sheet tiers (MP = million pixels)
      if (totalPixels <= 4_000_000) return 5;
      if (totalPixels <= 8_000_000) return 10;
      if (totalPixels <= 16_000_000) return 20;
      if (totalPixels <= 25_000_000) return 40;
      if (totalPixels <= 50_000_000) return 80;
      if (totalPixels <= 100_000_000) return 160;
      return 320;
    })();

    const overchargeCents = 1;
    const userCostCents = baseCents + overchargeCents;
    const cost = ((): number => {
      // Sheet mapping: MP tier => credits per generation
      if (totalPixels <= 4_000_000) return 120;
      if (totalPixels <= 8_000_000) return 220;
      if (totalPixels <= 16_000_000) return 420;
      if (totalPixels <= 25_000_000) return 820;
      if (totalPixels <= 50_000_000) return 1620;
      if (totalPixels <= 100_000_000) return 3220;
      return 6420;
    })();

    meta = {
      ...meta,
      model: 'replicate/crystal-upscaler',
      inputWidth: Math.round(inW),
      inputHeight: Math.round(inH),
      scaleFactor,
      outputWidth: outW,
      outputHeight: outH,
      totalPixels,
      totalMP: Math.round((totalPixels / 1_000_000) * 100) / 100,
      baseCents,
      overchargeCents,
      userCostCents,
      computedCredits: cost,
    };

    // Detailed debug logs to verify real requests against the pricing sheet
    // eslint-disable-next-line no-console
    console.log('[pricing][replicate.upscale][crystal] computed', {
      input: { w: meta.inputWidth, h: meta.inputHeight },
      scaleFactor,
      output: { w: outW, h: outH },
      totalPixels,
      totalMP: meta.totalMP,
      baseCents,
      overchargeCents,
      userCostCents,
      credits: cost,
      probed: meta.probed === true,
    });

    return { cost, pricingVersion: 'replicate-upscale-v2', meta };
  }
  else if (normalized.includes('philz1337x/clarity-upscaler')) display = 'replicate/philz1337x/clarity-upscaler';
  else if (normalized.includes('fermatresearch/magic-image-refiner')) display = 'replicate/fermatresearch/magic-image-refiner';
  else if (normalized.includes('nightmareai/real-esrgan')) display = 'replicate/nightmareai/real-esrgan';
  else if (normalized.includes('mv-lab/swin2sr')) display = 'replicate/mv-lab/swin2sr';
  else display = 'replicate/philz1337x/clarity-upscaler'; // Fallback

  const base = findCredits(display);
  if (base == null) throw new Error(`Unsupported Replicate Upscale model: ${display}`);

  return { cost: Math.ceil(base), pricingVersion: REPLICATE_PRICING_VERSION, meta };
}

export async function computeReplicateImageGenCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { model, quality } = req.body || {};
  const normalized = String(model || '').toLowerCase();

  // Resolve requested image count across common param names.
  // Frontend uses `n`; GPT Image 1.5 schema uses `number_of_images`.
  const rawCount =
    (req.body as any)?.number_of_images ??
    (req.body as any)?.n ??
    (req.body as any)?.num_images ??
    (req.body as any)?.max_images;
  const count = Math.max(1, Math.min(10, Number(rawCount ?? 1)));

  let display = 'replicate/bytedance/seedream-4'; // Default fallback
  let meta: Record<string, any> = { model: normalized };

  // Handle GPT Image 1.5 with quality-based pricing
  if (
    normalized.includes('openai/gpt-image-1.5') ||
    normalized.includes('gpt-image-1.5')
  ) {
    // Extract quality parameter (default to 'auto' if not provided)
    const qualityValue = String(quality || 'auto').toLowerCase();
    // Map quality to credit distribution model name format
    display = `gpt-image-1.5 ${qualityValue}`;
    meta.quality = qualityValue;
  }
  else if (
    normalized.includes('ideogram-ai/ideogram-v3-turbo') ||
    (normalized.includes('ideogram') && normalized.includes('turbo'))
  ) {
    display = 'replicate/ideogram-ai/ideogram-v3-turbo';
  }
  else if (normalized.includes('fermatresearch/magic-image-refiner')) {
    display = 'replicate/fermatresearch/magic-image-refiner';
  }
  else if (
    normalized.includes('ideogram-ai/ideogram-v3-quality') ||
    normalized.includes('ideogram 3 quality') ||
    normalized.includes('ideogram-3-quality') ||
    (normalized.includes('ideogram') && normalized.includes('quality'))
  ) {
    display = 'Ideogram 3 Quality';
  }
  else if (normalized.includes('leonardoai/lucid-origin') || normalized.includes('lucid origin') || normalized.includes('lucid-origin')) {
    display = 'Lucid Origin';
  }
  else if (normalized.includes('phoenix 1.0') || normalized.includes('phoenix-1.0')) {
    display = 'Phoenix 1.0';
  }
  else if (normalized.includes('p-image') || normalized.includes('prunaai/p-image')) {
    display = 'P-Image';
  }
  else if (normalized.includes('p-image-edit') || normalized.includes('prunaai/p-image-edit')) {
    display = 'P-Image-Edit';
  }
  else if (normalized.includes('qwen-image')) {
    // Qwen Image 2512 should be charged at 60 credits (matches credit sheet entry: qwen-image-edit-2512)
    // Keep pricing keyed to the creditDistributionData modelName.
    display = normalized.includes('2512') ? 'qwen-image-edit-2512' : 'qwen-image-edit-2511';
  }

  // Lookup base cost (per image)
  let baseCost = 0;

  // Handle Z-Image Turbo mapping
  if (
    normalized.includes('z-image-turbo') ||
    normalized.includes('zimage-turbo') ||
    normalized.includes('prunaai/z-image-turbo') ||
    normalized.includes('new-turbo-model') ||
    normalized.includes('placeholder-model-name')
  ) {
    display = 'z-image-turbo';
  }

  const base = findCredits(display);
  if (base == null) throw new Error(`Unsupported Replicate Image model: ${display}`);
  baseCost = Math.ceil(base);

  const cost = Math.ceil(baseCost * count);
  return {
    cost,
    pricingVersion: REPLICATE_PRICING_VERSION,
    meta: { ...meta, model: display, n: count },
  };
}

export async function computeReplicateMultiangleCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { model } = req.body || {};
  let display = 'replicate/qwen/qwen-edit-multiangle';

  const base = findCredits(display);
  // Default to 40 credits if not found
  const cost = base !== null ? Math.ceil(base) : 40;

  return { cost, pricingVersion: REPLICATE_PRICING_VERSION, meta: { model: display } };
}

export async function computeReplicateNextSceneCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  // Model name used in service: qwen-edit-apps/qwen-image-edit-plus-lora-next-scene
  const display = 'replicate/qwen/next-scene';

  const base = findCredits(display);
  // Default to 40 credits if not found (assuming similar complexity to multiangle)
  const cost = base !== null ? Math.ceil(base) : 40;

  return { cost, pricingVersion: REPLICATE_PRICING_VERSION, meta: { model: display } };
}

export async function computeQwenImageEditCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  // Credit distribution uses the short model name (no replicate/ prefix)
  const requested = String((req.body as any)?.model || '').toLowerCase();
  const display = requested.includes('2512') ? 'qwen-image-edit-2512' : 'qwen-image-edit-2511';

  const base = findCredits(display);
  // Default to 60 credits for 2512 and 80 for 2511 if not found
  const fallback = display.includes('2512') ? 60 : 80;
  const cost = base !== null ? Math.ceil(base) : fallback;

  return {
    cost,
    pricingVersion: REPLICATE_PRICING_VERSION,
    meta: { model: display, requestedModel: (req.body as any)?.model },
  };
}

export async function computeReplicateVideoCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { model, duration, resolution, firstFrameUrl } = req.body || {};
  const normalized = String(model || '').toLowerCase();
  const isI2V = !!firstFrameUrl;
  const dur = duration || 5;
  const res = (resolution || '720p').toLowerCase();

  let display = '';
  let meta: Record<string, any> = {
    model: normalized,
    duration: dur,
    resolution: res,
    mode: isI2V ? 'I2V' : 'T2V'
  };

  if (normalized.includes('kling')) {
    // Patterns: "Kling 2.5 Turbo Pro T2V 5s", "Kling 2.5 Turbo Pro I2V 10s"
    const type = isI2V ? 'I2V' : 'T2V';
    // Round duration to nearest supported (5 or 10)
    const durTag = dur > 5 ? '10s' : '5s';
    display = `Kling 2.5 Turbo Pro ${type} ${durTag}`;
  }
  else if (normalized.includes('wan')) {
    // Patterns: "Wan 2.5 T2V 5s 720p", "Wan 2.5 Fast T2V 5s 1080p"
    const isFast = normalized.includes('fast');
    const type = isI2V ? 'I2V' : 'T2V';
    const durTag = dur > 5 ? '10s' : '5s';
    const fastTag = isFast ? 'Fast ' : '';
    // Wan supports 480p, 720p, 1080p
    let resTag = '720p';
    if (res.includes('480')) resTag = '480p';
    else if (res.includes('1080')) resTag = '1080p';

    display = `Wan 2.5 ${fastTag}${type} ${durTag} ${resTag}`;
  }
  else if (normalized.includes('seedance')) {
    // Patterns: "Seedance 1.0 Pro T2V 5s 720p", "Seedance 1.0 Lite T2V 5s 480p"
    const isLite = normalized.includes('lite');
    const type = isI2V ? 'I2V' : 'T2V';
    const durTag = dur > 5 ? '10s' : '5s';
    const variant = isLite ? 'Lite' : 'Pro';
    let resTag = '720p';
    if (res.includes('480')) resTag = '480p';
    else if (res.includes('1080')) resTag = '1080p';

    display = `Seedance 1.0 ${variant} ${type} ${durTag} ${resTag}`;
  }
  else if (normalized.includes('pixverse')) {
    // Patterns: "PixVerse 5 T2V 5s 360p", "PixVerse 5 I2V 8s 1080p"
    const type = isI2V ? 'I2V' : 'T2V';
    // PixVerse v5 supports 5s and 8s
    const durTag = dur > 5 ? '8s' : '5s';
    // PixVerse v5 supports 360p, 540p, 720p, 1080p
    let resTag = '720p';
    if (res.includes('360')) resTag = '360p';
    else if (res.includes('540')) resTag = '540p';
    else if (res.includes('1080')) resTag = '1080p';

    display = `PixVerse 5 ${type} ${durTag} ${resTag}`;
  }

  if (!display) {
    throw new Error(`Unsupported Replicate Video model: ${model}`);
  }

  const base = findCredits(display);
  if (base == null) {
    console.warn(`[computeReplicateVideoCost] Pricing not found for "${display}", using fallback 760`);
    return { cost: 760, pricingVersion: REPLICATE_PRICING_VERSION, meta: { ...meta, display, note: 'Fallback pricing' } };
  }

  return { cost: Math.ceil(base), pricingVersion: REPLICATE_PRICING_VERSION, meta: { ...meta, display } };
}
