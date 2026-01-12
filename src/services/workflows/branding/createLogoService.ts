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

export interface CreateLogoRequest {
    image?: string;
    companyName: string;
    industry: string;
    styles: string[];
    personalities: string[];
    color: string | null;
    format: string; // 'Icon', 'Horizontal', 'Vertical'
    fileType: string;
    isPublic?: boolean;
}

export const generateLogo = async (uid: string, req: CreateLogoRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });

    // User requested specifically Qwen Image Edit 2511 for all generations
    const modelBase = 'qwen/qwen-image-edit-2511';

    // Check if user provided an image. If not, we will use a blank canvas.
    const hasInputImage = !!req.image;

    const creator = await authRepository.getUserById(uid);

    // Constructing Hard Prompt
    const stylesStr = req.styles?.length ? req.styles.join(", ") : "professional";
    const personalityStr = req.personalities?.length ? req.personalities.join(", ") : "balanced";
    const colorStr = req.color ? `Primary color: ${req.color}` : "Use brand-appropriate colors";
    const industryStr = req.industry ? `for the ${req.industry} industry` : "";
    const formatStr = req.format ? `Format: ${req.format}` : "";

    // Explicit hard prompt based on user inputs
    const baseAction = hasInputImage ? "Refine this sketch into a" : "Design a";

    const textContent = req.companyName + (req.industry ? `\nTagline / Secondary Text: ${req.industry}` : "");

    const hardPrompt = `${baseAction} world-class, modern brand logo ${industryStr}.

Brand Text: ${textContent || "Generic"}
Style Keywords: ${stylesStr}
Brand Personality: ${personalityStr}
${colorStr}
${formatStr}

Logo Design Rules (must follow strictly):
- This must be a REAL logo, not an illustration or poster.
- Use flat, clean, vector-style shapes.
- No photorealism, no shadows, no textures, no backgrounds.
- The logo must work on white and transparent backgrounds.
- Design for scalability: it should remain clear at small sizes (app icon, favicon).
- Prefer simple geometry, strong silhouette, and bold form.
- Avoid clutter, gradients, 3D effects, or scene-like compositions.

Instructions:
1. ${hasInputImage ? "Preserve the core structure of the sketch but convert it into a clean vector-style logo." : "Create a unique logo mark based on the brand name and identity."}
2. Integrate the brand name "${req.companyName}" in a balanced, professional typographic style.
3. ${req.industry ? `Include the industry text "${req.industry}" as a clean, smaller tagline below or beside the brand name.` : "Focus solely on the brand name without secondary text."}
4. Express the brand personality (${personalityStr}) through shape language and composition.
5. Use the primary color effectively (${req.color || "brand-appropriate palette"}).
6. Produce a minimal, iconic, commercial-grade logo suitable for real branding.

The output must look like it was designed by a professional brand designer, ready for use on websites, apps, packaging, and business cards.`;


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
    let inputImageUrl = req.image;

    // Fallback to blank white canvas if no image provided (Public 1024x1024 White PNG)
    if (!inputImageUrl) {
        inputImageUrl = "https://dummyimage.com/1024x1024/ffffff/ffffff.png";
    }
    console.log('[createLogoService] Input image URL:', inputImageUrl);

    let inputImageStoragePath: string | undefined;

    if (inputImageUrl && inputImageUrl.startsWith('data:')) {
        const username = creator?.username || uid;
        const stored = await uploadDataUriToZata({
            dataUri: inputImageUrl,
            keyPrefix: `users/${username}/input/${historyId}`,
            fileName: hasInputImage ? "source-sketch" : "blank-canvas",
        });
        inputImageUrl = stored.publicUrl;
        inputImageStoragePath = (stored as any).key;
    } else if (inputImageUrl && inputImageUrl.includes('/api/proxy/resource/')) {
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
            inputImages: [{ id: "in-sketch", url: inputImageUrl, storagePath: inputImageStoragePath }]
        } as any);
    }

    // 4. Call Replicate
    // Map fileType to output_format
    let outputFormat = "jpg"; // Default
    if (req.fileType && ["png"].includes(req.fileType.toLowerCase())) outputFormat = "png";
    if (req.fileType && ["webp"].includes(req.fileType.toLowerCase())) outputFormat = "webp";

    // Always call Qwen Payload
    const inputPayload: any = {
        image: [inputImageUrl],
        prompt: hardPrompt,
        frameSize: "match_input_image",
        style: "none",
        output_format: outputFormat
    };

    try {
        console.log('[createLogoService] Running model', { model: modelBase, input: inputPayload });
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
                fileName: `logo-${Date.now()}`,
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
        console.error('[createLogoService] Error', e);
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
