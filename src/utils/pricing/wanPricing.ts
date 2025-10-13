import { Request } from 'express';
import { creditDistributionData } from '../../data/creditDistribution';

// Version tag for Wan 2.5 pricing logic
export const WAN_PRICING_VERSION = 'wan-v1';

function findCreditsExact(name: string): number | null {
  const row = creditDistributionData.find(m => m.modelName.toLowerCase() === name.toLowerCase());
  return row?.creditsPerGeneration ?? null;
}

function normalizeDuration(d: any): string {
  // Accept 5 | '5' | '5s' etc. Return like '5s'
  if (d == null) return '';
  const s = String(d).trim().toLowerCase();
  if (!s) return '';
  const m = s.match(/(\d+)/);
  if (!m) return '';
  return `${m[1]}s`;
}

function normalizeResolution(r: any): string {
  // Accept 480 | '480' | '480p' | 720 | '720p' | 1080 | '1080p'
  if (r == null) return '';
  const s = String(r).trim().toLowerCase();
  if (!s) return '';
  const m = s.match(/(480|720|1080)/);
  if (!m) return '';
  return `${m[1]}p`;
}

function resolveWanDisplay(kind: 't2v' | 'i2v', duration?: any, resolution?: any, isFast?: boolean): string {
  const d = normalizeDuration(duration);
  const r = normalizeResolution(resolution);
  const prefix = isFast ? 'Wan 2.5 Fast' : 'Wan 2.5';
  // e.g. "Wan 2.5 T2V 10s 720p" or "Wan 2.5 Fast I2V 5s 1080p"
  const parts = [prefix, kind.toUpperCase(), d, r].filter(Boolean);
  return parts.join(' ').trim();
}

export async function computeWanVideoCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { mode, kind, type, duration, resolution, speed, model } = (req.body || {}) as Record<string, any>;
  // Accept either `mode` or `kind` or `type` as selector; prefer explicit t2v/i2v
  const raw = (mode || kind || type || '').toString().trim().toLowerCase();
  const isT2v = raw === 't2v' || raw === 'text-to-video' || raw === 'text_to_video' || raw === 'text2video';
  const isI2v = raw === 'i2v' || raw === 'image-to-video' || raw === 'image_to_video' || raw === 'img2video' || raw === 'image2video';
  const selected: 't2v' | 'i2v' | '' = isT2v ? 't2v' : isI2v ? 'i2v' : '';
  if (!selected) {
    throw new Error('Wan 2.5 pricing: mode is required and must be one of t2v|i2v');
  }

  const isFast = (() => {
    const s = (speed ?? '').toString().toLowerCase();
    const m = (model ?? '').toString().toLowerCase();
    const speedFast = s === 'fast' || s === 'true' || s.includes('fast') || speed === true;
    const modelFast = m.includes('fast');
    return speedFast || modelFast;
  })();
  const display = resolveWanDisplay(selected, duration, resolution, isFast);
  const base = findCreditsExact(display);
  if (base == null) {
    // Try fallback to base kind only if specific SKU not present yet
    const fallback = findCreditsExact(`${isFast ? 'Wan 2.5 Fast' : 'Wan 2.5'} ${selected.toUpperCase()}`);
    if (fallback == null) {
      throw new Error(`Unsupported Wan 2.5 pricing for "${display}". Please add this SKU to creditDistribution.`);
    }
    return { cost: Math.ceil(fallback), pricingVersion: WAN_PRICING_VERSION, meta: { model: `${isFast ? 'Wan 2.5 Fast' : 'Wan 2.5'} ${selected.toUpperCase()}`, duration: normalizeDuration(duration) || undefined, resolution: normalizeResolution(resolution) || undefined, fast: isFast || undefined } };
  }
  return { cost: Math.ceil(base), pricingVersion: WAN_PRICING_VERSION, meta: { model: display, duration: normalizeDuration(duration) || undefined, resolution: normalizeResolution(resolution) || undefined, fast: isFast || undefined } };
}

export function computeWanCostFromSku(sku: string): { cost: number; pricingVersion: string; meta: Record<string, any> } {
  const base = findCreditsExact(sku);
  if (base == null) throw new Error('Unsupported Wan 2.5 SKU');
  return { cost: Math.ceil(base), pricingVersion: WAN_PRICING_VERSION, meta: { model: sku } };
}
