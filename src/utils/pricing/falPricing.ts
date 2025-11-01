import { Request } from 'express';
import { creditDistributionData } from '../../data/creditDistribution';
import { generationHistoryRepository } from '../../repository/generationHistoryRepository';

export const FAL_PRICING_VERSION = 'fal-v1';

function findCredits(modelName: string): number | null {
  const row = creditDistributionData.find(m => m.modelName.toLowerCase() === modelName.toLowerCase());
  return row?.creditsPerGeneration ?? null;
}

export async function computeFalImageCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { uploadedImages = [], n = 1, model } = req.body || {};
  // Prefer explicit Imagen 4 variants if selected by client; fallback to Google Nano Banana rows
  let display: string | null = null;
  const m = (model || '').toLowerCase();
  if (m.includes('imagen-4')) {
    if (m.includes('ultra')) display = 'Imagen 4 Ultra';
    else if (m.includes('fast')) display = 'Imagen 4 Fast';
    else display = 'Imagen 4';
  } else {
    // Map Gemini image to our Google rows (choose I2I when uploadedImages provided)
    display = Array.isArray(uploadedImages) && uploadedImages.length > 0
      ? 'Google nano banana (I2I)'
      : 'Google nano banana (T2I)';
  }
  const base = display ? findCredits(display) : null;
  if (base == null) throw new Error('Unsupported FAL image model');
  const count = Math.max(1, Math.min(10, Number(n)));
  const cost = Math.ceil(base * count);
  return { cost, pricingVersion: FAL_PRICING_VERSION, meta: { model: display, n: count } };
}

function resolveVeoDisplay(isFast: boolean, kind: 't2v' | 'i2v', duration?: string): string {
  const dur = (duration || '8s').toLowerCase();
  if (isFast) {
    if (kind === 't2v') {
      if (dur.startsWith('4')) return 'veo3 fast t2v 4s';
      if (dur.startsWith('6')) return 'veo3 fast t2v 6s';
      return 'veo3 fast t2v 8s';
    }
    return 'veo3 fast i2v 8s';
  } else {
    if (kind === 't2v') {
      if (dur.startsWith('4')) return 'veo3 t2v 4s';
      if (dur.startsWith('6')) return 'veo3 t2v 6s';
      return 'veo3 t2v 8s';
    }
    return 'veo3 i2v 8s';
  }
}

function resolveVeo31Display(isFast: boolean, kind: 't2v' | 'i2v', duration?: string): string {
  const dur = (duration || '8s').toLowerCase();
  if (isFast) {
    if (kind === 't2v') {
      if (dur.startsWith('4')) return 'Veo 3.1 Fast T2V 4s';
      if (dur.startsWith('6')) return 'Veo 3.1 Fast T2V 6s';
      return 'Veo 3.1 Fast T2V 8s'; 
    }
    return 'Veo 3.1 Fast I2V 8s';
  } else {
    if (kind === 't2v') {
      if (dur.startsWith('4')) return 'Veo 3.1 T2V 4s';
      if (dur.startsWith('6')) return 'Veo 3.1 T2V 6s';
      return 'Veo 3.1 T2V 8s';
    }
    return 'Veo 3.1 I2V 8s';
  }
}

export async function computeFalVeoTtvSubmitCost(req: Request, isFast: boolean): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { duration } = req.body || {};
  const display = resolveVeoDisplay(isFast, 't2v', duration);
  const base = findCredits(display);
  if (base == null) throw new Error('Unsupported FAL Veo T2V pricing');
  return { cost: Math.ceil(base), pricingVersion: FAL_PRICING_VERSION, meta: { model: display, duration: duration || '8s' } };
}

export async function computeFalVeoI2vSubmitCost(req: Request, isFast: boolean): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { duration } = req.body || {};
  const display = resolveVeoDisplay(isFast, 'i2v', duration);
  const base = findCredits(display);
  if (base == null) throw new Error('Unsupported FAL Veo I2V pricing');
  return { cost: Math.ceil(base), pricingVersion: FAL_PRICING_VERSION, meta: { model: display, duration: duration || '8s' } };
}

