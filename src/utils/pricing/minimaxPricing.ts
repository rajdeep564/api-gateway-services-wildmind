import { Request } from 'express';
import { creditDistributionData } from '../../data/creditDistribution';

export const MINIMAX_PRICING_VERSION = 'minimax-v1';

function findCreditsExact(name: string): number | null {
  const row = creditDistributionData.find(m => m.modelName.toLowerCase() === name.toLowerCase());
  return row?.creditsPerGeneration ?? null;
}

export async function computeMinimaxImageCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { n = 1 } = req.body || {};
  const base = findCreditsExact('Minimax Image-01');
  if (base == null) throw new Error('Unsupported Minimax image');
  const count = Math.max(1, Math.min(10, Number(n)));
  const cost = Math.ceil(base * count);
  return { cost, pricingVersion: MINIMAX_PRICING_VERSION, meta: { model: 'Minimax Image-01', n: count } };
}

export async function computeMinimaxMusicCost(_req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  // Try MiniMax Music 2 first, fallback to Music 1.5 for backward compatibility
  let base = findCreditsExact('MiniMax Music 2');
  if (base == null) base = findCreditsExact('Music 1.5 (Up to 90s)');
  if (base == null) throw new Error('Unsupported Minimax music');
  return { cost: Math.ceil(base), pricingVersion: MINIMAX_PRICING_VERSION, meta: { model: 'music-2.0' } };
}

export async function computeMinimaxVideoCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { model, duration, resolution } = req.body || {};
  let display = '';
  if (model === 'MiniMax-Hailuo-02') {
    const dur = String(duration || '').trim();
    const res = String(resolution || '').toUpperCase();
    if (res === '512P' && dur === '6') display = 'Minimax-Hailuo-02 512P 6s';
    else if (res === '512P' && dur === '10') display = 'Minimax-Hailuo-02 512P 10s';
    else if (res === '768P' && dur === '6') display = 'Minimax-Hailuo-02 768P 6s';
    else if (res === '768P' && dur === '10') display = 'Minimax-Hailuo-02 768P 10s';
    else if (res === '1080P' && dur === '6') display = 'Minimax-Hailuo-02 1080P 6s';
  } else if (model === 'MiniMax-Hailuo-2.3' || model === 'MiniMax-Hailuo-2.3-Fast') {
    // 2.3 pricing SKUs: differentiate Fast vs Standard for credits
    const dur = String(duration || '').trim();
    const res = String(resolution || '').toUpperCase();
    const fastPrefix = model === 'MiniMax-Hailuo-2.3-Fast' ? ' Fast' : '';
    if (res === '768P' && dur === '6') display = `Minimax-Hailuo-2.3${fastPrefix} 768P 6s`;
    else if (res === '768P' && dur === '10') display = `Minimax-Hailuo-2.3${fastPrefix} 768P 10s`;
    else if (res === '1080P' && dur === '6') display = `Minimax-Hailuo-2.3${fastPrefix} 1080P 6s`;
  } else if (model === 'T2V-01-Director') {
    display = 'T2V-01-Director';
  } else if (model === 'I2V-01-Director') {
    display = 'I2V-01-Director';
  } else if (model === 'S2V-01') {
    display = 'S2V-01';
  }
  // Try exact; if missing for 2.3, fallback to equivalent 02 SKU
  let base = display ? findCreditsExact(display) : null;
  if ((model === 'MiniMax-Hailuo-2.3' || model === 'MiniMax-Hailuo-2.3-Fast') && base == null) {
    const dur = String(duration || '').trim();
    const res = String(resolution || '').toUpperCase();
    if (res === '768P' && dur === '6') base = findCreditsExact('Minimax-Hailuo-02 768P 6s');
    else if (res === '768P' && dur === '10') base = findCreditsExact('Minimax-Hailuo-02 768P 10s');
    else if (res === '1080P' && dur === '6') base = findCreditsExact('Minimax-Hailuo-02 1080P 6s');
  }
  if (base == null) throw new Error('Unsupported Minimax video');
  return { cost: Math.ceil(base), pricingVersion: MINIMAX_PRICING_VERSION, meta: { model: display, duration: duration ?? undefined, resolution: resolution ?? undefined } };
}

export async function computeMinimaxVideoCostFromParams(model: any, duration?: any, resolution?: any): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }>{
  let display = '';
  if (model === 'MiniMax-Hailuo-02') {
    const dur = String(duration || '').trim();
    const res = String(resolution || '').toUpperCase();
    if (res === '512P' && dur === '6') display = 'Minimax-Hailuo-02 512P 6s';
    else if (res === '512P' && dur === '10') display = 'Minimax-Hailuo-02 512P 10s';
    else if (res === '768P' && dur === '6') display = 'Minimax-Hailuo-02 768P 6s';
    else if (res === '768P' && dur === '10') display = 'Minimax-Hailuo-02 768P 10s';
    else if (res === '1080P' && dur === '6') display = 'Minimax-Hailuo-02 1080P 6s';
  } else if (model === 'MiniMax-Hailuo-2.3' || model === 'MiniMax-Hailuo-2.3-Fast') {
    const dur = String(duration || '').trim();
    const res = String(resolution || '').toUpperCase();
    const fastPrefix = model === 'MiniMax-Hailuo-2.3-Fast' ? ' Fast' : '';
    if (res === '768P' && dur === '6') display = `Minimax-Hailuo-2.3${fastPrefix} 768P 6s`;
    else if (res === '768P' && dur === '10') display = `Minimax-Hailuo-2.3${fastPrefix} 768P 10s`;
    else if (res === '1080P' && dur === '6') display = `Minimax-Hailuo-2.3${fastPrefix} 1080P 6s`;
  } else if (model === 'T2V-01-Director') {
    display = 'T2V-01-Director';
  } else if (model === 'I2V-01-Director') {
    display = 'I2V-01-Director';
  } else if (model === 'S2V-01') {
    display = 'S2V-01';
  }
  let base = display ? findCreditsExact(display) : null;
  if ((model === 'MiniMax-Hailuo-2.3' || model === 'MiniMax-Hailuo-2.3-Fast') && base == null) {
    const dur = String(duration || '').trim();
    const res = String(resolution || '').toUpperCase();
    if (res === '768P' && dur === '6') base = findCreditsExact('Minimax-Hailuo-02 768P 6s');
    else if (res === '768P' && dur === '10') base = findCreditsExact('Minimax-Hailuo-02 768P 10s');
    else if (res === '1080P' && dur === '6') base = findCreditsExact('Minimax-Hailuo-02 1080P 6s');
  }
  if (base == null) throw new Error('Unsupported Minimax video');
  return { cost: Math.ceil(base), pricingVersion: MINIMAX_PRICING_VERSION, meta: { model: display, duration: duration ?? undefined, resolution: resolution ?? undefined } };
}


