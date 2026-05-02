import { env } from '../../../config/env';
import { ApiError } from '../../../utils/errorHandler';
import { authRepository } from '../../../repository/auth/authRepository';
import { generationHistoryRepository } from '../../../repository/generationHistoryRepository';
import { replicateRepository } from '../../../repository/replicateRepository';
import { uploadDataUriToZata, uploadFromUrlToZata } from '../../../utils/storage/zataUpload';
import { aestheticScoreService } from '../../aestheticScoreService';
import { syncToMirror } from '../../../utils/mirrorHelper';
import sharp from 'sharp';

const BEEBLE_BASE_URL = 'https://api.beeble.ai/v1';
const MODEL_DISPLAY = 'beeble/switchx';
const BEEBLE_MAX_SOURCE_PIXELS = 2_770_000;

type SwitchXStatus = 'in_queue' | 'processing' | 'completed' | 'failed';

interface SwitchXStatusResponse {
    id: string;
    status: SwitchXStatus | string;
    progress?: number | null;
    output?: {
        render?: string | null;
        source?: string | null;
        alpha?: string | null;
    } | null;
    error?: string | null;
    created_at?: string | null;
    modified_at?: string | null;
    completed_at?: string | null;
}

interface BeebleUploadResponse {
    id: string;
    upload_url: string;
    beeble_uri: string;
}

type BeebleMediaType = 'image' | 'video';

function extractProviderErrorMessage(payload: any, fallback: string): string {
    if (!payload) return fallback;
    if (typeof payload === 'string' && payload.trim()) return payload;
    if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message;
    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
    if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) return payload.error.message;
    if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail;
    try {
        const str = JSON.stringify(payload);
        if (str && str !== '{}' && str !== 'null') return str;
    } catch {
        // ignore
    }
    return fallback;
}

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
    // Beeble-native request controls
    beeblePrompt?: string;
    referenceImageUri?: string;
    alphaMode?: 'auto' | 'fill' | 'custom' | 'select';
    alphaUri?: string;
    maxResolution?: 720 | 1080;
    /** When true, wrap the user prompt with strict instructions to only change illumination and preserve background/scene. */
    lightingOnly?: boolean;
}

/** Strict relight-only instruction for locked-background mode. */
const RELIGHT_LIGHTING_ONLY_INSTRUCTION =
    'Relight only. Keep subject identity, pose, camera angle, framing, background, and object positions exactly the same. ' +
    'Do not add, remove, move, or replace any subject/object/background element. ' +
    'Change only lighting and its effects: light direction, intensity, color temperature, exposure, highlights, and shadows.';

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

function extensionFromMime(mime: string | null | undefined): string {
    const m = (mime || '').toLowerCase();
    if (m.includes('image/png')) return '.png';
    if (m.includes('image/webp')) return '.webp';
    if (m.includes('image/jpeg') || m.includes('image/jpg')) return '.jpg';
    if (m.includes('video/mp4')) return '.mp4';
    if (m.includes('video/quicktime')) return '.mov';
    return '.png';
}

function extensionFromUrl(url: string): string {
    const clean = url.split('?')[0].toLowerCase();
    if (clean.endsWith('.png')) return '.png';
    if (clean.endsWith('.webp')) return '.webp';
    if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return '.jpg';
    if (clean.endsWith('.mp4')) return '.mp4';
    if (clean.endsWith('.mov')) return '.mov';
    return '.png';
}