export async function computeFalVeo31TtvSubmitCost(req: Request, isFast: boolean): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { duration, generate_audio } = req.body || {};
  const display = resolveVeo31Display(isFast, 't2v', duration);
  const base = findCredits(display);
  if (base == null) throw new Error('Unsupported FAL Veo 3.1 T2V pricing');
  // Apply 33% discount if generate_audio is explicitly false
  const discounted = (generate_audio === false) ? Math.ceil(base * 0.67) : Math.ceil(base);
  return { cost: discounted, pricingVersion: FAL_PRICING_VERSION, meta: { model: display, duration: duration || '8s', generate_audio: generate_audio !== false } };
}

export async function computeFalVeo31I2vSubmitCost(req: Request, isFast: boolean): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { duration, generate_audio } = req.body || {};
  const display = resolveVeo31Display(isFast, 'i2v', duration);
  const base = findCredits(display);
  if (base == null) throw new Error('Unsupported FAL Veo 3.1 I2V pricing');
  const discounted = (generate_audio === false) ? Math.ceil(base * 0.67) : Math.ceil(base);
  return { cost: discounted, pricingVersion: FAL_PRICING_VERSION, meta: { model: display, duration: duration || '8s', generate_audio: generate_audio !== false } };
}

// Sora 2 pricing
export async function computeFalSora2I2vSubmitCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { duration } = req.body || {};
  const dur = String(duration ?? '8');
  let display = 'Sora 2 8s';
  if (dur.startsWith('4')) display = 'Sora 2 4s';
  else if (dur.startsWith('12')) display = 'Sora 2 12s';
  const base = findCredits(display);
  if (base == null) throw new Error('Unsupported Sora 2 I2V pricing');
  return { cost: Math.ceil(base), pricingVersion: FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s` } };
}

export async function computeFalSora2ProI2vSubmitCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { duration, resolution } = req.body || {};
  const dur = String(duration ?? '8');
  const res = (String(resolution || 'auto').toLowerCase() === '1080p') ? '1080p' : '720p'; // map auto->720p
  const display = `Sora 2 Pro ${dur}s ${res}`;
  const base = findCredits(display);
  if (base == null) throw new Error('Unsupported Sora 2 Pro I2V pricing');
  return { cost: Math.ceil(base), pricingVersion: FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s`, resolution: res } };
}

// Sora 2 T2V pricing (same credits as I2V)
export async function computeFalSora2T2vSubmitCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { duration } = req.body || {};
  const dur = String(duration ?? '8');
  let display = 'Sora 2 8s';
  if (dur.startsWith('4')) display = 'Sora 2 4s';
  else if (dur.startsWith('12')) display = 'Sora 2 12s';
  const base = findCredits(display);
  if (base == null) throw new Error('Unsupported Sora 2 T2V pricing');
  return { cost: Math.ceil(base), pricingVersion: FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s` } };
}

export async function computeFalSora2ProT2vSubmitCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { duration, resolution } = req.body || {};
  const dur = String(duration ?? '8');
  const res = (String(resolution || 'auto').toLowerCase() === '1080p') ? '1080p' : '720p';
  const display = `Sora 2 Pro ${dur}s ${res}`;
  const base = findCredits(display);
  if (base == null) throw new Error('Unsupported Sora 2 Pro T2V pricing');
  return { cost: Math.ceil(base), pricingVersion: FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s`, resolution: res } };
}

