import * as replicateService from '../../replicateService';
import { uploadFromUrlToZata, uploadDataUriToZata } from '../../../utils/storage/zataUpload';
import { ApiError } from '../../../utils/errorHandler';
import { env } from '../../../config/env';

export interface RemoveBackgroundRequest {
    imageUrl: string;
}

export interface RemoveBackgroundResponse {
    imageUrl: string;
    storagePath: string;
    historyId?: string;
}

/**
 * Remove background from an image using 851-labs/background-remover
 */
export async function removeBackground(
    uid: string,
    request: RemoveBackgroundRequest
): Promise<RemoveBackgroundResponse> {
    const { imageUrl } = request;

    if (!imageUrl) {
        throw new ApiError('Image URL is required', 400);
    }

    // Helper to resolve public URL for Replicate
    async function resolvePublicUrl(srcUrl: string, keyPrefix: string): Promise<{ url: string; storagePath?: string }> {
        try {
            const ZATA_PREFIX = env.zataPrefix ? (env.zataPrefix || '').replace(/\/$/, '') + '/' : '';

            // 1) Data URI
            if (srcUrl.startsWith('data:')) {
                const stored = await uploadDataUriToZata({
                    dataUri: srcUrl,
                    keyPrefix,
                    fileName: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                });
                return { url: stored.publicUrl, storagePath: (stored as any).key };
            }

            // 2) Already Zata URL
            if (ZATA_PREFIX && srcUrl.startsWith(ZATA_PREFIX)) {
                return { url: srcUrl, storagePath: srcUrl.substring(ZATA_PREFIX.length) };
            }

            // 3) Frontend proxy path
            const RESOURCE_SEG = '/api/proxy/resource/';
            if (srcUrl.includes(RESOURCE_SEG)) {
                const path = srcUrl.split(RESOURCE_SEG)[1];
                if (path) {
                    const storagePath = decodeURIComponent(path);
                    if (ZATA_PREFIX) {
                        return { url: `${ZATA_PREFIX}${storagePath}`, storagePath };
                    }
                }
            }

            // 4) External URL - try upload to ensure stability/public access
            // (Replicate needs a public URL. If it's a localhost URL, it won't work unless proxied)
            try {
                const stored = await uploadFromUrlToZata({
                    sourceUrl: srcUrl,
                    keyPrefix,
                    fileName: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                });
                return { url: stored.publicUrl, storagePath: (stored as any).key };
            } catch (e) {
                // Fallback to original if upload fails (might work if it's already public)
                return { url: srcUrl };
            }
        } catch (e) {
            return { url: srcUrl } as any;
        }
    }

    const resolvedInput = await resolvePublicUrl(imageUrl, `users/${uid}/workflows/general/remove-bg/input`);

    const replicatePayload: any = {
        model: '851-labs/background-remover',
        image: resolvedInput.url,
        prompt: 'remove background', // Added prompt as required by model/service wrapper
        // format: 'png', // Model usually defaults to png for transparency
        storageKeyPrefixOverride: `users/${uid}/workflows/general/remove-bg`,
        isPublic: true, // User requested isPublic: true
    };

    console.log('[removeBackgroundService] Submitting to Replicate:', {
        model: replicatePayload.model,
        imageUrl: resolvedInput.url.substring(0, 50) + '...'
    });

    try {
        const result: any = await replicateService.removeBackground(uid, replicatePayload);

        if (!result.images || result.images.length === 0) {
            throw new ApiError('No image generated from background remover service', 500);
        }

        const generatedImage = result.images[0];
        let finalImageUrl = generatedImage.url || generatedImage.originalUrl;
        let storagePath = (generatedImage as any).storagePath || '';

        // Ensure result is in Zata
        if (!storagePath || !finalImageUrl.includes('/users/')) {
            const zataResult = await uploadFromUrlToZata({
                sourceUrl: finalImageUrl,
                keyPrefix: `users/${uid}/workflows/general/remove-bg`,
                fileName: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            });
            finalImageUrl = zataResult.publicUrl;
            storagePath = zataResult.key;
        }

        return {
            imageUrl: finalImageUrl,
            storagePath,
            historyId: result?.historyId,
        };

    } catch (error: any) {
        console.error('[removeBackgroundService] Error:', error);
        throw new ApiError(
            `Failed to remove background: ${error.message || 'Unknown error'}`,
            error.statusCode || 500
        );
    }
}
