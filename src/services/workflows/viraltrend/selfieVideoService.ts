import * as replicateService from '../../replicateService';
import { uploadFromUrlToZata, uploadDataUriToZata } from '../../../utils/storage/zataUpload';
import { ApiError } from '../../../utils/errorHandler';
import { env } from '../../../config/env';

export interface GenerateSelfieVideoImageRequest {
    selfieImageUrl: string;
    friendImageUrl: string;
    frameSize: 'vertical' | 'horizontal';
    customBackground?: string;
    customClothes?: string;
}

interface GenerateSelfieVideoImageResponse {
    imageUrl: string;
    storagePath: string;
    historyId?: string;
}

/**
 * Generate a merged image of selfie and friend using Seedream v4 (4K)
 */
export async function generateSelfieVideoImage(
    uid: string,
    request: GenerateSelfieVideoImageRequest
): Promise<GenerateSelfieVideoImageResponse> {
    const { selfieImageUrl, friendImageUrl, frameSize, customBackground, customClothes } = request;

    // Validate inputs
    if (!selfieImageUrl || !friendImageUrl) {
        throw new ApiError('Both selfie and friend image URLs are required', 400);
    }

    // Normalize input image URLs so the upstream image model can access them publicly
    async function resolvePublicUrl(srcUrl: string, keyPrefix: string): Promise<{ url: string; storagePath?: string }> {
        try {
            const ZATA_PREFIX = env.zataPrefix ? (env.zataPrefix || '').replace(/\/$/, '') + '/' : '';
            // 1) Data URI: persist to Zata
            if (srcUrl.startsWith('data:')) {
                const stored = await uploadDataUriToZata({
                    dataUri: srcUrl,
                    keyPrefix,
                    fileName: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                });
                return { url: stored.publicUrl, storagePath: (stored as any).key };
            }
            // 2) Already a Zata public URL
            if (ZATA_PREFIX && srcUrl.startsWith(ZATA_PREFIX)) {
                return { url: srcUrl, storagePath: srcUrl.substring(ZATA_PREFIX.length) };
            }
            // 3) Frontend proxied resource: /api/proxy/resource/<encoded storage path>
            const RESOURCE_SEG = '/api/proxy/resource/';
            try {
                const u = new URL(srcUrl, 'http://local.placeholder'); // base to support relative paths
                const path = u.pathname || '';
                if (path.startsWith(RESOURCE_SEG)) {
                    const encoded = path.substring(RESOURCE_SEG.length);
                    const storagePath = decodeURIComponent(encoded);
                    if (ZATA_PREFIX) {
                        const publicUrl = `${ZATA_PREFIX}${storagePath}`;
                        return { url: publicUrl, storagePath };
                    }
                    console.warn('[selfieVideoService] ZATA_PREFIX not configured; cannot convert proxy path to public URL', srcUrl);
                    return { url: srcUrl };
                }
            } catch {
                // If URL constructor fails, fall back to direct string checks
                if (srcUrl.startsWith(RESOURCE_SEG)) {
                    const encoded = srcUrl.substring(RESOURCE_SEG.length);
                    const storagePath = decodeURIComponent(encoded);
                    if (env.zataPrefix) {
                        const publicUrl = `${(env.zataPrefix || '').replace(/\/$/, '')}/${storagePath}`;
                        return { url: publicUrl, storagePath };
                    }
                    console.warn('[selfieVideoService] ZATA_PREFIX not configured; cannot convert proxy path to public URL', srcUrl);
                    return { url: srcUrl } as any;
                }
            }
            // 4) Generic external/public URL: attempt upload to Zata for stability; if it fails, return original URL
            try {
                const stored = await uploadFromUrlToZata({
                    sourceUrl: srcUrl,
                    keyPrefix,
                    fileName: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                });
                return { url: stored.publicUrl, storagePath: (stored as any).key };
            } catch (e) {
                console.warn('[selfieVideoService] Failed to upload input URL to Zata, using original URL', (e as any)?.message || e);
                return { url: srcUrl };
            }
        } catch (e) {
            console.warn('[selfieVideoService] resolvePublicUrl failed, using original URL', (e as any)?.message || e);
            return { url: srcUrl } as any;
        }
    }

    // Build prompt based on custom background, clothes, and frame size
    const backgroundDescription = customBackground
        ? `in ${customBackground}`
        : 'matching the background and environment of the second image (friend photo), keeping the same setting and scene from that reference';

    const clothesDescription = customClothes
        ? ` Both people should be dressed in ${customClothes}, and this clothing style must be applied consistently to everyone in the scene while still preserving their faces and body shapes.`
        : '';

    const frameSizeDescription = frameSize === 'vertical'
        ? 'portrait-oriented, suitable for social media stories'
        : 'landscape-oriented, suitable for wide-screen viewing';
    const prompt = `Create a realistic photo of TWO people: the first person (from the first image) and the second person (from the second image) ${backgroundDescription}. The scene must clearly show that ONLY the first person is taking the selfie, using a natural arm-extended selfie pose similar to a real-life selfie. The second person is simply standing close beside them.${clothesDescription}

No phone, no camera, no selfie stick, and no device reflections anywhere. The first person’s arm may be visible in a natural selfie position, but no device should appear.

Both people should lean slightly toward each other, look directly at the camera, and have friendly, relaxed expressions. Strictly preserve the identities, facial features, skin tone, hair, and overall appearance of both people from their reference images.

The composition should be ${frameSizeDescription}. Use natural lighting, sharp focus on faces, realistic depth of field, and true-to-life colors for a candid, believable selfie-style photo.`;

    // Determine aspect ratio based on frame size for image models
    // Use 2:3 for vertical (portrait) and 3:2 for horizontal (landscape) for gpt-1.5-image
    const aspectRatio: '2:3' | '3:2' = frameSize === 'vertical' ? '2:3' : '3:2';

    // Prepare Replicate service payload (ensure inputs are publicly accessible)
    const [selfieResolved, friendResolved] = await Promise.all([
        resolvePublicUrl(selfieImageUrl, `users/${uid}/workflows/selfie-video/input/1`),
        resolvePublicUrl(friendImageUrl, `users/${uid}/workflows/selfie-video/input/2`),
    ]);

    const replicatePayload: any = {
        model: 'openai/gpt-image-1.5',
        prompt,
        aspect_ratio: aspectRatio,
        input_images: [selfieResolved.url, friendResolved.url],
        storageKeyPrefixOverride: `users/${uid}/workflows/selfie-video`,
        isPublic: false,
    };

    const inputImagesCount = (replicatePayload.input_images || replicatePayload.image_input || []).length;
    console.log('[generateSelfieVideoImage] Generating image with Seedream v4 (4K):', {
        model: replicatePayload.model,
        aspectRatio: replicatePayload.aspect_ratio,
        hasCustomBackground: !!customBackground,
        hasCustomClothes: !!customClothes,
        inputImagesCount,
    });

    try {
        // Call Replicate service to generate image with Seedream v4
        const result: any = await replicateService.generateImage(uid, replicatePayload);

        if (!result.images || result.images.length === 0) {
            throw new ApiError('No image generated from Seedream service', 500);
        }

        const generatedImage = result.images[0];
        let imageUrl = generatedImage.url || generatedImage.originalUrl;
        let storagePath = (generatedImage as any).storagePath || '';

        // Ensure image is stored in Zata if not already
        if (!storagePath || !imageUrl.includes('/users/')) {
            const zataResult = await uploadFromUrlToZata({
                sourceUrl: imageUrl,
                keyPrefix: `users/${uid}/workflows/selfie-video`,
                fileName: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            });
            imageUrl = zataResult.publicUrl;
            storagePath = zataResult.key;
        }

        console.log('[generateSelfieVideoImage] Image generated successfully:', {
            imageUrl: imageUrl.substring(0, 100),
            storagePath,
        });

        // Return image and historyId so controller can perform a single post-success debit
        return {
            imageUrl,
            storagePath,
            historyId: result?.historyId,
        } as GenerateSelfieVideoImageResponse;
    } catch (error: any) {
        console.error('[generateSelfieVideoImage] Error generating image:', error);
        throw new ApiError(
            `Failed to generate selfie video image: ${error.message || 'Unknown error'}`,
            error.statusCode || 500
        );
    }
}