// LTX V2 pricing (Image-to-Video)
function computeLtxCredits(req: Request, variant: 'Pro' | 'Fast'): { cost: number; pricingVersion: string; meta: Record<string, any> } {
  const { duration, resolution } = (req as any).body || {};
  const dur = String(duration ?? '8');
  const resIn = String(resolution || '1080p').toLowerCase();
  const res = resIn.includes('2160') ? '2160p' : resIn.includes('1440') ? '1440p' : '1080p';
  const display = `LTX V2 ${variant} ${dur}s ${res}`;
  const base = findCredits(display);
  if (base == null) throw new Error(`Unsupported LTX V2 ${variant} pricing`);
  return { cost: Math.ceil(base), pricingVersion: FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s`, resolution: res } };
}

export async function computeFalLtxV2ProI2vSubmitCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  return computeLtxCredits(req, 'Pro');
}

export async function computeFalLtxV2FastI2vSubmitCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  return computeLtxCredits(req, 'Fast');
}

// LTX V2 pricing (Text-to-Video) mirrors I2V
export async function computeFalLtxV2ProT2vSubmitCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> { return computeLtxCredits(req, 'Pro'); }
export async function computeFalLtxV2FastT2vSubmitCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> { return computeLtxCredits(req, 'Fast'); }

// Sora 2 Video-to-Video Remix pricing: infer from source video history
export async function computeFalSora2RemixSubmitCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const uid = (req as any).uid as string;
  const { source_history_id, video_id } = req.body || {};
  let source: any = null;
  if (source_history_id) {
    source = await generationHistoryRepository.get(uid, String(source_history_id));
  } else if (video_id) {
    const found = await generationHistoryRepository.findBySoraVideoId(uid, String(video_id));
    source = found?.item;
  }
  if (!source) throw new Error('Cannot determine pricing: source Sora video not found');
  const dur = String((source as any)?.duration ?? '8');
  // Decide pro vs standard using model or resolution
  const srcModel = String((source as any)?.model || '').toLowerCase();
  const srcRes = String((source as any)?.resolution || '').toLowerCase();
  const isPro = srcModel.includes('/pro') || srcRes === '1080p';
  if (isPro) {
    const res = srcRes === '1080p' ? '1080p' : '720p';
    const display = `Sora 2 Pro ${dur}s ${res}`;
    const base = findCredits(display);
    if (base == null) throw new Error('Unsupported Sora 2 Pro remix pricing');
    return { cost: Math.ceil(base), pricingVersion: FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s`, resolution: res, remixOf: source.id } };
  }
  const display = dur.startsWith('4') ? 'Sora 2 4s' : (dur.startsWith('12') ? 'Sora 2 12s' : 'Sora 2 8s');
  const base = findCredits(display);
  if (base == null) throw new Error('Unsupported Sora 2 remix pricing');
  return { cost: Math.ceil(base), pricingVersion: FAL_PRICING_VERSION, meta: { model: display, duration: `${dur}s`, remixOf: source.id } };
}

