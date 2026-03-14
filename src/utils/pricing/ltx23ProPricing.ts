import type { Request } from 'express';

export const LTX_23_PRO_PRICING_VERSION = 'ltx-2.3-pro-v1';

function normalizeDuration(d: any): 6 | 8 | 10 {
  const num = Number(d);
  if (!Number.isFinite(num) || num <= 6) return 6;
  if (num <= 8) return 8;
  return 10;
}

function normalizeResolution(r: any): '1080p' | '2k' | '4k' {
  const s = String(r || '1080p').toLowerCase();
  if (s.includes('4k') || s.includes('2160')) return '4k';
  if (s.includes('2k') || s.includes('1440')) return '2k';
  return '1080p';
}

export async function computeLtx23ProVideoCost(
  req: Request
): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const body = (req.body || {}) as any;
  const duration = normalizeDuration(body.duration);
  const resolution = normalizeResolution(body.resolution);

  const table: Record<'1080p' | '2k' | '4k', Record<6 | 8 | 10, number>> = {
    '1080p': { 6: 780, 8: 1020, 10: 1260 },
    '2k': { 6: 1500, 8: 1980, 10: 2460 },
    '4k': { 6: 2940, 8: 3900, 10: 4860 },
  };

  const cost = table[resolution][duration];
  return {
    cost,
    pricingVersion: LTX_23_PRO_PRICING_VERSION,
    meta: {
      model: `LTX 2.3 Pro T2V/I2V ${duration}s ${resolution}`,
      duration,
      resolution,
    },
  };
}
