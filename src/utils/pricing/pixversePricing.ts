import type { Request } from 'express';
import { creditDistributionData } from '../../data/creditDistribution';

export const PIXVERSE_PRICING_VERSION = 'pixverse-v1';

function normDuration(d: any): '5s'|'8s'|'' {
  if (d == null) return '';
  const s = String(d).trim().toLowerCase();
  const m = s.match(/(5|8)/);
  return m ? (m[1] + 's') as any : '';
}

function normQuality(q: any): '360p'|'540p'|'720p'|'1080p'|'' {
  if (!q) return '';
  const s = String(q).trim().toLowerCase();
  const m = s.match(/(360|540|720|1080)/);
  return m ? ((m[1] + 'p') as any) : '';
}

function findCreditsExact(name: string): number | null {
  const row = creditDistributionData.find(m => m.modelName.toLowerCase() === name.toLowerCase());
  return row?.creditsPerGeneration ?? null;
}

function resolveDisplay(kind: 't2v'|'i2v', duration: any, qualityOrResolution: any): string {
  const d = normDuration(duration);
  const q = normQuality(qualityOrResolution);
  const parts = ['PixVerse 5', kind.toUpperCase(), d, q].filter(Boolean);
  return parts.join(' ').trim();
}

export async function computePixverseVideoCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }>{
  const { mode, kind, type, duration, quality, resolution } = (req.body || {}) as any;
  const raw = String(mode || kind || type || '').toLowerCase();
  const selected: 't2v'|'i2v'|'' = raw === 'i2v' ? 'i2v' : (raw === 't2v' || raw.length === 0 ? 't2v' : '');
  if (!selected) throw new Error('PixVerse pricing: mode must be one of t2v|i2v');
  const disp = resolveDisplay(selected, duration, quality || resolution);
  const base = findCreditsExact(disp);
  if (base == null) {
    throw new Error(`Unsupported PixVerse pricing for "${disp}". Please add the SKU to creditDistribution.`);
  }
  const dur = normDuration(duration);
  const qual = normQuality(quality || resolution);
  return { cost: Math.ceil(base), pricingVersion: PIXVERSE_PRICING_VERSION, meta: { model: disp, duration: dur || undefined, resolution: qual || undefined } };
}

export function computePixverseCostFromSku(sku: string): { cost: number; pricingVersion: string; meta: Record<string, any> }{
  const base = findCreditsExact(sku);
  if (base == null) throw new Error('Unsupported PixVerse SKU');
  return { cost: Math.ceil(base), pricingVersion: PIXVERSE_PRICING_VERSION, meta: { model: sku } };
}
