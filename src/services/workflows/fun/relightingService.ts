import { fal } from '@fal-ai/client';
import { env } from '../../../config/env';
import { ApiError } from '../../../utils/errorHandler';
import { authRepository } from '../../../repository/auth/authRepository';
import { generationHistoryRepository } from '../../../repository/generationHistoryRepository';
import { replicateRepository } from '../../../repository/replicateRepository';
import { uploadDataUriToZata, uploadFromUrlToZata } from '../../../utils/storage/zataUpload';
import { aestheticScoreService } from '../../aestheticScoreService';
import { syncToMirror } from '../../../utils/mirrorHelper';

const FAL_MODEL_EDIT = 'fal-ai/nano-banana-pro/edit';
const MODEL_DISPLAY = 'google/nano-banana-pro';

export interface RelightDirectionalLightInput {
    id?: string;
    type?: string;
    name?: string;
    enabled?: boolean;
    intensity?: number;
    color?: string;
    azimuthDeg?: number;
    elevationDeg?: number;
    distance?: number;
}

export interface RelightingLightingPayload {
    ambientIntensity?: number;
    lights?: RelightDirectionalLightInput[];
}

export interface RelightingRequest {
    imageUrl: string;
    isPublic?: boolean;
    lightingStyle: string;
    additionalText?: string;
    lightDirection?: string;
    lightIntensity?: string;
    shadowControl?: string;
    /** Rich rig from canvas: ambient + multiple directionals (angles, colors, intensity). */
    lighting?: RelightingLightingPayload;
}

function lightingStyleNarrative(lightingStyle: string): string {
    switch (lightingStyle) {
        case 'Natural':
            return 'Soft, balanced daylight. Even exposure with natural sun direction. Avoid harsh artificial tints.';
        case 'Studio':
            return 'Professional studio look: three-point feel with key, fill, and rim. Clean readable shadows, controlled contrast.';
        case 'Cinematic':
            return 'Cinematic grade: dramatic contrast, depth, and mood; subtle color separation acceptable if it serves the story.';
        case 'Dramatic':
            return 'High contrast chiaroscuro: deep shadows, selective highlights, emotional intensity.';
        case 'Soft Diffused':
            return 'Very soft wrap-around light (overcast / large softbox). Minimal hard edges, flattering and dreamy.';
        case 'Moody':
            return 'Dark atmospheric mood: localized pools of light, desaturated shadows, somber tone.';
        default:
            return 'Professional lighting enhancement with balanced exposure and pleasing color.';
    }
}

function buildStructuredLightingRig(lighting?: RelightingLightingPayload): string {
    const ambRaw = lighting?.ambientIntensity;
    const amb =
        ambRaw === undefined || ambRaw === null || !Number.isFinite(Number(ambRaw))
            ? 0.5
            : Math.max(0, Math.min(2, Number(ambRaw)));
    const lines: string[] = [];
    lines.push(
        `GLOBAL AMBIENT / FILL: ${amb.toFixed(2)} on a 0–2 scale (0 = none, ~1 = natural bounce, 2 = strong fill that lifts shadows).`,
    );
    lines.push('');

    const list = Array.isArray(lighting?.lights) ? lighting!.lights! : [];
    const active = list.filter((l) => l && l.enabled !== false);

    if (active.length === 0) {
        lines.push(
            'DIRECTIONAL SOURCES: none marked active — infer a single plausible key + fill that still matches the mood below.',
        );
        return lines.join('\n');
    }

    lines.push(
        `DIRECTIONAL LIGHTS (${active.length} active — combine all; each contributes tinted illumination and shadow components):`,
    );

    active.forEach((l, i) => {
        const name = String(l.name || `Light ${i + 1}`).replace(/[\r\n]+/g, ' ').slice(0, 48);
        const col = typeof l.color === 'string' && l.color.trim() ? l.color.trim() : '#ffffff';
        const inten = Math.max(0, Math.min(3, Number.isFinite(Number(l.intensity)) ? Number(l.intensity) : 0.8));
        const az = Number.isFinite(Number(l.azimuthDeg)) ? Number(l.azimuthDeg) : 0;
        const el = Math.max(-80, Math.min(80, Number.isFinite(Number(l.elevationDeg)) ? Number(l.elevationDeg) : 25));
        const dist = Math.max(2, Math.min(20, Number.isFinite(Number(l.distance)) ? Number(l.distance) : 10));
        lines.push(
            `${i + 1}) "${name}": gel / light color ${col}; relative strength ${inten.toFixed(2)} (0–3 vs other lights). ` +
                `Horizontal azimuth ${az.toFixed(0)}° (0° = from +Z toward subject; 90° = from +X; ±180° = from −Z; −90° = from −X). ` +
                `Vertical elevation ${el.toFixed(0)}° (positive = above horizon / top-side key; negative = low rim from below). ` +
                `Distance / softness ${dist.toFixed(1)} (2 = tighter harder source; 20 = broad softer distant source).`,
        );
    });

    const disabled = list.filter((l) => l && l.enabled === false);
    if (disabled.length > 0) {
        lines.push('');
        lines.push(
            `DISABLED (do not use as light sources): ${disabled.map((l) => String(l.name || 'light').slice(0, 24)).join('; ')}.`,
        );
    }

    return lines.join('\n');
}

