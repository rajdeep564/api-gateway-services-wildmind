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

export interface LogoVariationsRequest {
    image: string; // The original logo
    numVariations: number;
    prompt?: string;
    isPublic?: boolean;
}

export const generateLogoVariations = async (uid: string, req: LogoVariationsRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = 'qwen/qwen-image-edit-2511';

    const creator = await authRepository.getUserById(uid);
    const numVariations = Math.min(Math.max(req.numVariations, 1), 4); // Clamp between 1 and 4

    // 1. Create History Record (Placeholder)
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: req.prompt || "Logo Variations",
        model: modelBase,
        generationType: "image-to-image",
        visibility: req.isPublic ? "public" : "private",
        isPublic: req.isPublic ?? true,
        createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
    } as any);

    // 2. Create Legacy Record
    const legacyId = await replicateRepository.createGenerationRecord(
        {
            prompt: req.prompt || "Logo Variations",
            model: modelBase,
            isPublic: req.isPublic ?? true
        },
        creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid }
    );

    // 3. Handle Input Image
    let inputImageUrl = req.image;
    let inputImageStoragePath: string | undefined;

    if (!inputImageUrl) throw new ApiError("Logo image is required", 400);

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

    // 4. Batched Generation Loop
    const generatedImages: any[] = [];

    // Variation styles to ensure uniqueness if not specified
    const variationStyles = [
        "Minimalist and clean vector art style",
        "Bold, thick lines, modern geometric style",
        "Elegant, sophisticated, high-contrast style",
        "Creative, abstract, artistic re-interpretation"
    ];

    try {
        const promises = Array.from({ length: numVariations }).map(async (_, index) => {
            const stylePrompt = variationStyles[index % variationStyles.length];
            // Base prompt construction
            const baseInstruction = `Create a unique creative variation of this logo. Version ${index + 1}: ${stylePrompt}. Maintain the core brand identity but explore this specific style.`;

            // Add user instructions if provided
            const additionalInstructions = req.prompt
                ? `\n\nAdditional User Instructions: ${req.prompt}`
                : "";

            const hardPrompt = `Refine this sketch into a world-class, modern brand logo.
${baseInstruction}${additionalInstructions}

Instructions:
1. Preserve the core concept of the original logo but reimagine it in a new style.
2. Make it a clean, vector-style logo suitable for professional branding.
3. Ensure this specific variation is DISTINCT from others.
4. No photorealism, no 3D effects unless requested. Flat, iconic design.`;

            const inputPayload: any = {
                image: [inputImageUrl],
                prompt: hardPrompt,
                frameSize: "match_input_image",
                style: "none",
                output_format: "png",
                seed: Math.floor(Math.random() * 1000000) // Random seed for uniqueness
            };

            console.log(`[logoVariationsService] Running variation ${index + 1}`, { input: inputPayload });
            const output: any = await replicate.run(modelBase as any, { input: inputPayload });
            const urls = await resolveOutputUrls(output);

            if (urls[0]) {
                let storedUrl = urls[0];
                let storagePath = "";
                try {
                    const username = creator?.username || uid;
                    const uploaded = await uploadFromUrlToZata({
                        sourceUrl: urls[0],
                        keyPrefix: `users/${username}/image/${historyId}`,
                        fileName: `variation-${index}-${Date.now()}`,
                    });
                    storedUrl = uploaded.publicUrl;
                    storagePath = uploaded.key;
                } catch (e) {
                    console.warn(`Failed to upload variation ${index} to Zata`, e);
                }

                return {
                    id: `replicate-${Date.now()}-${index}`,
                    url: storedUrl,
                    storagePath,
                    originalUrl: urls[0]
                };
            }
            return null;
        });

        const results = await Promise.all(promises);
        const successfulImages = results.filter(img => img !== null);

        if (successfulImages.length === 0) {
            throw new Error("All variation attempts failed");
        }

        const scoredImages = await aestheticScoreService.scoreImages(successfulImages);
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
        console.error('[logoVariationsService] Error', e);
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
