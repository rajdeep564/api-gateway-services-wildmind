import { Request } from 'express';

/**
 * Compute cost for WAN 2.2 Animate Animation
 * Pricing: $3 per 1000 seconds of runtime = $0.003 per second
 * Overcharge: $0.001 per second
 * Total: $0.004 per second
 * Credits: 8 credits per 1 second of input video
 */
export async function computeWanAnimateAnimationCost(req: Request): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  const b = (req.body || {}) as Record<string, any>;
  
  // Estimate runtime based on input video duration
  // Default to 5 seconds if not specified (will be adjusted after generation)
  const estimatedRuntime = b.video_duration ?? b.duration ?? b.estimated_runtime ?? b.runtime ?? 5;
  const runtimeSeconds = typeof estimatedRuntime === 'number' ? estimatedRuntime : parseFloat(String(estimatedRuntime)) || 5;

  // Billing rule: 8 credits per billed second, where billed seconds are rounded up.
  const costPerSecond = 8;
  const rounded = Math.round(runtimeSeconds);
  const snappedSeconds = (Number.isFinite(runtimeSeconds) && Math.abs(runtimeSeconds - rounded) <= 0.05)
    ? rounded
    : Math.ceil(runtimeSeconds);
  const billedSeconds = Math.max(1, snappedSeconds);
  const finalCost = billedSeconds * costPerSecond;
  
  return {
    cost: finalCost,
    pricingVersion: 'wan-animate-animation-v2',
    meta: {
      model: 'wan-2.2-animate-animation',
      estimatedRuntime: runtimeSeconds,
      billedSeconds,
      costPerSecond,
    },
  };
}