export function computeFalVeoCostFromModel(model: string, meta?: any): { cost: number; pricingVersion: string; meta: Record<string, any> } {
  // Default to 8s variants based on model path
  const normalized = model.toLowerCase();
  let display = '';
  if (normalized === 'fal-ai/veo3') display = 'veo3 t2v 8s';
  else if (normalized === 'fal-ai/veo3/fast') display = 'veo3 fast t2v 8s';
  else if (normalized === 'fal-ai/veo3/image-to-video') display = 'veo3 i2v 8s';
  else if (normalized === 'fal-ai/veo3/fast/image-to-video') display = 'veo3 fast i2v 8s';
  else if (normalized === 'fal-ai/veo3.1') display = 'Veo 3.1 T2V 8s';
  else if (normalized === 'fal-ai/veo3.1/fast') display = 'Veo 3.1 Fast T2V 8s';
  else if (normalized === 'fal-ai/veo3.1/image-to-video') display = 'Veo 3.1 I2V 8s';
  else if (normalized === 'fal-ai/veo3.1/fast/image-to-video') display = 'Veo 3.1 Fast I2V 8s';
  else if (normalized === 'fal-ai/veo3.1/first-last-frame-to-video') display = 'Veo 3.1 I2V 8s';
  else if (normalized === 'fal-ai/veo3.1/reference-to-video') display = 'Veo 3.1 I2V 8s';
  // Sora 2 mapping using stored meta for duration/resolution
  else if (normalized === 'fal-ai/sora-2/image-to-video') {
    const dur = String(meta?.duration ?? '8');
    if (dur.startsWith('4')) display = 'Sora 2 4s';
    else if (dur.startsWith('12')) display = 'Sora 2 12s';
    else display = 'Sora 2 8s';
  } else if (normalized === 'fal-ai/sora-2/image-to-video/pro') {
    const dur = String(meta?.duration ?? '8');
    const res = String(meta?.resolution ?? '720p').toLowerCase() === '1080p' ? '1080p' : '720p';
    display = `Sora 2 Pro ${dur}s ${res}`;
  } else if (normalized === 'fal-ai/sora-2/text-to-video') {
    const dur = String(meta?.duration ?? '8');
    if (dur.startsWith('4')) display = 'Sora 2 4s';
    else if (dur.startsWith('12')) display = 'Sora 2 12s';
    else display = 'Sora 2 8s';
  } else if (normalized === 'fal-ai/sora-2/text-to-video/pro') {
    const dur = String(meta?.duration ?? '8');
    const res = String(meta?.resolution ?? '720p').toLowerCase() === '1080p' ? '1080p' : '720p';
    display = `Sora 2 Pro ${dur}s ${res}`;
  } else if (normalized === 'fal-ai/sora-2/video-to-video/remix') {
    // Remix cost equals source Sora SKU; rely on stored source_* meta saved at submission time
    const dur = String(meta?.source_duration ?? meta?.duration ?? '8');
    const res = String(meta?.source_resolution ?? meta?.resolution ?? '720p').toLowerCase();
    const isPro = String(meta?.source_is_pro ?? '').toLowerCase() === 'true' || res === '1080p';
    if (isPro) display = `Sora 2 Pro ${dur}s ${res === '1080p' ? '1080p' : '720p'}`;
    else display = dur.startsWith('4') ? 'Sora 2 4s' : (dur.startsWith('12') ? 'Sora 2 12s' : 'Sora 2 8s');
  } else if (normalized === 'fal-ai/ltxv-2/image-to-video') {
    const dur = String(meta?.duration ?? '8');
    const resIn = String(meta?.resolution || '1080p').toLowerCase();
    const res = resIn.includes('2160') ? '2160p' : resIn.includes('1440') ? '1440p' : '1080p';
    display = `LTX V2 Pro ${dur}s ${res}`;
  } else if (normalized === 'fal-ai/ltxv-2/image-to-video/fast') {
    const dur = String(meta?.duration ?? '8');
    const resIn = String(meta?.resolution || '1080p').toLowerCase();
    const res = resIn.includes('2160') ? '2160p' : resIn.includes('1440') ? '1440p' : '1080p';
    display = `LTX V2 Fast ${dur}s ${res}`;
  } else if (normalized === 'fal-ai/ltxv-2/text-to-video') {
    const dur = String(meta?.duration ?? '8');
    const resIn = String(meta?.resolution || '1080p').toLowerCase();
    const res = resIn.includes('2160') ? '2160p' : resIn.includes('1440') ? '1440p' : '1080p';
    display = `LTX V2 Pro ${dur}s ${res}`;
  } else if (normalized === 'fal-ai/ltxv-2/text-to-video/fast') {
    const dur = String(meta?.duration ?? '8');
    const resIn = String(meta?.resolution || '1080p').toLowerCase();
    const res = resIn.includes('2160') ? '2160p' : resIn.includes('1440') ? '1440p' : '1080p';
    display = `LTX V2 Fast ${dur}s ${res}`;
  }
  const base = display ? findCredits(display) : null;
  if (base == null) throw new Error('Unsupported FAL Veo model');
  return { cost: Math.ceil(base), pricingVersion: FAL_PRICING_VERSION, meta: { model: display } };
}


