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

export interface AutomotiveRequest {
    carImage: string;
    background: string;
    lighting: string;
    motionBlur: string;
    isPublic?: boolean;
}

export const generateAutomotiveShot = async (uid: string, req: AutomotiveRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = 'qwen/qwen-image-edit-2511';

    const creator = await authRepository.getUserById(uid);

    // 1. Create History Record
    const promptSummary = `Automotive: ${req.background}, ${req.lighting}, ${req.motionBlur}`;
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: promptSummary,
        model: modelBase,
        generationType: "image-to-image",
        visibility: req.isPublic ? "public" : "private",
        isPublic: req.isPublic ?? true,
        createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
    } as any);

    // 2. Create Legacy Record
    const legacyId = await replicateRepository.createGenerationRecord(
        {
            prompt: promptSummary,
            model: modelBase,
            isPublic: req.isPublic ?? true
        },
        creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid }
    );

    // 3. Handle Input Image
    let inputImageUrl = req.carImage;
    let inputImageStoragePath: string | undefined;

    if (!inputImageUrl) throw new ApiError("Car image is required", 400);

    if (inputImageUrl.startsWith('data:')) {
        const username = creator?.username || uid;
        const stored = await uploadDataUriToZata({
            dataUri: inputImageUrl,
            keyPrefix: `users/${username}/input/${historyId}`,
            fileName: "source-car",
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
            inputImages: [{ id: "in-car", url: inputImageUrl, storagePath: inputImageStoragePath }]
        } as any);
    }

    // 4. Construct Hard Prompt
    // Mapping frontend IDs to descriptive text
    const bgMap: Record<string, string> = {
        'urban': 'a sleek, modern city street with skyscrapers and asphalt',
        'mountain': 'a scenic mountain pass with winding roads and dramatic peaks',
        'coast': 'a beautiful coastal highway next to the ocean',
        'studio': 'a professional automotive photography studio with an infinity curve background',
        'forest': 'a dark, moody pine forest road',
        'desert': 'an open desert highway with vast horizons'
    };

    const lightMap: Record<string, string> = {
        'golden-hour': 'warm, golden hour sunlight casting soft long shadows',
        'sunset': 'dramatic deep sunset lighting with orange and purple hues',
        'noon': 'bright, high-contrast midday sunlight',
        'moonlight': 'cool, mysterious moonlight',
        'cinematic': 'cool cinematic blue tones and atmospheric lighting',
        'neon': 'vibrant cyberpunk neon city lights reflecting on the car'
    };

    const motionMap: Record<string, string> = {
        'None': 'static shot, car parked, sharp focus',
        'Low': 'slight motion blur on wheels, slow driving',
        'Medium': 'dynamic motion blur on background and wheels, driving at speed',
        'High': 'intense speed blur, racing action shot'
    };

    const bgPrompt = bgMap[req.background] || req.background;
    const lightPrompt = lightMap[req.lighting] || req.lighting;
    const motionPrompt = motionMap[req.motionBlur] || req.motionBlur;

    const hardPrompt = `Create a REAL-WORLD automotive photograph using the provided car image.

Scene:
Environment: ${bgPrompt}
Lighting: ${lightPrompt}
Motion: ${motionPrompt}

STRICT RULES:
- This must look like a real camera photo taken in the physical world.
- NO illustration, NO CGI look, NO anime, NO cartoon, NO concept art, NO painting style.
- Use true-to-life optics: DSLR camera, 50mm lens, natural depth of field, realistic exposure.
- Preserve the exact car identity: same make, model, body shape, paint color, wheels, mirrors, badges, proportions.
- Do NOT redesign, exaggerate, or stylize the car in any way.
- Integrate the car naturally into the environment with correct scale, shadows, ground contact, and perspective.
- Lighting must physically match the environment and reflect accurately on the car’s body and glass.
- The result must resemble a professional automotive photoshoot from a real magazine.

Output style:
Ultra-photorealistic, real-world photography, natural color science, cinematic but realistic, 8K detail, sharp focus on the car, believable motion blur if applicable, no fantasy elements.`;


    try {
        const inputPayload = {
            image: [inputImageUrl], // Array format for Qwen
            prompt: hardPrompt,
            frameSize: "match_input_image",
            style: "none",
            output_format: "png"
        };

        console.log(`[automotivePhotographyService] Running generation`, { input: inputPayload });
        const output: any = await replicate.run(modelBase as any, { input: inputPayload });
        const urls = await resolveOutputUrls(output);

        if (!urls || urls.length === 0) {
            throw new Error("No output generated");
        }

        // 5. Aesthetic Scoring
        const scoredImages = await aestheticScoreService.scoreImages(
            urls.map((url, index) => ({
                id: `replicate-${Date.now()}-${index}`,
                url,
                originalUrl: url
            }))
        );
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
        console.error('[automotivePhotographyService] Error', e);
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
