import { creditsRepository } from '../repository/creditsRepository';

/**
 * Estimates the file size of generated media.
 * Currently supports video duration-based estimation for Wan video.
 * @param type The type of media ('video')
 * @param options Options for estimation (duration, quality)
 * @returns Estimated size in bytes
 */
export function estimateFileSize(type: 'video', options: { duration: number, quality: string }): number {
    if (type === 'video') {
        const { duration, quality } = options;
        // Conservative estimate: ~2MB/s for 720p medium quality (standard for Wan video)
        const multiplier = quality === 'high' ? 5 : quality === 'medium' ? 2 : 1;
        return Math.ceil(duration * multiplier * 1024 * 1024); // Return bytes
    }
    return 1024 * 1024; // Default 1MB fallback
}

/**
 * Validates if the user has enough credits and potentially checks storage quota.
 * @param uid User ID
 * @param cost Credit cost of the generation
 * @param estimatedSize Estimated file size in bytes
 * @returns Object indicating if valid, with optional reason and error code
 */
export async function validateGenerationRequest(
    uid: string,
    cost: number,
    estimatedSize: number
): Promise<{ valid: boolean; reason?: string; code?: string }> {
    // 1. Check Credits
    // Note: replicateService.ts expects cost to be passed here.
    const balance = await creditsRepository.readUserCredits(uid);
    if (balance < cost) {
        return {
            valid: false,
            reason: 'Insufficient credits',
            code: 'INSUFFICIENT_CREDITS'
        };
    }

    // 2. Check Storage Quota (Threshold-based)
    // Based on the 'STORAGE_QUOTA_EXCEEDED' error code used in replicateService.ts
    // We'll use a conservative 5GB limit for single generations for now.
    const SINGLE_GEN_STORAGE_LIMIT = 5 * 1024 * 1024 * 1024; // 5GB limit per generation unit
    if (estimatedSize > SINGLE_GEN_STORAGE_LIMIT) {
        return {
            valid: false,
            reason: 'Estimated file size exceeds maximum allowed unit size',
            code: 'STORAGE_QUOTA_EXCEEDED'
        };
    }

    return { valid: true };
}
