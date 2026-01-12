import Replicate from "replicate";
import { env } from '../../../config/env';
import { ApiError } from '../../../utils/errorHandler';
import { authRepository } from '../../../repository/auth/authRepository';
import { generationHistoryRepository } from '../../../repository/generationHistoryRepository';
import { replicateRepository } from '../../../repository/replicateRepository';
import { uploadDataUriToZata, uploadFromUrlToZata } from '../../../utils/storage/zataUpload';
import { aestheticScoreService } from '../../aestheticScoreService';
import { syncToMirror } from '../../../utils/mirrorHelper';

const resolveOutputUrls = async (output: any) => {
    if (!output) return [];
    if (Array.isArray(output)) return output.map(String);
    if (typeof output === 'object' && output.url) return [String(output.url())];
    return [String(output)];
};

export interface ProductPhotographyRequest {
    productImage: string;
    referenceImage: string;
    isPublic?: boolean;
}

export const generateProductPhotography = async (uid: string, req: ProductPhotographyRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = 'qwen/qwen-image-edit-2511';

    const creator = await authRepository.getUserById(uid);

    const hardPrompt = `Using the two uploaded images as exact references—one for the product and one for the model—create a single photorealistic image where the same model naturally holds the exact same product. Do not change the product’s shape, label, color, logo, texture, or proportions. Do not change the model’s identity, face, skin tone, body shape, hairstyle, or clothing.

Place the product in the model’s hand in a believable, comfortable pose (as if posing for a real brand shoot). Ensure correct hand grip, finger placement, scale, and perspective so the product looks physically present. Match lighting, shadows, reflections, and color temperature between the model and the product so they blend seamlessly.

Keep the original background and studio style from the model image. Maintain full photorealism—no stylization, no retouching artifacts, no brand distortion. The result should look like a professional product photography shot with the real model holding the real product naturally.`;

    // 1. Create History Record
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: hardPrompt,
        model: modelBase,
        generationType: "text-to-image",
        visibility: req.isPublic ? "public" : "private",
        isPublic: req.isPublic ?? true,
        createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
    } as any);

    // 2. Create Legacy Record
    const legacyId = await replicateRepository.createGenerationRecord(
        {
            prompt: hardPrompt,
            model: modelBase,
            isPublic: req.isPublic ?? true
        },
        creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid }
    );

    // 3. Handle Input Images
    const handleInputImage = async (url: string, suffix: string) => {
        let inputImageUrl = url;
        let inputImageStoragePath: string | undefined;

        if (inputImageUrl.startsWith('data:')) {
            const username = creator?.username || uid;
            const stored = await uploadDataUriToZata({
                dataUri: inputImageUrl,
                keyPrefix: `users/${username}/input/${historyId}`,
                fileName: `source-${suffix}`,
            });
            inputImageUrl = stored.publicUrl;
            inputImageStoragePath = (stored as any).key;
        } else if (inputImageUrl.includes('/api/proxy/resource/')) {
            const parts = inputImageUrl.split('/api/proxy/resource/');
            if (parts.length > 1) {
                const key = decodeURIComponent(parts[1]);
                const prefix = env.zataPrefix || 'https://idr01.zata.ai/devstoragev1/';
                inputImageUrl = `${prefix}${key}`;
                inputImageStoragePath = key;
            }
        }
        return { url: inputImageUrl, path: inputImageStoragePath };
    };

    const productInput = await handleInputImage(req.productImage, 'product');
    const referenceInput = await handleInputImage(req.referenceImage, 'reference');

    // Update history with both inputs
    const inputImages = [];
    if (productInput.path) inputImages.push({ id: "in-prod", url: productInput.url, storagePath: productInput.path });
    if (referenceInput.path) inputImages.push({ id: "in-ref", url: referenceInput.url, storagePath: referenceInput.path });

    if (inputImages.length > 0) {
        await generationHistoryRepository.update(uid, historyId, {
            inputImages: inputImages
        } as any);
    }

    // 4. Call Replicate
    const inputPayload = {
        image: [productInput.url, referenceInput.url], // [Image 0 (Product), Image 1 (Model)]
        prompt: hardPrompt,
        frameSize: "match_input_image",
        style: "none",
        output_format: "jpg"
    };

    try {
        console.log('[productPhotographyService] Running model', { model: modelBase, input: inputPayload });
        const output: any = await replicate.run(modelBase as any, { input: inputPayload });

        // 5. Process Output
        const urls = await resolveOutputUrls(output);
        const outputUrl = urls[0];
        if (!outputUrl) throw new Error("No output URL from Replicate");

        let storedUrl = outputUrl;
        let storagePath = "";
        try {
            const username = creator?.username || uid;
            const uploaded = await uploadFromUrlToZata({
                sourceUrl: outputUrl,
                keyPrefix: `users/${username}/image/${historyId}`,
                fileName: "product-photo-1",
            });
            storedUrl = uploaded.publicUrl;
            storagePath = uploaded.key;
        } catch (e) {
            console.warn("Failed to upload output to Zata", e);
        }

        const images = [{
            id: `replicate-${Date.now()}`,
            url: storedUrl,
            storagePath,
            originalUrl: outputUrl
        }];

        const scoredImages = await aestheticScoreService.scoreImages(images);
        const highestScore = aestheticScoreService.getHighestScore(scoredImages);

        // 6. Update History
        await generationHistoryRepository.update(uid, historyId, {
            status: "completed",
            images: scoredImages,
            aestheticScore: highestScore,
            updatedAt: new Date().toISOString()
        } as any);

        await replicateRepository.updateGenerationRecord(legacyId, {
            status: "completed",
            images: scoredImages as any
        });

        // 7. Sync Mirror
        await syncToMirror(uid, historyId);

        return {
            images: scoredImages,
            historyId,
            model: modelBase,
            status: "completed"
        };

    } catch (e: any) {
        console.error('[productPhotographyService] Error', e);
        await generationHistoryRepository.update(uid, historyId, {
            status: "failed",
            error: e?.message || "Replicate failed"
        } as any);
        await replicateRepository.updateGenerationRecord(legacyId, {
            status: "failed",
            error: e?.message
        });
        throw new ApiError(e?.message || "Generation failed", 502, e);
    }
};
