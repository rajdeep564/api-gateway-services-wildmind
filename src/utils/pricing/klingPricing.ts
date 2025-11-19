import { Request } from 'express';
import { creditDistributionData } from '../../data/creditDistribution';

export const KLING_PRICING_VERSION = 'kling-v1';

function findCreditsExact(name: string): number | null {
  const row = creditDistributionData.find(m => m.modelName.toLowerCase() === name.toLowerCase());
  return row?.creditsPerGeneration ?? null;
}

function normalizeDuration(d: any): string {
  if (d == null) return '';
  const s = String(d).trim().toLowerCase();
  const m = s.match(/(5|10)/);
  return m ? `${m[1]}s` : '';
}

function normalizeResolution(r: any): '720p' | '1080p' | '' {
  if (r == null) return '' as any;
  const s = String(r).trim().toLowerCase();
  if (s.includes('1080')) return '1080p';
  if (s.includes('720')) return '720p';
  return '' as any;
}

function resolveKind(body: any): 't2v' | 'i2v' | '' {
  const raw = (body.kind || body.type || body.mode || '').toString().trim().toLowerCase();
  if (raw === 't2v' || raw === 'text-to-video' || raw === 'text_to_video' || raw === 'text2video') return 't2v';
  if (raw === 'i2v' || raw === 'image-to-video' || raw === 'image_to_video' || raw === 'img2video' || raw === 'image2video') return 'i2v';
  // Fallback: infer from presence of image/start_image
  if (body.image || body.start_image) return 'i2v';
  if (body.prompt) return 't2v';
  return '';
}

export async function computeKlingVideoCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const b = (req.body || {}) as Record<string, any>;
  const model = (b.model || '').toString().toLowerCase();
  const kind = resolveKind(b);
  if (!kind) throw new Error('Kling pricing: mode is required and must be one of t2v|i2v');

  const dur = normalizeDuration(b.duration) || '5s';
  const meta: Record<string, any> = { duration: dur, kind };

  let sku = '';
  if (model.includes('kling-v2.5-turbo-pro')) {
    sku = `Kling 2.5 Turbo Pro ${kind.toUpperCase()} ${dur}`;
    meta.family = 'kling-2.5-turbo-pro';
  } else if (model.includes('kling-v2.1-master')) {
    sku = `Kling 2.1 Master ${kind.toUpperCase()} ${dur}`;
    meta.family = 'kling-2.1-master';
  } else if (model.includes('kling-v2.1')) {
    // v2.1 base: resolution determined by mode standard/pro or explicit resolution
    const res = ((): '720p' | '1080p' => {
      const tier = (b.kling_mode || b.video_mode || b.video_tier || b.quality || b.resolution || b.mode || '').toString().toLowerCase();
      if (tier === 'pro' || tier.includes('1080')) return '1080p';
      if (tier === 'standard' || tier.includes('720')) return '720p';
      const r2 = normalizeResolution(b.resolution);
      return (r2 || '720p') as any;
    })();
    sku = `Kling 2.1 ${kind.toUpperCase()} ${dur} ${res}`;
    meta.family = 'kling-2.1';
    meta.resolution = res;
  } else {
    // Default to 2.5 Turbo Pro if model not specified
    sku = `Kling 2.5 Turbo Pro ${kind.toUpperCase()} ${dur}`;
    meta.family = 'kling-2.5-turbo-pro';
  }

  const credits = findCreditsExact(sku);
  if (credits == null) {
    throw new Error(`Unsupported Kling pricing for "${sku}". Please add this SKU to creditDistribution.`);
  }
  return { cost: Math.ceil(credits), pricingVersion: KLING_PRICING_VERSION, meta };
}

export function computeKlingCostFromSku(sku: string): { cost: number; pricingVersion: string; meta: Record<string, any> } {
  const credits = findCreditsExact(sku);
  if (credits == null) throw new Error('Unsupported Kling SKU');
  return { cost: Math.ceil(credits), pricingVersion: KLING_PRICING_VERSION, meta: { model: sku } };
}

/**
 * Compute cost for Kling Lipsync
 * Pricing: $0.014 per second of output video (or ~71 seconds for $1)
 * We'll use a credit conversion: 1 credit = $0.01, so $0.014 per second = 1.4 credits per second
 * Round up to 2 credits per second for simplicity
 */
export async function computeKlingLipsyncCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const b = (req.body || {}) as Record<string, any>;
  
  // Kling Lipsync pricing is based on output video duration
  // Default to 5 seconds if not specified (will be adjusted after generation)
  // For pre-authorization, we'll estimate based on input video duration or default
  const estimatedDuration = b.estimated_duration || b.duration || 5;
  const durationSeconds = typeof estimatedDuration === 'number' ? estimatedDuration : parseInt(String(estimatedDuration), 10) || 5;
  
  // $0.014 per second = 1.4 credits per second, rounded up to 2 credits per second
  // This gives us a buffer and makes calculation simpler
  const costPerSecond = 2;
  const totalCost = Math.ceil(durationSeconds * costPerSecond);
  
  // Minimum cost of 2 credits (for 1 second)
  const finalCost = Math.max(2, totalCost);
  
  return {
    cost: finalCost,
    pricingVersion: 'kling-lipsync-v1',
    meta: {
      model: 'kling-lip-sync',
      estimatedDuration: durationSeconds,
      costPerSecond,
    },
  };
}