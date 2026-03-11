import type { Request } from 'express';
import { creditDistributionData } from '../../data/creditDistribution';

export const LTX_23_FAST_PRICING_VERSION = 'ltx-2.3-fast-v1';

function normalizeDuration(d: any): number | undefined {
    if (d == null) return undefined;
    const num = Number(d);
    if (!Number.isFinite(num)) return undefined;
    const rounded = Math.round(num);
    if (rounded >= 2 && rounded <= 20) return rounded;
    return undefined;
}

function durationToBucket(d: number): 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20 {
    if (d <= 6) return 6;
    if (d <= 8) return 8;
    if (d <= 10) return 10;
    if (d <= 12) return 12;
    if (d <= 14) return 14;
    if (d <= 16) return 16;
    if (d <= 18) return 18;
    return 20;
}

function normalizeResolution(r: any): '1080p' | '2k' | '4k' | undefined {
    if (!r) return undefined;
    const s = String(r).toLowerCase();
    if (s.includes('4k') || s.includes('2160')) return '4k';
    if (s.includes('2k') || s.includes('1440')) return '2k';
    if (s.includes('1080')) return '1080p';
    return undefined;
}

export async function computeLtx23FastVideoCost(
    req: Request
): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
    const { duration, resolution } = (req.body || {}) as any;

    const dur = normalizeDuration(duration);
    const res = normalizeResolution(resolution) || '1080p';

    if (!dur) {
        throw new Error('LTX 2.3 Fast pricing: duration is required (2-20 seconds)');
    }

    const bucket = durationToBucket(dur);

    // Display name format: "LTX 2.3 Fast T2V/I2V {dur}s {res}"
    const display = `LTX 2.3 Fast T2V/I2V ${bucket}s ${res}`;

    const row = creditDistributionData.find((m: any) => m.modelName === display);
    if (!row) {
        throw new Error(
            `Unsupported LTX 2.3 Fast pricing for "${display}". Please add this SKU to creditDistribution.`
        );
    }

    return {
        cost: Math.ceil(row.creditsPerGeneration),
        pricingVersion: LTX_23_FAST_PRICING_VERSION,
        meta: { model: display, duration: bucket, resolution: res },
    };
}
