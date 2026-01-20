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

export interface ChangeSeasonsRequest {
    imageUrl: string;
    isPublic?: boolean;
    seasonDescription: string;
}

const buildSeasonsPrompt = (seasonDescription: string) => {
    // If user provided no description, default to a generic transformation or ask for emphasis on seasons.
    // However, the controller/frontend should ideally enforce this.
    // We will assume seasonDescription contains the user's desired season (e.g., "Winter", "Snowy Christmas", "Autumn leaves").

    return `Transform the season of this image.
TARGET SEASON / ATMOSPHERE: "${seasonDescription}"

INSTRUCTIONS:
- completely transform the environment to match the target season/description provided above.
- If "Winter": Add snow, frost, ice, and cold lighting. Trees should be bare or covered in snow.
- If "Spring": Add blooming flowers, lush green grass, budding trees, and soft, warm sunlight.
- If "Summer": Bright, vibrant sunlight, full green foliage, clear blue skies.
- If "Autumn" / "Fall": distinct orange, red, and yellow leaves, fallen leaves on the ground, slightly cooler/moody lighting.
- If the user entered a specific custom description (e.g., "Cherry Blossoms"), strictly follow that theme.

CONSTRAINTS:
- Keep the original structure of the image (buildings, mountains, roads, people) EXACTLY as they are.
- Only change the textures, colors, and lighting to reflect the new season.
- Do NOT add new large objects or remove existing structures.
- The transformation must be photorealistic and seamless.

OUTPUT: A photorealistic version of the original image, fully transformed into the requested season.`;
};

export const changeSeasons = async (uid: string, req: ChangeSeasonsRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = 'qwen/qwen-image-edit-2511';

    const creator = await authRepository.getUserById(uid);
    const finalPrompt = buildSeasonsPrompt(req.seasonDescription);

    // 1. Create History Record
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: "Change Seasons",
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
            keyPrefix: `users/${username}/input/change-seasons/${historyId}`,
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
        console.log('[changeSeasonsService] Running model', { model: modelBase, input: inputPayload });
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
                keyPrefix: `users/${username}/image/change-seasons/${historyId}`,
                fileName: `season-${Date.now()}`,
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
        console.error('[changeSeasonsService] Error', e);
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
