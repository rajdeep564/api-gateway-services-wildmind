import Replicate from "replicate";
import { env } from "../../../config/env";
import { ApiError } from "../../../utils/errorHandler";
import { authRepository } from "../../../repository/auth/authRepository";
import { generationHistoryRepository } from "../../../repository/generationHistoryRepository";
import { replicateRepository } from "../../../repository/replicateRepository";
import { uploadDataUriToZata, uploadFromUrlToZata } from "../../../utils/storage/zataUpload";
import { aestheticScoreService } from "../../aestheticScoreService";
import { syncToMirror } from "../../../utils/mirrorHelper";

export interface BusinessCardRequest {
    logo: string;
    companyName: string;
    personName: string;
    designation: string;
    contact: string;
    style: string;
    color: string;
    sides: number;
    isPublic?: boolean;
}

const resolveOutputUrls = async (output: any) => {
    if (!output) return [];
    if (Array.isArray(output)) return output.map(String);
    if (typeof output === 'object' && output.url) return [String(output.url())];
    return [String(output)];
};

const buildBusinessCardPrompt = (req: BusinessCardRequest, side: "front" | "back") => {
    const isFront = side === "front";
    const isTwoSided = req.sides === 2;

    const layoutRules = `
THIS IS A PRINT DESIGN TASK — NOT A PHOTO AND NOT A MOCKUP.

BUSINESS CARD SPEC:
- Size ratio: 3.5 x 2 inches (horizontal)
- Output size: 1050 x 600 pixels
- Flat 2D vector-style layout
- Edge-to-edge card (no outer background)
- No perspective
- No 3D
- No shadows
- No table
- No stacked cards
- No environment
- No depth
- No photography
- Looks like a Figma/Illustrator export

ABSOLUTE RULES:
1. The entire canvas IS the card.
2. Do NOT render a card inside a scene.
3. Do NOT show multiple cards.
4. Do NOT add mockup effects.
5. All text must be EXACT:
   - "${req.companyName}"
   - "${req.personName}"
   - "${req.designation}"
   - "${req.contact}"
6. Professional spacing, grid, margins.
7. Corporate-grade typography.
8. Print-safe design.
`;

    let contentRules = "";

    if (isFront) {
        if (isTwoSided) {
            contentRules = `
FRONT SIDE CONTENT:
- Logo as primary visual
- Company name: "${req.companyName}"
- No personal details
- Strong brand presence
- Minimal and elegant
`;
        } else {
            contentRules = `
SINGLE-SIDED CONTENT:
- Logo
- Company: "${req.companyName}"
- Name: "${req.personName}"
- Title: "${req.designation}"
- Contact: "${req.contact}"
- Clean professional layout
`;
        }
    } else {
        contentRules = `
BACK SIDE CONTENT:
- Name: "${req.personName}"
- Title: "${req.designation}"
- Contact: "${req.contact}"
- Small logo watermark
- Same brand system as front
`;
    }

    return `
You are a senior brand identity designer.

Brand style: ${req.style}
Primary color: ${req.color}

${layoutRules}

${contentRules}

TYPOGRAPHY:
- Modern sans-serif
- Clear hierarchy
- Balanced spacing
- Print-grade alignment

FORBIDDEN:
- No placeholders
- No lorem ipsum
- No AI signatures
- No decorative handwriting fonts
- No spelling changes

FINAL OUTPUT:
A flat, professional, print-ready business card layout.
It must look like a real corporate stationery file ready for press.
`;
};

export const generateBusinessCard = async (uid: string, req: BusinessCardRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = 'bytedance/seedream-4.5';

    const creator = await authRepository.getUserById(uid);
    const username = creator?.username || uid;

    const promptSummary = `Business Card (${req.sides === 2 ? "Double" : "Single"} sided) - ${req.companyName}`;
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: promptSummary,
        model: modelBase,
        generationType: "image-to-image",
        visibility: req.isPublic ? "public" : "private",
        isPublic: req.isPublic ?? true,
        createdBy: creator ? { uid, username, email: (creator as any)?.email } : { uid },
    } as any);

    const legacyId = await replicateRepository.createGenerationRecord(
        { prompt: promptSummary, model: modelBase, isPublic: req.isPublic ?? true },
        creator ? { uid, username, email: (creator as any)?.email } : { uid }
    );

    try {
        let logoUrl = req.logo;
        let logoStoragePath: string | undefined;

        if (logoUrl.startsWith('data:')) {
            const stored = await uploadDataUriToZata({
                dataUri: logoUrl,
                keyPrefix: `users/${username}/input/business-card/${historyId}`,
                fileName: "logo",
            });
            logoUrl = stored.publicUrl;
            logoStoragePath = (stored as any).key;
        } else if (logoUrl.includes('/api/proxy/resource/')) {
            const parts = logoUrl.split('/api/proxy/resource/');
            if (parts.length > 1) {
                const keyPart = decodeURIComponent(parts[1]);
                const prefix = env.zataPrefix || 'https://idr01.zata.ai/devstoragev1/';
                logoUrl = `${prefix}${keyPart}`;
                logoStoragePath = keyPart;
            }
        }

        if (logoUrl && logoStoragePath) {
            await generationHistoryRepository.update(uid, historyId, {
                inputImages: [{ id: "bc-logo", url: logoUrl, storagePath: logoStoragePath }]
            } as any);
        }

        const sideTasks: { side: "front" | "back"; label: string }[] = [{ side: "front", label: "Front" }];
        if (req.sides === 2) sideTasks.push({ side: "back", label: "Back" });

        const generatedImages: any[] = [];

        for (const task of sideTasks) {
            const hardPrompt = buildBusinessCardPrompt(req, task.side);
            const input = {
                image: [logoUrl],
                prompt: hardPrompt,
                frameSize: "1050x600",
                style: "none",
                output_format: "png"
            };

            const output: any = await replicate.run(modelBase as any, { input });
            const urls = await resolveOutputUrls(output);
            const outputUrl = urls[0];
            if (!outputUrl) throw new Error(`Failed to generate ${task.label}`);

            const uploaded = await uploadFromUrlToZata({
                sourceUrl: outputUrl,
                keyPrefix: `users/${username}/image/business-card/${historyId}`,
                fileName: `bc-${task.side}-${Date.now()}`,
            });

            generatedImages.push({
                id: `bc-${task.side}-${Date.now()}`,
                url: uploaded.publicUrl,
                storagePath: uploaded.key,
                originalUrl: outputUrl,
                side: task.side
            });
        }

        const scoredImages = await aestheticScoreService.scoreImages(generatedImages);
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
        console.error('[businessCardService] Error', e);
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