function buildNanoBananaProRelightPrompt(req: RelightingRequest): string {
    const style = lightingStyleNarrative(req.lightingStyle || 'Natural');
    const rig = buildStructuredLightingRig(req.lighting);

    const extras: string[] = [];
    if (req.lightDirection) extras.push(`LEGACY NOTE — LIGHT DIRECTION: ${req.lightDirection}`);
    if (req.lightIntensity) extras.push(`LEGACY NOTE — INTENSITY: ${req.lightIntensity}`);
    if (req.shadowControl) extras.push(`LEGACY NOTE — SHADOWS: ${req.shadowControl}`);
    if (req.additionalText) extras.push(`USER EXTRA INSTRUCTIONS: ${req.additionalText}`);
    const extrasBlock = extras.length ? `\n\n${extras.join('\n')}` : '';

    return `You are Google Nano Banana Pro (image-to-image). The attached image is the only source photograph.

PRIMARY TASK: Relight this exact image to match BOTH (1) the numeric multi-light rig below and (2) the artistic mood. Preserve subject identity, face, pose, materials, composition, camera angle, and scene layout. Do not add or remove objects, text, or logos. Do not change art style beyond lighting and grade.

LIGHTING RIG (follow numerically; multiple lights must blend):
${rig}

ARTISTIC MOOD (overall look on top of the rig):
Style preset: "${req.lightingStyle || 'Natural'}".
${style}

CONSTRAINTS:
- Photorealistic output; match input framing and aspect.
- Respect each active light's color as illumination tint (key, fill, rim, bounce).
- Cast and contact shadows should be coherent with the strongest lights; ambient level controls shadow floor.
- Output one image only.${extrasBlock}`;
}

