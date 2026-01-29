import type { Request } from 'express';

export async function computeWildmindImageCost(
  req: Request
): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const model = (req.body?.model || 'wildmindimage') as string;
  return {
    cost: 0,
    pricingVersion: 'wildmindimage-v1',
    meta: { model },
  };
}
