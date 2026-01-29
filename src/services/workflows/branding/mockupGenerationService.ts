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

export interface MockupGenerationRequest {
    image: string; // The logo
    productType: string;
    prompt?: string;
    isPublic?: boolean;
}

export const generateMockup = async (uid: string, req: MockupGenerationRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });

    // User requested specifically Qwen Image Edit 2511
    const modelBase = 'qwen/qwen-image-edit-2511';

    const creator = await authRepository.getUserById(uid);

    // Constructing Hard Prompt
    const instructions = req.prompt ? `Additional details: ${req.prompt}.` : "";

    // "Hard Prompting" for Mockup placement
    const hardPrompt = `A professional, high-quality product mockup of a ${req.productType}.
The uploaded logo is placed cleanly and realistically on the product.
${instructions}

Instructions:
1. Generate a photorealistic image of a ${req.productType}.
2. Apply the input logo onto the product surface naturally (accounting for lighting, texture, and perspective).
3. DO NOT change the logo's shape, geometry, or text content. Keep it recognizable.
4. Ensure the background is clean and professional (studio lighting).
5. The product should be the main focus, with the logo clearly visible.`;

    // 1. Create History Record
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: hardPrompt,
        model: modelBase,
        generationType: "image-to-image", // It's effectively image-to-image (logo to mockup)
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

    // 3. Handle Input Image (Logo)
    let inputImageUrl = req.image;
    let inputImageStoragePath: string | undefined;

    // Validate input image exists (required for this workflow)
    if (!inputImageUrl) {
        throw new ApiError("Logo image is required for mockup generation", 400);
    }

    if (inputImageUrl.startsWith('data:')) {
        const username = creator?.username || uid;
        const stored = await uploadDataUriToZata({
            dataUri: inputImageUrl,
            keyPrefix: `users/${username}/input/${historyId}`,
            fileName: "source-logo",
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

    if (inputImageStoragePath) {
        await generationHistoryRepository.update(uid, historyId, {
            inputImages: [{ id: "in-logo", url: inputImageUrl, storagePath: inputImageStoragePath }]
        } as any);
    }

    // 4. Call Replicate
    const inputPayload: any = {
        image: [inputImageUrl],
        prompt: hardPrompt,
        frameSize: "match_input_image", // Or should we not match? Logos are small. Qwen might output small mockup.
        // Actually for Qwen, if input is small logo, output will be small. 
        // We probably want a larger output? 
        // Qwen doesn't have explicit size param other than frameSize. 
        // Let's stick to match for now, assuming user uploaded a decent quality logo.
        // If logo is 512x512, result is 512x512 which is fine for preview.
        style: "none",
        output_format: "png"
    };

    try {
        console.log('[mockupGenerationService] Running model', { model: modelBase, input: inputPayload });
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
                fileName: `mockup-${Date.now()}`,
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
        console.error('[mockupGenerationService] Error', e);
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