export const relighting = async (uid: string, req: RelightingRequest) => {
    const falKey = env.falKey as string;
    if (!falKey) throw new ApiError('FAL API key not configured', 500);

    fal.config({ credentials: falKey });

    const creator = await authRepository.getUserById(uid);
    const finalPrompt = buildNanoBananaProRelightPrompt(req);

    const { historyId } = await generationHistoryRepository.create(uid, {
        prompt: `Relight (${req.lightingStyle || 'Natural'}): ${finalPrompt.slice(0, 4000)}`,
        model: MODEL_DISPLAY,
        generationType: 'image-to-image',
        visibility: req.isPublic ? 'public' : 'private',
        isPublic: req.isPublic ?? true,
        createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
    } as any);

    const legacyId = await replicateRepository.createGenerationRecord(
        {
            prompt: finalPrompt,
            model: MODEL_DISPLAY,
            isPublic: req.isPublic ?? true,
        },
        creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
    );

    let inputImageUrl = req.imageUrl;
    let inputImageStoragePath: string | undefined;

    if (inputImageUrl.startsWith('data:')) {
        const username = creator?.username || uid;
        const stored = await uploadDataUriToZata({
            dataUri: inputImageUrl,
            keyPrefix: `users/${username}/input/relighting/${historyId}`,
            fileName: 'source',
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
            inputImages: [{ id: 'in-1', url: inputImageUrl, storagePath: inputImageStoragePath }],
        } as any);
    }

    const inputPayload: Record<string, unknown> = {
        prompt: finalPrompt,
        image_urls: [inputImageUrl],
        num_images: 1,
        aspect_ratio: 'auto',
        output_format: 'png',
        resolution: '2K',
    };

    try {
        console.log('[relightingService] FAL Nano Banana Pro /edit', { model: FAL_MODEL_EDIT, image: String(inputImageUrl).slice(0, 120) });
        const result: any = await fal.subscribe(FAL_MODEL_EDIT, {
            input: inputPayload,
            logs: true,
            onQueueUpdate: (update) => {
                if (update.status === 'IN_PROGRESS') {
                    update.logs?.map((log) => log.message).forEach((msg) => console.log('[relightingService]', msg));
                }
            },
        });

        await generationHistoryRepository.update(uid, historyId, {
            provider: 'fal',
            providerTaskId: result?.requestId || 'subscribe-based',
            status: 'processing',
        } as any);

        const imagesArray: any[] = Array.isArray(result?.data?.images) ? result.data.images : [];
        const firstUrl =
            imagesArray[0]?.url ||
            (Array.isArray((result as any)?.images) ? (result as any).images[0]?.url : undefined) ||
            (result as any)?.data?.image?.url ||
            (result as any)?.image?.url;
        if (!firstUrl) throw new Error('No output URL from Nano Banana Pro relight');

        let storedUrl = String(firstUrl);
        let storagePath = '';
        try {
            const username = creator?.username || uid;
            const uploaded = await uploadFromUrlToZata({
                sourceUrl: storedUrl,
                keyPrefix: `users/${username}/image/relighting/${historyId}`,
                fileName: `relighted-${Date.now()}`,
            });
            storedUrl = uploaded.publicUrl;
            storagePath = uploaded.key;
        } catch (e) {
            console.warn('Failed to upload relight output to Zata', e);
        }

        const images = [
            {
                id: `fal-${Date.now()}`,
                url: storedUrl,
                storagePath,
                originalUrl: String(firstUrl),
            },
        ];

        const scoredImages = await aestheticScoreService.scoreImages(images);
        const highestScore = aestheticScoreService.getHighestScore(scoredImages);

        await generationHistoryRepository.update(uid, historyId, {
            status: 'completed',
            images: scoredImages,
            aestheticScore: highestScore,
            updatedAt: new Date().toISOString(),
        } as any);

        await replicateRepository.updateGenerationRecord(legacyId, {
            status: 'completed',
            images: scoredImages as any,
        });

        await syncToMirror(uid, historyId);

        return {
            images: scoredImages,
            historyId,
            model: MODEL_DISPLAY,
            status: 'completed' as const,
        };
    } catch (e: any) {
        console.error('[relightingService] Error', e);
        const msg = e?.body?.detail || e?.message || 'Generation failed';
        await generationHistoryRepository.update(uid, historyId, {
            status: 'failed',
            error: typeof msg === 'string' ? msg : JSON.stringify(msg),
        } as any);
        await replicateRepository.updateGenerationRecord(legacyId, {
            status: 'failed',
            error: typeof msg === 'string' ? msg : JSON.stringify(msg),
        });
        throw new ApiError(typeof msg === 'string' ? msg : 'Relight failed', 502, e);
    }
};
