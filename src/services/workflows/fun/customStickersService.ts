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

export interface CustomStickersRequest {
    imageUrl: string;
    isPublic?: boolean;
    shape?: string;
    style?: string;
    theme?: string;
    material?: string;
    stickerType?: string;
    fileStyle?: string;
    details?: string;
}

const buildStickersPrompt = (req: CustomStickersRequest) => {
    return `Create a collection of cute chibi-style illustration stickers using the person in the uploaded image as the ONLY character.

IDENTITY RULES (ABSOLUTE):
- Use exactly the same person from the input image.
- Do NOT add new characters.
- Do NOT change gender, ethnicity, face structure, or hairstyle identity.
- The character must remain clearly recognizable as the same person.
- Do NOT merge multiple people or create duplicates.

STYLE:
- Chibi / super-deformed proportions (big head, small body).
- Cute, friendly, expressive anime-inspired style.
- Clean vector-like outlines.
- Soft pastel colors.
- High detail but simple shapes.
- No realism, no 3D, no photorealism.
${req.style ? `- Override style preference: ${req.style}` : ''}

STICKER SET REQUIREMENTS:
- Generate 6–10 different sticker poses and expressions.
- Each sticker must show a different emotion or action, such as:
  - Happy / smiling
  - Excited
  - Winking
  - Peace sign
  - Singing / holding microphone
  - Thinking
  - Thumbs up
  - Laughing
${req.theme ? `- Theme focus: ${req.theme}` : ''}

POSE & CLOTHING:
- Base outfit inspired by the original image.
- Keep clothing style consistent with the source image.
- Small cartoon accessories allowed (stars, hearts, music notes, sparkles).

BACKGROUND & FORMAT:
- Transparent background for each sticker.
- No background scenes.
- No shadows or environments.
- Each sticker centered with padding.
- White outline border around each sticker (die-cut style).
${req.shape ? `- Preferred sticker shape: ${req.shape}` : ''}
${req.material ? `- Material reference: ${req.material}` : ''}
${req.stickerType ? `- Sticker type (format): ${req.stickerType}` : ''}
${req.fileStyle ? `- Output file format: ${req.fileStyle}` : ''}

QUALITY:
- High resolution
- Clean edges
- Print-ready
- No text
- No watermark
- No logos
- No extra objects

FINAL OUTPUT:
A cohesive sticker pack sheet containing multiple individual chibi stickers of the same character, ready for export and cutting.

${req.details ? `ADDITIONAL USER REQUESTS: ${req.details}` : ''}`;
};

export const customStickers = async (uid: string, req: CustomStickersRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = 'qwen/qwen-image-edit-2511';

    const creator = await authRepository.getUserById(uid);
    const finalPrompt = buildStickersPrompt(req);

    // 1. Create History Record
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: "Custom Chibi Stickers",
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
            keyPrefix: `users/${username}/input/custom-stickers/${historyId}`,
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
        console.log('[customStickersService] Running model', { model: modelBase, input: inputPayload });
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
                keyPrefix: `users/${username}/image/custom-stickers/${historyId}`,
                fileName: `stickers-${Date.now()}`,
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
        console.error('[customStickersService] Error', e);
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
