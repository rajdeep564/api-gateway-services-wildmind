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

export interface PoseControlRequest {
    image: string; // Model Image (Target Identity)
    pose_image?: string; // Optional Pose Reference
    pose_description?: string; // Optional text description if pose_image is missing
    isPublic?: boolean;
}

export const generatePoseControl = async (uid: string, req: PoseControlRequest) => {
    const key = env.replicateApiKey as string;
    if (!key) throw new ApiError("Replicate API key not configured", 500);

    const replicate = new Replicate({ auth: key });
    const modelBase = 'qwen/qwen-image-edit-2511';

    const creator = await authRepository.getUserById(uid);

    // Prompt Construction Logic
    let hardPrompt = "";

    if (req.pose_image) {
        // SCENARIO 1: Two Images (Identity + Pose Reference)
        hardPrompt = `Take the person from image and recreate them in the exact same pose as the person in pose_image.
        
Instructions:
1. IDENTITY (image): Is strictly preserved. Keep the face, hair, body shape, and clothing of image exactly as is.
2. POSE (pose_image): Copy the full body posture precisely—arm angles, leg position, torso tilt, head orientation.
3. OUTPUT: The person from Image 0, but standing/sitting exactly like the person in pose_image.
4. Background: Keep the background consistent with Image 0 or neutral if needed to fit the pose.`;
    } else {
        // SCENARIO 2: One Image + Text Description
        const poseDesc = req.pose_description || "standing confidently";
        hardPrompt = `Take the person from the input image and change their pose to be: ${poseDesc}.

Instructions:
1. IDENTITY: Strictly preserved. Keep the face, hair, body shape, and clothing exactly as is.
2. POSE: Change the pose to match the description: "${poseDesc}".
3. OUTPUT: The same person, same clothes, but in the new pose.
4. Background: Preserve original background if possible, or adapt naturally.`;
    }

    // 1. Create History Record
    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: req.pose_description || "Pose Control",
        model: modelBase,
        generationType: "image-to-image",
        visibility: req.isPublic ? "public" : "private",
        isPublic: req.isPublic ?? true,
        createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
    } as any);

    // 2. Create Legacy Record
    const legacyId = await replicateRepository.createGenerationRecord(
        {
            prompt: req.pose_description || "Pose Control",
            model: modelBase,
            isPublic: req.isPublic ?? true
        },
        creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid }
    );

    // 3. Handle Input Images
    const handleInputImage = async (url: string, suffix: string) => {
        if (!url) return { url: null, path: null };

        let inputImageUrl = url;
        let inputImageStoragePath: string | undefined;

        if (inputImageUrl.startsWith('data:')) {
            const username = creator?.username || uid;
            const stored = await uploadDataUriToZata({
                dataUri: inputImageUrl,
                keyPrefix: `users/${username}/input/${historyId}`,
                fileName: `source-${suffix}`,
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
        return { url: inputImageUrl, path: inputImageStoragePath };
    };

    const modelInput = await handleInputImage(req.image, 'model'); // Image 0
    const poseInput = await handleInputImage(req.pose_image || '', 'pose'); // Image 1 (Optional)

    // Update history with inputs
    const inputImages = [];
    if (modelInput.path) inputImages.push({ id: "in-model", url: modelInput.url, storagePath: modelInput.path });
    if (poseInput.path) inputImages.push({ id: "in-pose", url: poseInput.url, storagePath: poseInput.path });

    if (inputImages.length > 0) {
        await generationHistoryRepository.update(uid, historyId, {
            inputImages: inputImages
        } as any);
    }

    // 4. Construct Payload
    const imageList = [modelInput.url];
    if (poseInput.url) {
        imageList.push(poseInput.url); // [Image 0, Image 1]
    }

    const inputPayload = {
        image: imageList,
        prompt: hardPrompt,
        frameSize: "match_input_image",
        style: "none",
        output_format: "png"
    };

    try {
        console.log('[poseControlService] Running model', { model: modelBase, input: inputPayload });
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
                fileName: "pose-control-1",
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
        console.error('[poseControlService] Error', e);
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
