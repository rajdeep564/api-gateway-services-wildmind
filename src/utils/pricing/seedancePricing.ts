import type { Request } from 'express';
import { creditDistributionData } from '../../data/creditDistribution';

export const SEEDANCE_PRICING_VERSION = 'seedance-v1';

export const SEEDANCE_15_PRICING_VERSION = 'seedance-v1.5';

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

function normalizeSeedance15Duration(d: any): number | undefined {
  if (d == null) return undefined;
  const num = Number(d);
  if (Number.isFinite(num)) {
    const rounded = Math.round(num);
    if (rounded >= 2 && rounded <= 12) return rounded;
    return undefined;
  }
  const s = String(d).toLowerCase();
  const m = s.match(/(\d{1,2})/);
  if (!m) return undefined;
  const parsed = Number(m[1]);
  if (parsed >= 2 && parsed <= 12) return parsed;
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
  const { model, mode, kind, duration, resolution, generate_audio, generateAudio } = (req.body || {}) as any;
  const selectedMode = (String(kind || mode || '').toLowerCase() === 'i2v') ? 'i2v' : 't2v';
  const modelStr = String(model || '').toLowerCase();

  // Seedance 1.5 (Replicate) — duration 2-12, audio on/off SKUs
  if (modelStr.includes('seedance-1.5')) {
    const dur15 = normalizeSeedance15Duration(duration);
    if (!dur15) {
      throw new Error('Seedance 1.5 pricing: duration must be between 2 and 12 seconds');
    }
    const audioOn = Boolean((generate_audio ?? generateAudio) === true);
    const display = `Seedance 1.5 T2V/I2V Audio ${audioOn ? 'On' : 'Off'} ${dur15}s`;
    const row15 = creditDistributionData.find(m => m.modelName === display);
    if (!row15) {
      throw new Error(`Unsupported Seedance 1.5 pricing for "${display}". Please add this SKU to creditDistribution.`);
    }
    return {
      cost: Math.ceil(row15.creditsPerGeneration),
      pricingVersion: SEEDANCE_15_PRICING_VERSION,
      meta: { model: display, duration: dur15, audio: audioOn ? 'on' : 'off' },
    };
  }

  const dur = normalizeDuration(duration);
  const res = normalizeResolution(resolution);
  
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
