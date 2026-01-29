import axios from 'axios';
import { env } from '../config/env';
import { authRepository } from '../repository/auth/authRepository';
import { ApiError } from '../utils/errorHandler';
import { getZataSignedGetUrl, uploadDataUriToZata } from '../utils/storage/zataUpload';
import { startGeneration, markGenerationCompleted, markGenerationFailed } from './generationHistoryService';

export interface WildmindImageGenerateRequest {
  prompt: string;
  model?: string;
  n?: number;
  num_images?: number;
  seed?: number;
  frameSize?: string;
  style?: string;
  isPublic?: boolean;
}

export async function generateWildmindImage(uid: string, body: WildmindImageGenerateRequest): Promise<{ historyId: string; images: any[] }> {
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new ApiError('prompt is required', 400);

  const model = String(body.model || 'wildmindimage');
  const requestedRaw = body.num_images ?? body.n ?? 1;
  const requested = Math.max(1, Math.min(Number(requestedRaw) || 1, 4));

  const creator = await authRepository.getUserById(uid);
  const username = creator?.username || uid;

  const { historyId } = await startGeneration(uid, {
    prompt,
    model,
    generationType: 'text-to-image',
    frameSize: body.frameSize,
    ...(typeof body.isPublic === 'boolean' ? { isPublic: body.isPublic } : {}),
    ...(body.style ? { style: body.style } : {}),
  } as any);

  try {
    const baseUrl = env.wildmindImageServiceUrl;
    if (!baseUrl) throw new ApiError('WILDMINDIMAGE service URL not configured', 500);

    const url = `${baseUrl}/generate`;
    const resp = await axios.post(
      url,
      {
        prompt,
        seed: body.seed,
        num_images: requested,
      },
      {
        timeout: 15 * 60 * 1000,
        headers: {
          // Harmless for non-browser calls; avoids ngrok warning interstitials if they ever trigger.
          'ngrok-skip-browser-warning': 'true',
        },
      }
    );

    const images: unknown = resp?.data?.images;
    if (!Array.isArray(images) || images.length === 0) {
      throw new ApiError('No images returned from WILDMINDIMAGE service', 502);
    }

    const keyPrefix = `users/${username}/zata/${historyId}`;
    // Stored in history (stable public URLs)
    const storedImages = await Promise.all(
      images.slice(0, requested).map(async (dataUri: any, index: number) => {
        if (typeof dataUri !== 'string' || !dataUri.startsWith('data:image/')) {
          throw new ApiError('Invalid image data returned from WILDMINDIMAGE service', 502);
        }

        // Prefer uploading to Zata so the history stores stable URLs.
        // If Zata upload fails (e.g., creds/config), fall back to returning the data URI
        // so the frontend can still display the generated image.
        try {
          const stored = await uploadDataUriToZata({
            dataUri,
            keyPrefix,
            fileName: `output-${index + 1}`,
          });
          return {
            id: `${historyId}-img-${index}`,
            url: stored.publicUrl,
            originalUrl: stored.publicUrl,
            storagePath: stored.key,
            optimized: false,
          };
        } catch (uploadErr: any) {
          console.warn('[WILDMINDIMAGE] Zata upload failed; returning data URI instead', {
            historyId,
            index: index + 1,
            message: uploadErr?.message,
          });
          return {
            id: `${historyId}-img-${index}`,
            url: dataUri,
            originalUrl: dataUri,
            storagePath: null,
            optimized: false,
          };
        }
      })
    );

    // Response to client: prefer a short-lived signed URL when we have a storagePath.
    // This avoids transient 503s from the public Zata gateway immediately after upload.
    const responseImages = await Promise.all(
      storedImages.map(async (img: any) => {
        try {
          if (img?.storagePath && typeof img.storagePath === 'string') {
            const signedUrl = await getZataSignedGetUrl(img.storagePath, 10 * 60);
            return {
              ...img,
              // Keep originalUrl as stable public URL; url is for immediate display.
              url: signedUrl,
            };
          }
        } catch {
          // If signing fails, fall back to the public URL or data URI.
        }
        return img;
      })
    );

    await markGenerationCompleted(uid, historyId, {
      status: 'completed',
      images: storedImages,
      ...(typeof body.isPublic === 'boolean' ? { isPublic: body.isPublic } : {}),
      ...(body.frameSize ? { frameSize: body.frameSize } : {}),
      ...(body.style ? { style: body.style } : {}),
    } as any);

    return { historyId, images: responseImages };
  } catch (err: any) {
    const upstreamStatus: number | undefined = err?.response?.status;
    const upstreamBody: any = err?.response?.data;

    const message =
      upstreamBody?.message ||
      upstreamBody?.error ||
      err?.message ||
      'Failed to generate WILDMINDIMAGE';

    // Preserve explicit upstream client errors (e.g., NSFW prompt) rather than mapping to 502.
    const isClientError = typeof upstreamStatus === 'number' && upstreamStatus >= 400 && upstreamStatus < 500;
    const passthroughData =
      upstreamBody && typeof upstreamBody === 'object'
        ? upstreamBody
        : (isClientError ? { error: 'upstream_client_error' } : undefined);

    try {
      await markGenerationFailed(uid, historyId, { status: 'failed', error: message } as any);
    } catch {
      // ignore
    }

    if (err instanceof ApiError) throw err;
    if (isClientError) {
      throw new ApiError(message, upstreamStatus!, passthroughData);
    }
    throw new ApiError(message, 502, passthroughData);
  }
}
