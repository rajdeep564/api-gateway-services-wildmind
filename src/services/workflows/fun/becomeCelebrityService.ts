import { fal } from "@fal-ai/client";
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
    if (output.images && Array.isArray(output.images)) return output.images.map((img: any) => img.url);
    if (output.image && output.image.url) return [output.image.url];
    if (output.url) return [String(output.url)];
    if (Array.isArray(output)) return output.map(String);
    return [String(output)];
};

export interface BecomeCelebrityRequest {
    imageUrl: string;
    isPublic?: boolean;
    additionalText?: string;
}

const buildCelebrityPrompt = (additionalText?: string) => {
    return `Ultra realistic candid photo of the person in the reference image, standing in a crowded place with people holding cameras taking photos. The background is filled with fans and a little chaos, giving a true celebrity vibe. The photo should look like a real-life captured moment, with natural lighting, sharp details, and authentic atmosphere.
    
INSTRUCTIONS:
- STRICTLY preserve the identity and facial features of the person in the reference image.
- The person should be the main focus, looking confident or natural.
- The crowd and cameras should be in the background/surroundings, creating depth.
${additionalText ? `USER ADDITIONAL DETAILS: ${additionalText}` : ''}

OUTPUT: A photorealistic, high-quality image of the user as a celebrity in a chaotic, fan-filled environment.`;
};

export const becomeCelebrity = async (uid: string, req: BecomeCelebrityRequest) => {
    const key = env.falKey as string;
    if (!key) throw new ApiError("Fal API key not configured", 500);

    // Initial config
    fal.config({ credentials: key });

    const modelBase = 'fal-ai/gemini-25-flash-image/edit';

    const creator = await authRepository.getUserById(uid);
    const finalPrompt = buildCelebrityPrompt(req.additionalText);

    // 1. Create History Record
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: "Become a Celebrity",
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
            keyPrefix: `users/${username}/input/become-celebrity/${historyId}`,
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

    // 4. Call Fal AI
    const inputPayload = {
        image_urls: [inputImageUrl],
        prompt: finalPrompt,
        aspect_ratio: "1:1" // Default square for this workflow? Or make it match input like Polaroid. 
        // The previous code had "match_input_image". 
        // Fal Gemini defaults to Square or requires valid aspect ratio. 
        // I'll stick to "1:1" as safe default or "match" if supported. 
        // Given Gemini model behavior, "1:1" is safest unless we calculate it.
    };

    try {
        console.log('[becomeCelebrityService] Running model', { model: modelBase, input: inputPayload });

        const result: any = await fal.subscribe(modelBase, {
            input: inputPayload,
            logs: true,
        });

        const urls = await resolveOutputUrls(result.data);
        const outputUrl = urls[0];
        if (!outputUrl) throw new Error("No output URL from Fal");

        let storedUrl = outputUrl;
        let storagePath = "";
        try {
            const username = creator?.username || uid;
            const uploaded = await uploadFromUrlToZata({
                sourceUrl: outputUrl,
                keyPrefix: `users/${username}/image/become-celebrity/${historyId}`,
                fileName: `celebrity-${Date.now()}`,
            });
            storedUrl = uploaded.publicUrl;
            storagePath = uploaded.key;
        } catch (e) {
            console.warn("Failed to upload output to Zata", e);
        }

        const images = [{
            id: `fal-${Date.now()}`,
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
        console.error('[becomeCelebrityService] Error', e);
        await generationHistoryRepository.update(uid, historyId, {
            status: "failed",
            error: e?.message || "Fal generation failed"
        } as any);
        await replicateRepository.updateGenerationRecord(legacyId, {
            status: "failed",
            error: e?.message
        });
        throw new ApiError(e?.message || "Generation failed", 502, e);
    }
};
