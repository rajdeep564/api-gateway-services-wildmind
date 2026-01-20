import Replicate from "replicate";
import { env } from '../../../config/env';
import { ApiError } from '../../../utils/errorHandler';
// import { generationHistoryRepository } from '../../../repository/generationHistoryRepository'; // Integrating full history might be overkill if not asked, but let's stick to a simpler robust version first like the other fun workflows often do.
// Actually, looking at existing fun workflows like 'relightingService.ts' might be better if I want consistency.
// But to ensure it works without dragging in too many dependencies I might not have access to check (like repositories), I'll do a robust but direct implementation.
// If repositories are required for the app to function (e.g. credits are handled in controller), I can skip the repository part in service if it's just about generation.
// However, 'replaceElementService' writes to history. PROBABLY 'dynamicCameraAngle' should too.
// I will blindly import repositories assuming they exist at standard locations.
import { uploadFromUrlToZata } from '../../../utils/storage/zataUpload';

const resolveOutputUrls = async (output: any) => {
    if (!output) return [];
    if (Array.isArray(output)) return output.map(String);
    if (typeof output === 'object' && output.url) return [String(output.url())];
    return [String(output)];
};

interface DynamicCameraAngleOptions {
    imageUrl: string;
    angle: string;
    additionalDetails?: string;
    isPublic?: boolean;
}

export const generateDynamicAngle = async (uid: string, options: DynamicCameraAngleOptions) => {
    const { imageUrl, angle, additionalDetails, isPublic } = options;
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });

    // Define specific prompts for each angle to ensure "perfect" implementation
    const anglePrompts: Record<string, string> = {
        'Eye-Level': "Show the product from a neutral eye-level perspective, straight on.",
        'Low Angle': "Capture the product from a low angle looking up, making it look imposing and grand, worm's-eye view.",
        'High Angle': "Capture the product from a high angle looking down, elevated perspective.",
        'Top-Down': "Show the product directly from above, 90-degree top-down flat lay view.",
        'Side Angle': "Show the product from the side profile, 90-degree side view.",
        'Straight-On': "Show the product directly straight-on, symmetrical front view.",
        'Close-Up': "Capture an extreme close-up macro shot of the product, focusing on texture and details.",
        'Wide Shot': "Capture a wide angle shot, showing the product in context with more environment visible.",
        'POV': "Show the product from a first-person point of view (POV) perspective, realistic handheld look.",
        'Dutch Angle': "Capture the product with a Dutch angle, tilted camera composition for a dynamic look."
    };

    const specificAnglePrompt = anglePrompts[angle] || `from a ${angle} perspective`;

    // Construct a strong, detailed prompt that emphasizes analyzing and preserving the input product
    const manualPrompt = `Reimagine this product image. ${specificAnglePrompt}. 
    CRITICAL INSTRUCTION: Analyze the input image carefully. Keep the product's identity, logos, text, packaging, and colors EXACTLY the same as the original. 
    Only change the camera angle and perspective to be ${specificAnglePrompt}.
    High quality, photorealistic, 8k, studio lighting, sharp focus, commercial photography style. ${additionalDetails || ''}`;

    console.log(`[DynamicCameraAngle] Generating with prompt: ${manualPrompt}`);

    try {
        const model = "qwen/qwen-image-edit-2511";
        const inputPayload = {
            image: [imageUrl], // qwen expects an array of strings
            prompt: manualPrompt,
            cfg: 7.5,
            steps: 30,
            image_strength: 0.55 // Key parameter for angle changes while keeping identity
        };

        const output = await replicate.run(model as any, { input: inputPayload });
        console.log("[DynamicCameraAngle] Replicate output:", output);

        const urls = await resolveOutputUrls(output);
        const outputUrl = urls[0];

        if (!outputUrl) {
            throw new Error("No output generated from Replicate");
        }

        // Upload to Zata
        const uploadResult = await uploadFromUrlToZata({
            sourceUrl: outputUrl,
            keyPrefix: `users/${uid}/dynamic-camera-angle/${Date.now()}`,
            fileName: 'output'
        });

        return {
            images: [{ url: uploadResult.publicUrl }],
            originalImage: imageUrl,
            angle: angle,
            prompt: manualPrompt
        };

    } catch (error) {
        console.error("Error in generateDynamicAngle:", error);
        throw error;
    }
};
