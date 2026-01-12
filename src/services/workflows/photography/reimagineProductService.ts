import Replicate from "replicate";
import { env } from '../../../config/env';
import { ApiError } from '../../../utils/errorHandler';
import { authRepository } from '../../../repository/auth/authRepository';
import { generationHistoryRepository } from '../../../repository/generationHistoryRepository';
import { replicateRepository } from '../../../repository/replicateRepository';
import { uploadDataUriToZata } from '../../../utils/storage/zataUpload';
import { aestheticScoreService } from '../../aestheticScoreService';
import { syncToMirror } from '../../../utils/mirrorHelper';

const resolveOutputUrls = async (output: any) => {
    if (!output) return [];
    if (Array.isArray(output)) return output.map(String);
    if (typeof output === 'object' && output.url) return [String(output.url())];
    return [String(output)];
};

export interface ReimagineProductRequest {
    image: string;
    angle: string;
    additionalDetails?: string;
    isPublic?: boolean;
}

export const generateReimagineProduct = async (uid: string, req: ReimagineProductRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = 'qwen/qwen-image-edit-2511';

    const creator = await authRepository.getUserById(uid);

    // 1. Create History Record
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: req.angle || "Reimagine Product",
        model: modelBase,
        generationType: "image-to-image",
        visibility: req.isPublic ? "public" : "private",
        isPublic: req.isPublic ?? true,
        createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
    } as any);

    // 2. Create Legacy Record
    const legacyId = await replicateRepository.createGenerationRecord(
        {
            prompt: req.angle || "Reimagine Product",
            model: modelBase,
            isPublic: req.isPublic ?? true
        },
        creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid }
    );

    // 3. Handle Input Image
    let inputImageUrl = req.image;
    let inputImageStoragePath: string | undefined;

    if (!inputImageUrl) throw new ApiError("Product image is required", 400);

    // 4. Handle Base64 Upload
    if (inputImageUrl.startsWith('data:')) {
        const username = creator?.username || uid;
        const stored = await uploadDataUriToZata({
            dataUri: inputImageUrl,
            keyPrefix: `users/${username}/input/${historyId}`,
            fileName: "source-product",
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
            inputImages: [{ id: "in-product", url: inputImageUrl, storagePath: inputImageStoragePath }]
        } as any);
    }

    // 5. Construct Hard Prompt
    const angle = req.angle || "Eye-Level";
    const additionalDetails = req.additionalDetails
        ? `\n\nAdditional Details: ${req.additionalDetails}`
        : "";

    const hardPrompt = `A specific ${angle} camera shot of this product.
${additionalDetails}

Instructions:
1. STRICTLY PRESERVE the product's identity, logos, text, and shape.
2. DO NOT modify the text on the product label. It must remain legible and unchanged.
3. CHANGE ONLY THE CAMERA ANGLE to be a ${angle} view.
4. Ensure the background and lighting match the high-end commercial photography style requested.
5. If the angle is impossible without 3D data, approximate a realistic view from that perspective while maintaining 100% brand fidelity.`;

    try {
        const inputPayload = {
            image: [inputImageUrl],
            prompt: hardPrompt,
            frameSize: "match_input_image",
            style: "none",
            output_format: "png"
        };

        console.log(`[reimagineProductService] Running generation`, { input: inputPayload });
        const output: any = await replicate.run(modelBase as any, { input: inputPayload });
        const urls = await resolveOutputUrls(output);

        if (!urls || urls.length === 0) {
            throw new Error("No output generated");
        }

        // 6. Aesthetic Scoring & Formatting
        const scoredImages = await aestheticScoreService.scoreImages(
            urls.map((url, index) => ({
                id: `replicate-${Date.now()}-${index}`,
                url,
                originalUrl: url
            }))
        );
        const highestScore = aestheticScoreService.getHighestScore(scoredImages);

        // 7. Update History
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

        // 8. Sync Mirror
        await syncToMirror(uid, historyId);

        return {
            images: scoredImages,
            historyId,
            model: modelBase,
            status: "completed"
        };

    } catch (e: any) {
        console.error('[reimagineProductService] Error', e);
        await generationHistoryRepository.update(uid, historyId, {
            status: "failed",
            error: e?.message || "Generation failed"
        } as any);
        await replicateRepository.updateGenerationRecord(legacyId, {
            status: "failed",
            error: e?.message
        });
        throw new ApiError(e?.message || "Generation failed", 502, e);
    }
};
