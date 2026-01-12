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

export interface CharacterSheetRequest {
    imageUrl: string;
    isPublic?: boolean;
}

export const generateCharacterSheet = async (uid: string, req: CharacterSheetRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = 'qwen/qwen-image-edit-2511';

    const creator = await authRepository.getUserById(uid);

    const hardPrompt = `Using the uploaded image as the exact identity reference, generate a professional character sheet in a 2x2 four-panel layout. Each panel must feature the EXACT same character with identical facial features, skin texture, hairstyle, and clothing.

Panel 1 (Top-Left): Full body front view, standing naturally.
Panel 2 (Top-Right): Full body side profile view (left or right).
Panel 3 (Bottom-Left): Full body back view.
Panel 4 (Bottom-Right): A closer three-quarter view with a dynamic pose or expression.

Maintain perfect character consistency across all panels. Keep the background clean and simple (e.g., studio grey or white). The result must be photorealistic, high-resolution, and look like a professional character turnaround sheet for film or game production. No stylization, no cartoon effect, no beauty filters. Preserve natural skin details and lighting consistency.`;

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

    // 3. Handle Input Image
    let inputImageUrl = req.imageUrl;
    let inputImageStoragePath: string | undefined;

    if (inputImageUrl.startsWith('data:')) {
        const username = creator?.username || uid;
        const stored = await uploadDataUriToZata({
            dataUri: inputImageUrl,
            keyPrefix: `users/${username}/input/${historyId}`,
            fileName: "source",
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

    if (inputImageUrl && inputImageStoragePath) {
        await generationHistoryRepository.update(uid, historyId, {
            inputImages: [{ id: "in-1", url: inputImageUrl, storagePath: inputImageStoragePath }]
        } as any);
    }

    // 4. Call Replicate
    const inputPayload = {
        image: [inputImageUrl],
        prompt: hardPrompt,
        frameSize: "match_input_image",
        style: "none",
        output_format: "jpg"
    };

    try {
        console.log('[characterSheetService] Running model', { model: modelBase, input: inputPayload });
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
                fileName: "character-sheet-1",
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
        console.error('[characterSheetService] Error', e);
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
