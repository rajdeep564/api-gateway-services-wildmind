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

export interface PeopleAgeRequest {
    imageUrl: string;
    targetAge: string;
    isPublic?: boolean;
    additionalText?: string;
}

const AGE_MAP: Record<string, string> = {
    Toddler: "a 2–3 year old toddler with soft baby skin, round cheeks, and childlike proportions",
    Child: "a 7–9 year old child with youthful skin, smaller facial features, and playful softness",
    Teenager: "a 15–17 year old teenager with early adult bone structure, smooth skin, and youthful energy",
    "Young Adult": "a 22–28 year old young adult with mature facial structure and clear skin",
    "Middle-Aged Adult": "a 40–50 year old adult with subtle wrinkles, mild skin texture, and mature features",
    "Senior Adult": "a 60–70 year old person with visible aging, wrinkles, and softer facial contours",
    Elderly: "an 80+ year old elderly person with deep wrinkles, aged skin, and gentle facial sagging"
};

const buildPeopleAgePrompt = (targetAge: string) => {
    const targetAgeDescription = AGE_MAP[targetAge] || AGE_MAP["Young Adult"];

    return `Transform the person in the input image to appear as a ${targetAge} version of the SAME individual.

STRICT RULES:
- Preserve the person’s identity, face shape, eye color, nose, lips, jawline, and overall likeness.
- Do NOT change who the person is.
- Do NOT replace them with a different person.
- Keep the same gender, ethnicity, and facial structure.
- Keep the same hairstyle style (only age-adjust it if needed).
- Keep the same background, camera angle, framing, and lighting.

AGE TRANSFORMATION ONLY:
- Modify only age-related traits:
  - Skin texture
  - Wrinkles or smoothness
  - Facial fullness or definition
  - Subtle bone structure maturation
  - Hair aging (if applicable)
- The change must look natural and realistic.

TARGET AGE PROFILE:
${targetAgeDescription}

OUTPUT REQUIREMENTS:
- Photorealistic result
- No stylization, no cartoon look
- No scene changes
- No outfit changes unless required by age realism
- The person must still be instantly recognizable`;
};

export const peopleAge = async (uid: string, req: PeopleAgeRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = 'qwen/qwen-image-edit-2511';

    const creator = await authRepository.getUserById(uid);
    const basePrompt = buildPeopleAgePrompt(req.targetAge);
    const finalPrompt = req.additionalText ? `${req.additionalText}. ${basePrompt}` : basePrompt;

    // 1. Create History Record
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: `Age transformation to ${req.targetAge}`,
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
            keyPrefix: `users/${username}/input/people-age/${historyId}`,
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
        console.log('[peopleAgeService] Running model', { model: modelBase, input: inputPayload });
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
                keyPrefix: `users/${username}/image/people-age/${historyId}`,
                fileName: `age-${req.targetAge.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
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
        console.error('[peopleAgeService] Error', e);
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
