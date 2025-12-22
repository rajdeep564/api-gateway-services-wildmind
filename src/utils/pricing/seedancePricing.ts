import type { Request } from 'express';
import { creditDistributionData } from '../../data/creditDistribution';

export const SEEDANCE_PRICING_VERSION = 'seedance-v1';

function normalizeDuration(d: any): 5|10|undefined {
  if (d == null) return undefined;
  const num = Number(d);
  if (isNaN(num)) {
    const s = String(d).toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? (Number(m[1]) as 5|10) : undefined;
  }
  // Map duration: 2-6s -> 5s, 7-12s -> 10s
  if (num >= 2 && num <= 6) return 5;
  if (num >= 7 && num <= 12) return 10;
  return undefined;
}

function normalizeResolution(r: any): '480p'|'720p'|'1080p'|undefined {
  if (!r) return undefined;
  const s = String(r).toLowerCase();
  if (s.includes('480')) return '480p';
  if (s.includes('720')) return '720p';
  if (s.includes('1080')) return '1080p';
  return undefined;
}

export async function computeSeedanceVideoCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }>{
  const { model, mode, kind, duration, resolution } = (req.body || {}) as any;
  const selectedMode = (String(kind || mode || '').toLowerCase() === 'i2v') ? 'i2v' : 't2v';
  const dur = normalizeDuration(duration);
  const res = normalizeResolution(resolution);
  const modelStr = String(model || '').toLowerCase();
  
  // Determine tier: check for pro-fast first, then lite, then default to Pro
  let tier: string;
  if (modelStr.includes('pro-fast') || modelStr.includes('pro_fast')) {
    tier = 'Pro Fast';
  } else if (modelStr.includes('lite')) {
    tier = 'Lite';
  } else {
    tier = 'Pro';
  }

  if (!dur || !res) {
    throw new Error('Seedance pricing: duration and resolution are required');
  }

  // For Pro Fast, the model name format is "Seedance 1.0 Pro Fast T2V/I2V {dur}s {res}"
  // For Lite and Pro, the format is "Seedance 1.0 {tier} {mode} {dur}s {res}"
  let display: string;
  if (tier === 'Pro Fast') {
    display = `Seedance 1.0 Pro Fast T2V/I2V ${dur}s ${res}`;
  } else {
    display = `Seedance 1.0 ${tier} ${selectedMode.toUpperCase()} ${dur}s ${res}`;
  }
  
  const row = creditDistributionData.find(m => m.modelName === display);
  if (!row) {
    throw new Error(`Unsupported Seedance pricing for "${display}". Please add this SKU to creditDistribution.`);
  }
  return { cost: Math.ceil(row.creditsPerGeneration), pricingVersion: SEEDANCE_PRICING_VERSION, meta: { model: display, duration: dur, resolution: res, tier } };
}

export function computeSeedanceCostFromSku(sku: string): { cost: number; pricingVersion: string; meta: Record<string, any> }{
  const row = creditDistributionData.find(m => m.modelName === sku);
  if (!row) throw new Error(`Unsupported Seedance pricing for "${sku}"`);
  return { cost: Math.ceil(row.creditsPerGeneration), pricingVersion: SEEDANCE_PRICING_VERSION, meta: { model: sku } };
}
