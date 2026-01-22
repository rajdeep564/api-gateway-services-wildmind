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

export interface RelightingRequest {
    imageUrl: string;
    isPublic?: boolean;
    lightingStyle: string;
    additionalText?: string;
}

const buildRelightingPrompt = (lightingStyle: string) => {
    let specificInstr = "";

    switch (lightingStyle) {
        case "Natural":
            specificInstr = "Soft, balanced daylight. Even exposure with natural sun direction. No harsh shadows or artificial tints.";
            break;
        case "Studio":
            specificInstr = "Professional studio photography lighting. Three-point lighting setup with key, fill, and rim light. High contrast, clean shadows, and perfectly lit subject.";
            break;
        case "Cinematic":
            specificInstr = "High-end movie scene lighting. Teal and orange color grading. Dramatic contrast, anamorphic lens flares, and atmospheric depth.";
            break;
        case "Dramatic":
            specificInstr = "High contrast, low key lighting (chiaroscuro). Deep shadows and bright highlights. Emotional and intense atmosphere.";
            break;
        case "Soft Diffused":
            specificInstr = "Extremely soft, wrap-around light. like a cloudy day or softbox. Minimal shadows, dreamy and ethereal look. Flattering for portraits.";
            break;
        case "Moody":
            specificInstr = "Dark, atmospheric, and mysterious. Desaturated colors, heavy vignettes, and localized light pools. Emotional and somber tone.";
            break;
        default:
            specificInstr = "Professional lighting enhancement. Balanced exposure and beautiful color grading.";
            break;
    }

    return `Transform the lighting of this image.
TARGET LIGHTING STYLE: "${lightingStyle}"

LIGHTING INSTRUCTIONS:
${specificInstr}

GENERAL RULES:
- Completely change the light sources, shadows, and color grading to match the target style.
- Maintain the original subject, pose, and background details EXACTLY.
- Do NOT change facial features or the identity of the person.
- The output must be photorealistic and look like it was originally shot with this lighting setup.

OUTPUT: A photorealistic image with the new lighting applied.`;
};

export const relighting = async (uid: string, req: RelightingRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = 'qwen/qwen-image-edit-2511';

    const creator = await authRepository.getUserById(uid);
    const basePrompt = buildRelightingPrompt(req.lightingStyle);
    const finalPrompt = req.additionalText ? `${req.additionalText}. ${basePrompt}` : basePrompt;

    // 1. Create History Record
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: `Relighting: ${req.lightingStyle}`,
        model: modelBase,
        generationType: "image-to-image",
        visibility: req.isPublic ? "public" : "private",
        isPublic: req.isPublic ?? true,
        createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
    } as any);

    // 2. Create Legacy Record
    const legacyId = await replicateRepository.createGenerationRecord(
        {
            prompt: finalPrompt,
            model: modelBase,
            isPublic: req.isPublic ?? true
        },
        creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid }
    );

    // 3. Handle Input Image
    let inputImageUrl = req.imageUrl;
    let inputImageStoragePath: string | undefined;

    if (inputImageUrl.startsWith('data:')) {
        const username = creator?.username || uid;
        const stored = await uploadDataUriToZata({
            dataUri: inputImageUrl,
            keyPrefix: `users/${username}/input/relighting/${historyId}`,
            fileName: "source",
        });
        inputImageUrl = stored.publicUrl;
        inputImageStoragePath = (stored as any).key;
    } else if (inputImageUrl.includes('/api/proxy/resource/')) {
        const parts = inputImageUrl.split('/api/proxy/resource/');
        if (parts.length > 1) {
            const keyPart = decodeURIComponent(parts[1]);
            const prefix = env.zataPrefix || 'https://idr01.zata.ai/devstoragev1/';
            inputImageUrl = `${prefix}${keyPart}`;
            inputImageStoragePath = keyPart;
        }
    }

    if (inputImageUrl && inputImageStoragePath) {
        await generationHistoryRepository.update(uid, historyId, {
            inputImages: [{ id: "in-1", url: inputImageUrl, storagePath: inputImageStoragePath }]
        } as any);
    }

    // 4. Call Replicate
    const inputPayload = {
        image: [inputImageUrl],
        prompt: finalPrompt,
        frameSize: "match_input_image",
        style: "none",
        output_format: "png"
    };

    try {
        console.log('[relightingService] Running model', { model: modelBase, input: inputPayload });
        const output: any = await replicate.run(modelBase as any, { input: inputPayload });

        const urls = await resolveOutputUrls(output);
        const outputUrl = urls[0];
        if (!outputUrl) throw new Error("No output URL from Replicate");

        let storedUrl = outputUrl;
        let storagePath = "";
        try {
            const username = creator?.username || uid;
            const uploaded = await uploadFromUrlToZata({
                sourceUrl: outputUrl,
                keyPrefix: `users/${username}/image/relighting/${historyId}`,
                fileName: `relighted-${Date.now()}`,
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

        await syncToMirror(uid, historyId);

        return {
            images: scoredImages,
            historyId,
            model: modelBase,
            status: "completed"
        };

    } catch (e: any) {
        console.error('[relightingService] Error', e);
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
