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
    logo: string; // data URI or URL
    companyName: string;
    personName: string;
    designation: string;
    contact: string;
    style: string;
    color: string;
    sides: number; // 1 or 2
    isPublic?: boolean;
}

/**
 * Build a hard prompt for a single side of a business card.
 * The prompt explicitly positions each element and enforces spelling.
 */
const buildSidePrompt = (req: BusinessCardRequest, sideLabel: string) => {
    const base = `Create a high‑resolution professional business card (${sideLabel}).\n\n`;
    const layout = `Place the logo at the top‑left corner, sized appropriately.\nPlace the company name centered at the top, using a clean font.\nBelow it, place the person name in bold, followed by the designation.\nAt the bottom, include the contact details.\nApply the style "${req.style}" with the color "${req.color}". Ensure perfect alignment, no spelling mistakes, and a polished look.`;
    return base + layout;
};

export const generateBusinessCard = async (uid: string, req: BusinessCardRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = "qwen/qwen-image-edit-2511";

    const creator = await authRepository.getUserById(uid);

    // Upload logo if needed
    let logoUrl = req.logo;
    let logoStoragePath: string | undefined;
    if (logoUrl.startsWith("data:")) {
        const stored = await uploadDataUriToZata({
            dataUri: logoUrl,
            keyPrefix: `users/${creator?.username || uid}/business-card/${Date.now()}`,
            fileName: "logo",
        });
        logoUrl = stored.publicUrl;
        logoStoragePath = (stored as any).key;
    } else if (logoUrl.includes("/api/proxy/resource/")) {
        const parts = logoUrl.split("/api/proxy/resource/");
        if (parts.length > 1) {
            const keyPart = decodeURIComponent(parts[1]);
            const prefix = env.zataPrefix || "https://idr01.zata.ai/devstoragev1/";
            logoUrl = `${prefix}${keyPart}`;
            logoStoragePath = keyPart;
        }
    }

    // Record history
    const promptSummary = `Business Card (${req.sides === 2 ? "double" : "single"}) - ${req.companyName}, ${req.personName}`;
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: promptSummary,
        model: modelBase,
        generationType: "image-to-image",
        visibility: req.isPublic ? "public" : "private",
        isPublic: req.isPublic ?? true,
        createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
    } as any);

    const legacyId = await replicateRepository.createGenerationRecord(
        { prompt: promptSummary, model: modelBase, isPublic: req.isPublic ?? true },
        creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid }
    );

    // Helper to call replicate for a side
    const generateSide = async (sideLabel: string) => {
        const prompt = buildSidePrompt(req, sideLabel);
        const input = { image: [logoUrl], prompt, frameSize: "match_input_image", style: "none", output_format: "png" };
        const output: any = await replicate.run(modelBase as any, { input });
        const urls = Array.isArray(output) ? output.map(String) : [String(output)];
        return urls[0];
    };

    try {
        const frontUrl = await generateSide("front side");
        let backUrl: string | undefined;
        if (req.sides === 2) {
            backUrl = await generateSide("back side");
        }

        const images = [{ id: "front", url: frontUrl, originalUrl: frontUrl }];
        if (backUrl) images.push({ id: "back", url: backUrl, originalUrl: backUrl });

        const scored = await aestheticScoreService.scoreImages(
            images.map((img, idx) => ({ id: `bc-${Date.now()}-${idx}`, url: img.url, originalUrl: img.url }))
        );
        const highestScore = aestheticScoreService.getHighestScore(scored);

        await generationHistoryRepository.update(uid, historyId, {
            status: "completed",
            images: scored,
            aestheticScore: highestScore,
            updatedAt: new Date().toISOString(),
        } as any);
        await replicateRepository.updateGenerationRecord(legacyId, { status: "completed", images: scored as any });
        await syncToMirror(uid, historyId);

        return { images: scored, historyId, model: modelBase, status: "completed" };
    } catch (e: any) {
        console.error("[businessCardService] Error", e);
        await generationHistoryRepository.update(uid, historyId, { status: "failed", error: e?.message || "Generation failed" } as any);
        await replicateRepository.updateGenerationRecord(legacyId, { status: "failed", error: e?.message });
        throw new ApiError(e?.message || "Generation failed", 502, e);
    }
};
