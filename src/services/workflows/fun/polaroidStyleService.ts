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
    // Fal structure often: { images: [{ url: "..." }] } or { image: { url: "..." } }
    if (output.images && Array.isArray(output.images)) return output.images.map((img: any) => img.url);
    if (output.image && output.image.url) return [output.image.url];
    if (Array.isArray(output)) return output.map(String);
    if (typeof output === 'object' && output.url) return [String(output.url)];
    return [String(output)];
};

export interface PolaroidStyleRequest {
    imageUrl: string;
    isPublic?: boolean;
    includeProps?: boolean;
    aspectRatio?: string;
}
const getPolaroidPrompt = (includeProps: boolean) => {
    // Generate current date like "21 Jan 2026"
    const date = new Date();
    const day = date.getDate();
    const month = date.toLocaleString('default', { month: 'short' });
    const year = date.getFullYear();
    const dateString = `${day} ${month} ${year}`;

    return `
You are generating a SINGLE complete Polaroid instant photograph.

CANVAS RULE (CRITICAL):
- The entire output image MUST be the Polaroid photo itself.
- The canvas edges must be the outer edges of the Polaroid paper.
- Do NOT place a Polaroid frame inside another image.
- Do NOT render any background outside the Polaroid.
- The Polaroid paper must touch all four edges of the image.

PHYSICAL POLAROID STRUCTURE:
- White instant-film paper frame
- Rounded corners
- Subtle paper texture
- Thick bottom border (at least 2x thicker than top/left/right)
- Photo area embedded inside the paper frame
- The result must look like a scanned or photographed real Polaroid print lying flat

BOTTOM BORDER TEXT (MANDATORY):
- On the thick bottom white border, write a small, natural, handwritten-style date.
- Write EXACTLY this date: "${dateString}".
- The text must look like it was written with a pen on the Polaroid.
- Place it slightly off-center or left-aligned, imperfect and human.
- Do NOT overlay the date inside the photo area — it must be on the white border only.

CRITICAL SUBJECT RULE:
- EXACT same number of people as input.
- No new people.
- No reflections, silhouettes, or extra faces.

IDENTITY PRESERVATION:
- Do NOT change faces.
- Do NOT change age, skin tone, or structure.
- The subject(s) must remain instantly recognizable.

PHOTO STYLE:
- Real instant camera look
- Flash overexposure
- Slight blur
- Film grain
- Imperfect focus
- Mild color shift
- Low dynamic range

SCENE:
- Replace the background with a simple white curtain.
${includeProps ? "- Add silly props to existing person(s) only." : "- Do NOT add props."}
${includeProps ? "- Funny, light-hearted poses." : "- Natural, candid pose."}

FORBIDDEN:
- No posters
- No mockups
- No frames inside frames
- No floating borders
- No studio lighting
- No CGI or illustration look

FINAL REQUIREMENT:
The output must look like a real scanned Polaroid print with:
- Full white paper frame
- Thick bottom margin
- Handwritten date on the bottom border
- No content outside the Polaroid
- EXACT same number of people as input
`;
};

export const polaroidStyle = async (uid: string, req: PolaroidStyleRequest) => {
    const key = env.falKey as string;
    if (!key) throw new ApiError("Fal API key not configured", 500);

    // Initial config if needed, though usually automatic with env var or client config
    fal.config({ credentials: key });

    const modelBase = 'fal-ai/gemini-25-flash-image/edit';

    const creator = await authRepository.getUserById(uid);
    // Default includeProps to true if not specified, to maintain existing behavior
    const includeProps = req.includeProps !== undefined ? req.includeProps : true;
    const finalPrompt = getPolaroidPrompt(includeProps);
    // Log aspect ratio for debugging
    console.log('[polaroidStyleService] Aspect Ratio:', req.aspectRatio || "1:1");

    // 1. Create History Record
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: "Polaroid Style Transformation",
        model: modelBase,
        generationType: "image-to-image",
        visibility: req.isPublic ? "public" : "private",
        isPublic: req.isPublic ?? true,
        createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
    } as any);

    // 2. Create Legacy Record (using replicateRepository for consistency with existing flow or switch to falRepository?)
    // Keeping replicateRepository for now as it seems to be the generic record keeper in this service
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

    // 4. Call Fal
    const inputPayload = {
        image_urls: [inputImageUrl], // Fal Gemini/Nano Banana uses image_urls array
        prompt: finalPrompt,
        aspect_ratio: req.aspectRatio || "1:1"
        // style: "none", // Removed Qwen specific params
        // output_format: "png"
    };

    try {
        console.log('[polaroidStyleService] Running model', { model: modelBase, input: inputPayload });

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
                keyPrefix: `users/${username}/image/polaroid-style/${historyId}`,
                fileName: `polaroid-${Date.now()}`,
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
        console.error('[polaroidStyleService] Error', e);
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
