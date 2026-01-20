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

export interface PolaroidStyleRequest {
    imageUrl: string;
    isPublic?: boolean;
}
const POLAROID_PROMPT = `Transform the attached image so it looks like it was captured using a real Polaroid instant camera.

CRITICAL SUBJECT RULE (ABSOLUTE):
- The output MUST contain EXACTLY the same number of people as in the input image.
- If the input image has ONE person, the output must contain ONLY ONE person.
- Do NOT add, duplicate, mirror, hallucinate, or introduce any new people.
- Do NOT create background silhouettes, reflections, or partial faces.
- The subject(s) must remain the same individual(s) from the input.

IDENTITY PRESERVATION:
- Do NOT change faces or identities.
- Do NOT alter facial structure, skin tone, age, or core expression identity.
- The person(s) must remain instantly recognizable.

STYLE & FEEL:
- Make it look like a real Polaroid instant photo.
- Slight motion blur, imperfect focus, subtle flash overexposure.
- Soft film grain, mild color shift, low dynamic range.
- Candid, casual, in-the-moment energy.

SCENE CHANGES:
- Replace the background with a simple white curtain backdrop.
- Add playful, silly props ONLY to the existing person(s) (party glasses, paper hats, ribbons, etc.).
- Make the existing person(s) perform funny, light-hearted poses.
- Do NOT introduce new people in the background.

CAMERA BEHAVIOR:
- Simulate on-camera flash: bright foreground, slightly washed highlights.
- Subtle vignetting and edge softness.
- Natural imperfections: slight tilt, imperfect framing, mild blur.

OUTPUT REQUIREMENTS:
- Photorealistic instant-film look
- No illustration or stylization
- No studio perfection
- Must feel like a real Polaroid snapshot
- EXACTLY the same number of people as the input image
`;


export const polaroidStyle = async (uid: string, req: PolaroidStyleRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = 'qwen/qwen-image-edit-2511';

    const creator = await authRepository.getUserById(uid);
    const finalPrompt = POLAROID_PROMPT;

    // 1. Create History Record
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: "Polaroid Style Transformation",
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
            keyPrefix: `users/${username}/input/polaroid-style/${historyId}`,
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
        console.log('[polaroidStyleService] Running model', { model: modelBase, input: inputPayload });
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
                keyPrefix: `users/${username}/image/polaroid-style/${historyId}`,
                fileName: `polaroid-${Date.now()}`,
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
        console.error('[polaroidStyleService] Error', e);
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
