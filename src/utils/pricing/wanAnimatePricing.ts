import { Request } from 'express';

/**
 * Compute cost for WAN 2.2 Animate Replace
 * Pricing: $3 per 1000 seconds of runtime = $0.003 per second
 * Overcharge: $0.001 per second
 * Total: $0.004 per second = 0.4 credits per second
 * We'll round up to 1 credit per second for simplicity and safety
 */
export async function computeWanAnimateReplaceCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const b = (req.body || {}) as Record<string, any>;
  
  // Estimate runtime based on input video duration
  // Default to 5 seconds if not specified (will be adjusted after generation)
  const estimatedRuntime = b.estimated_runtime || b.runtime || b.video_duration || 5;
  const runtimeSeconds = typeof estimatedRuntime === 'number' ? estimatedRuntime : parseFloat(String(estimatedRuntime)) || 5;
  
  // $0.004 per second = 0.4 credits per second, rounded up to 1 credit per second for simplicity
  const costPerSecond = 1;
  const totalCost = Math.ceil(runtimeSeconds * costPerSecond);
  
  // Minimum cost of 1 credit (for 1 second)
  const finalCost = Math.max(1, totalCost);
  
  return {
    cost: finalCost,
    pricingVersion: 'wan-animate-replace-v1',
    meta: {
      model: 'wan-2.2-animate-replace',
      estimatedRuntime: runtimeSeconds,
      costPerSecond,
    },
  };
}