async function uploadToBeeble(beebleKey: string, sourceUri: string, historyId: string): Promise<{ beebleUri: string; mediaType: BeebleMediaType }> {
    if (sourceUri.startsWith('beeble://')) {
        const lower = sourceUri.toLowerCase();
        const mediaType: BeebleMediaType = (lower.endsWith('.mp4') || lower.endsWith('.mov')) ? 'video' : 'image';
        return { beebleUri: sourceUri, mediaType };
    }

    let bytes: Uint8Array;
    let contentType = 'image/png';
    let ext = '.png';
    let mediaType: BeebleMediaType = 'image';

    if (sourceUri.startsWith('data:')) {
        const match = sourceUri.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
        if (!match || !match[2]) throw new ApiError('Invalid data URI for Beeble upload', 400);
        contentType = match[1] || 'image/png';
        mediaType = contentType.startsWith('video/') ? 'video' : 'image';
        ext = extensionFromMime(contentType);
        const payload = match[2];
        const isBase64 = sourceUri.includes(';base64,');
        const raw = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
        bytes = new Uint8Array(raw);
    } else {
        const srcRes = await fetch(sourceUri);
        if (!srcRes.ok) {
            throw new ApiError(`Failed to fetch source for Beeble upload (${srcRes.status})`, 502);
        }
        const arrBuf = await srcRes.arrayBuffer();
        bytes = new Uint8Array(arrBuf);
        contentType = srcRes.headers.get('content-type') || 'image/png';
        mediaType = contentType.startsWith('video/') ? 'video' : 'image';
        ext = extensionFromMime(contentType) || extensionFromUrl(sourceUri);
        if (ext === '.mp4' || ext === '.mov') mediaType = 'video';
    }

    // Beeble rejects sources above 2,770,000 pixels.
    // Downscale oversized images automatically before upload.
    try {
        if (contentType.startsWith('image/')) {
            const srcBuffer = Buffer.from(bytes);
            const img = sharp(srcBuffer);
            const meta = await img.metadata();
            const width = Number(meta.width || 0);
            const height = Number(meta.height || 0);
            const pixels = width * height;

            if (width > 0 && height > 0 && pixels > BEEBLE_MAX_SOURCE_PIXELS) {
                const scale = Math.sqrt(BEEBLE_MAX_SOURCE_PIXELS / pixels);
                const targetW = Math.max(1, Math.floor(width * scale));
                const targetH = Math.max(1, Math.floor(height * scale));
                const resized = await img
                    .resize(targetW, targetH, { fit: 'inside', withoutEnlargement: true })
                    .png()
                    .toBuffer();
                bytes = new Uint8Array(resized);
                contentType = 'image/png';
                ext = '.png';
                console.log('[relightingService] Downscaled source for Beeble', {
                    from: `${width}x${height}`,
                    to: `${targetW}x${targetH}`,
                    pixelsBefore: pixels,
                    pixelsAfter: targetW * targetH,
                });
            }
        }
    } catch (resizeErr) {
        console.warn('[relightingService] Failed to inspect/resize source before Beeble upload', resizeErr);
    }

    const filename = `relight-${historyId}${ext}`;
    const createUploadRes = await fetch(`${BEEBLE_BASE_URL}/uploads`, {
        method: 'POST',
        headers: {
            'x-api-key': beebleKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename }),
    });
    const createUploadText = await createUploadRes.text();
    let uploadData: BeebleUploadResponse;
    try {
        uploadData = createUploadText ? JSON.parse(createUploadText) : ({} as BeebleUploadResponse);
    } catch {
        throw new ApiError(`Beeble upload URL response parse failed (${createUploadRes.status})`, 502, createUploadText);
    }
    if (!createUploadRes.ok || !uploadData?.upload_url || !uploadData?.beeble_uri) {
        throw new ApiError('Failed to create Beeble upload URL', 502, uploadData);
    }

    const putRes = await fetch(uploadData.upload_url, {
        method: 'PUT',
        headers: {
            'Content-Type': contentType,
        },
        body: Buffer.from(bytes),
    });
    if (!putRes.ok) {
        const body = await putRes.text().catch(() => '');
        throw new ApiError(`Beeble upload PUT failed (${putRes.status})`, 502, body);
    }

    return { beebleUri: uploadData.beeble_uri, mediaType };
}

