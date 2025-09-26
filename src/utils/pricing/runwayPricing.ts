import { Request } from 'express';
import { creditDistributionData } from '../../data/creditDistribution';

export const RUNWAY_PRICING_VERSION = 'runway-v1';

function findCreditsExact(name: string): number | null {
  const row = creditDistributionData.find(m => m.modelName.toLowerCase() === name.toLowerCase());
  return row?.creditsPerGeneration ?? null;
}

export async function computeRunwayImageCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { model, sku } = req.body || {};
  let display = '';
  if (typeof sku === 'string' && sku.length > 0) {
    display = sku;
  } else {
    if (model === 'gen4_image') display = 'Runway Gen 4 Image 720p';
    else if (model === 'gen4_image_turbo') display = 'Runway Gen 4 Image Turbo';
  }
  const base = display ? findCreditsExact(display) : null;
  if (base == null) throw new Error('Unsupported Runway image model');
  const cost = Math.ceil(base * 1);
  return { cost, pricingVersion: RUNWAY_PRICING_VERSION, meta: { model: display } };
}

export function computeRunwayCostFromHistoryModel(historyModel: string): { cost: number; pricingVersion: string; meta: Record<string, any> } {
  let display = '';
  if (historyModel === 'gen4_image') display = 'Runway Gen 4 Image 720p';
  else if (historyModel === 'gen4_image_turbo') display = 'Runway Gen 4 Image Turbo';
  const base = display ? findCreditsExact(display) : null;
  if (base == null) throw new Error('Unsupported Runway image history model');
  return { cost: Math.ceil(base), pricingVersion: RUNWAY_PRICING_VERSION, meta: { model: display } };
}

export function computeRunwayCostFromSku(sku: string): { cost: number; pricingVersion: string; meta: Record<string, any> } {
  const base = findCreditsExact(sku);
  if (base == null) throw new Error('Unsupported Runway SKU');
  return { cost: Math.ceil(base), pricingVersion: RUNWAY_PRICING_VERSION, meta: { model: sku } };
}

export async function computeRunwayVideoCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { sku } = req.body || {};
  if (typeof sku !== 'string' || sku.length === 0) throw new Error('sku is required for Runway video pricing');
  return computeRunwayCostFromSku(sku);
}


