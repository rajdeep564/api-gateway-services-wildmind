import { Request } from 'express';
import { PRICING_VERSION } from '../../data/creditDistribution';
import { bflutils } from '../bflutils';

export async function computeBflCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const { model, n = 1, frameSize, width, height, output_format } = req.body || {};

  const basePerImage = bflutils.getCreditsPerImage(model);
  if (basePerImage == null) {
    throw new Error('Unsupported model');
  }

  const count = Math.max(1, Math.min(10, Number(n)));
  // Charge based solely on model and count
  const cost = Math.ceil(basePerImage * count);
  const meta = { model, n: count, frameSize, width, height, output_format } as Record<string, any>;
  return { cost, pricingVersion: PRICING_VERSION, meta };
}

export async function computeBflFillCost(req: Request) {
  const basePerImage = bflutils.getCreditsPerImage('flux-pro-1.0-fill');
  if (basePerImage == null) throw new Error('Unsupported model');
  const cost = Math.ceil(basePerImage * 1);
  return { cost, pricingVersion: PRICING_VERSION, meta: { model: 'flux-pro-1.0-fill', n: 1 } };
}

export async function computeBflExpandCost(req: Request) {
  const basePerImage = bflutils.getCreditsPerImage('flux-pro-1.0-expand');
  if (basePerImage == null) throw new Error('Unsupported model');
  const cost = Math.ceil(basePerImage * 1);
  return { cost, pricingVersion: PRICING_VERSION, meta: { model: 'flux-pro-1.0-expand', n: 1 } };
}

export async function computeBflCannyCost(req: Request) {
  const basePerImage = bflutils.getCreditsPerImage('flux-pro-1.0-canny');
  if (basePerImage == null) throw new Error('Unsupported model');
  const cost = Math.ceil(basePerImage * 1);
  return { cost, pricingVersion: PRICING_VERSION, meta: { model: 'flux-pro-1.0-canny', n: 1 } };
}

export async function computeBflDepthCost(req: Request) {
  const basePerImage = bflutils.getCreditsPerImage('flux-pro-1.0-depth');
  if (basePerImage == null) throw new Error('Unsupported model');
  const cost = Math.ceil(basePerImage * 1);
  return { cost, pricingVersion: PRICING_VERSION, meta: { model: 'flux-pro-1.0-depth', n: 1 } };
}


