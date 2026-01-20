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

    const extraDetails = req.background === 'studio'
        ? 'studio lighting, infinite background, professional automotive commercial'
        : 'real world location, natural lighting, shot on location';

    const hardPrompt = `RAW CANDID PHOTO, (Phase One XF IQ4 150MP:1.3), 80mm lens, f/8, ISO 100.
A highly realistic automotive photograph of the car in the image.

CONTEXT:
Environment: ${bgPrompt}, ${extraDetails}.
Lighting: ${lightPrompt}, physically accurate reflections.
Motion: ${motionPrompt}.

STRICT REALISM RULES:
- The car MUST look like a real physical object with weight and mass.
- Imperfect surfaces: road texture, tire dust, slight reflection inconsistencies (Fresnel effect).
- Natural optical flaws: subtle chromatic aberration, sensor noise in shadows, natural depth of field.
- NO PLASTIC LOOK, NO 3D RENDER SMOOTHNESS, NO CGI PERFECT SHINE.
- The car paint must behave like real metallic/gloss paint, not like a blender shader.
- Integration: The car must cast realistic ambient occlusion shadows on the ground.
- Preserve exact car identity (wheels, badges, trim).

STYLE:
National Geographic Automotive, Evo Magazine, raw file, unedited, photorealistic, 8k, highly detailed.`;


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