export const relighting = async (uid: string, req: RelightingRequest) => {
    const beebleKey = env.beebleApiKey as string;
    if (!beebleKey) throw new ApiError('BEEBLE API key not configured', 500);

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

    const pollSwitchX = async (jobId: string, timeoutMs = 480000): Promise<SwitchXStatusResponse> => {
        const startedAt = Date.now();
        let attempts = 0;
        while (Date.now() - startedAt < timeoutMs) {
            attempts += 1;
            const statusRes = await fetch(`${BEEBLE_BASE_URL}/switchx/generations/${encodeURIComponent(jobId)}`, {
                method: 'GET',
                headers: {
                    'x-api-key': beebleKey,
                    'Content-Type': 'application/json',
                },
            });
            const statusText = await statusRes.text();
            let statusData: SwitchXStatusResponse;
            try {
                statusData = statusText ? JSON.parse(statusText) : ({} as SwitchXStatusResponse);
            } catch {
                throw new ApiError(`Beeble status parse failed (${statusRes.status})`, 502, statusText);
            }
            if (!statusRes.ok) {
                const msg = extractProviderErrorMessage(statusData, `Beeble status failed with ${statusRes.status}`);
                throw new ApiError(msg, 502, statusData);
            }
            if (statusData.status === 'completed' || statusData.status === 'failed') {
                return statusData;
            }
            if (attempts % 5 === 0) {
                console.log('[relightingService] Waiting Beeble SwitchX job', {
                    jobId,
                    status: statusData.status,
                    progress: statusData.progress ?? null,
                });
            }
            // Slightly slower poll to reduce provider pressure during long renders.
            await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        throw new ApiError('Beeble SwitchX job timed out while processing (8m). Please retry.', 504);
    };

    try {
        const sourceUpload = await uploadToBeeble(beebleKey, inputImageUrl, historyId);
        const beebleSourceUri = sourceUpload.beebleUri;
        const alphaMode = req.alphaMode || 'auto';
        const maxResolution = req.maxResolution === 720 ? 720 : 1080;
        const beeblePrompt = String(req.beeblePrompt || '').trim();
        if (!beeblePrompt) {
            throw new ApiError('Prompt is required for Beeble relight', 400);
        }
        if (beeblePrompt.length > 2000) {
            throw new ApiError('Prompt must be 2000 characters or fewer', 400);
        }
        // Temporarily disabled for testing: do not apply base prompt instruction.
        const shouldApplyLightingOnly = false;
        const finalBeeblePrompt = shouldApplyLightingOnly
            ? `${RELIGHT_LIGHTING_ONLY_INSTRUCTION}\nLighting request: ${beeblePrompt}`
            : beeblePrompt;
        if (finalBeeblePrompt.length > 2000) {
            throw new ApiError(
                'Combined prompt exceeds 2000 characters. Shorten your text or turn off base prompt (lighting-only) mode.',
                400,
            );
        }

        let beebleReferenceUri: string | undefined;
        if (req.referenceImageUri) {
            const refUpload = await uploadToBeeble(beebleKey, req.referenceImageUri, `${historyId}-ref`);
            beebleReferenceUri = refUpload.beebleUri;
        }

        let beebleAlphaUri: string | undefined;
        if (req.alphaUri && (alphaMode === 'custom' || alphaMode === 'select')) {
            const alphaUpload = await uploadToBeeble(beebleKey, req.alphaUri, `${historyId}-alpha`);
            beebleAlphaUri = alphaUpload.beebleUri;
        }

        console.log('[relightingService] Beeble SwitchX create job', {
            image: String(beebleSourceUri).slice(0, 120),
            generationType: sourceUpload.mediaType,
        });
        const createBody: Record<string, unknown> = {
            generation_type: sourceUpload.mediaType,
            source_uri: beebleSourceUri,
            alpha_mode: alphaMode,
            prompt: finalBeeblePrompt,
            max_resolution: maxResolution,
            idempotency_key: `relight-${historyId}-${uid}`.slice(0, 255),
        };
        if (beebleReferenceUri) createBody.reference_image_uri = beebleReferenceUri;
        if (beebleAlphaUri) createBody.alpha_uri = beebleAlphaUri;

        const createRes = await fetch(`${BEEBLE_BASE_URL}/switchx/generations`, {
            method: 'POST',
            headers: {
                'x-api-key': beebleKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(createBody),
        });
        const createText = await createRes.text();
        let createdJob: SwitchXStatusResponse;
        try {
            createdJob = createText ? JSON.parse(createText) : ({} as SwitchXStatusResponse);
        } catch {
            throw new ApiError(`Beeble create response parse failed (${createRes.status})`, 502, createText);
        }
        if (!createRes.ok || !createdJob?.id) {
            const msg = extractProviderErrorMessage(createdJob, `Beeble create failed with ${createRes.status}`);
            throw new ApiError(msg, 502, createdJob);
        }

        const result = await pollSwitchX(createdJob.id);

        await generationHistoryRepository.update(uid, historyId, {
            provider: 'beeble',
            providerTaskId: result?.id || createdJob.id,
            status: 'processing',
        } as any);

        if (result.status === 'failed') {
            throw new ApiError(result.error || 'Beeble SwitchX generation failed', 502, result);
        }

        const firstUrl = result?.output?.render || result?.output?.source;
        if (!firstUrl) throw new Error('No output URL from Beeble SwitchX relight');

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
            // Keep persisted Zata URL once upload succeeds.
            // The previous HEAD verification could incorrectly fail on some environments
            // and caused fallback to temporary provider URLs, which then disappear from library.
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
