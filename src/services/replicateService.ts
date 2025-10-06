// Use dynamic import signature to avoid type requirement during build-time
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Replicate = require('replicate');
import { ApiError } from '../utils/errorHandler';
import { env } from '../config/env';
import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { generationsMirrorRepository } from '../repository/generationsMirrorRepository';
import { authRepository } from '../repository/auth/authRepository';
import { uploadFromUrlToZata, uploadDataUriToZata } from '../utils/storage/zataUpload';
import { replicateRepository } from '../repository/replicateRepository';

const DEFAULT_BG_MODEL_A = '851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc';
const DEFAULT_BG_MODEL_B = 'lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1';

// Version map for community models that require explicit version hashes
const DEFAULT_VERSION_BY_MODEL: Record<string, string> = {
  'fermatresearch/magic-image-refiner': '507ddf6f977a7e30e46c0daefd30de7d563c72322f9e4cf7cbac52ef0f667b13',
  'philz1337x/clarity-upscaler': 'dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e',
  '851-labs/background-remover': 'a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc',
  'lucataco/remove-bg': '95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1',
  'nightmareai/real-esrgan': 'f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa',
  'mv-lab/swin2sr': 'a01b0512004918ca55d02e554914a9eca63909fa83a29ff0f115c78a7045574f',
};

function composeModelSpec(modelBase: string, maybeVersion?: string): string {
  const version = maybeVersion || DEFAULT_VERSION_BY_MODEL[modelBase];
  return version ? `${modelBase}:${version}` : modelBase;
}

function clamp(n: any, min: number, max: number): number {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function extractFirstUrl(output: any): string {
  try {
    if (!output) return '';
    if (typeof output === 'string') return output;
    if (Array.isArray(output)) {
      const item = output[0];
      if (!item) return '';
      if (typeof item === 'string') return item;
      if (item && typeof item.url === 'function') return String(item.url());
      if (item && typeof item.url === 'string') return String(item.url);
      return '';
    }
    if (typeof output.url === 'function') return String(output.url());
    if (typeof output.url === 'string') return String(output.url);
    return '';
  } catch {
    return '';
  }
}

async function resolveItemUrl(item: any): Promise<string> {
  try {
    if (!item) return '';
    if (typeof item === 'string') return item;
    // Replicate SDK file-like item: item.url() may be sync or async
    const maybeUrlFn = (item as any).url;
    if (typeof maybeUrlFn === 'function') {
      const result = maybeUrlFn.call(item);
      if (result && typeof (result as any).then === 'function') {
        const awaited = await result;
        return typeof awaited === 'string' ? awaited : '';
      }
      return typeof result === 'string' ? result : '';
    }
    return '';
  } catch {
    return '';
  }
}

async function resolveOutputUrls(output: any): Promise<string[]> {
  try {
    if (!output) return [];
    if (Array.isArray(output)) {
      const urls: string[] = [];
      for (const it of output) {
        const u = await resolveItemUrl(it);
        if (u) urls.push(u);
      }
      return urls;
    }
    const single = await resolveItemUrl(output);
    return single ? [single] : [];
  } catch {
    return [];
  }
}

export async function removeBackground(uid: string, body: {
  image: string;
  model?: string;
  format?: 'png' | 'jpg' | 'jpeg' | 'webp';
  reverse?: boolean;
  threshold?: number;
  background_type?: string;
  isPublic?: boolean;
}) {
  const key = ((env as any).replicateApiKey as string) || (process.env.REPLICATE_API_TOKEN as string);
  if (!key) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.removeBackground] Missing REPLICATE_API_TOKEN');
    throw new ApiError('Replicate API key not configured', 500);
  }
  if (!body?.image) throw new ApiError('image is required', 400);

  const replicate = new Replicate({ auth: key });

  const creator = await authRepository.getUserById(uid);
  const legacyId = await replicateRepository.createGenerationRecord({ prompt: '[Remove background]', model: body.model || DEFAULT_BG_MODEL_A, isPublic: body.isPublic === true }, creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid });
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: '[Remove background]',
    model: body.model || DEFAULT_BG_MODEL_A,
    generationType: 'text-to-image',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
  } as any);

  // Prepare input based on model
  const modelBase = body.model && body.model.length > 0 ? body.model : DEFAULT_BG_MODEL_A.split(':')[0];
  // If we receive a data URI, persist to Zata and use the public URL for Replicate
  let imageForProvider = body.image;
  if (typeof imageForProvider === 'string' && imageForProvider.startsWith('data:')) {
    try {
      const username = creator?.username || uid;
      const stored = await uploadDataUriToZata({ dataUri: imageForProvider, keyPrefix: `users/${username}/input/${historyId}`, fileName: 'source' });
      imageForProvider = stored.publicUrl;
    } catch {}
  }
  const input: Record<string, any> = { image: imageForProvider };
  if (modelBase.startsWith('851-labs/background-remover')) {
    if (body.format) input.format = body.format;
    if (typeof body.reverse === 'boolean') input.reverse = body.reverse;
    if (typeof body.threshold === 'number') input.threshold = body.threshold;
    if (body.background_type) input.background_type = body.background_type;
  }

  let outputUrl = '';
  const version = (body as any).version as string | undefined;
  const modelSpec = composeModelSpec(modelBase, version);
  try {
    // eslint-disable-next-line no-console
    console.log('[replicateService.removeBackground] run', { modelSpec, input });
    const output: any = await replicate.run(modelSpec as any, { input });
    // eslint-disable-next-line no-console
    console.log('[replicateService.removeBackground] output', typeof output, Array.isArray(output) ? output.length : 'n/a');
    // Resolve possible file-like outputs
    const urls = await resolveOutputUrls(output);
    outputUrl = urls[0] || '';
    if (!outputUrl) throw new Error('No output URL returned by Replicate');
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.removeBackground] error', e?.message || e);
    try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'failed', error: e?.message || 'Replicate failed' }); } catch {}
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate failed' } as any);
    throw new ApiError('Replicate generation failed', 502, e);
  }

  // Upload to Zata
  let storedUrl = outputUrl;
  let storagePath = '';
  try {
    const username = creator?.username || uid;
    const uploaded = await uploadFromUrlToZata({ sourceUrl: outputUrl, keyPrefix: `users/${username}/image/${historyId}`, fileName: 'image-1' });
    storedUrl = uploaded.publicUrl;
    storagePath = uploaded.key;
  } catch {
    // fallback keep provider URL
  }

  await generationHistoryRepository.update(uid, historyId, {
    status: 'completed',
    images: [{ id: `replicate-${Date.now()}`, url: storedUrl, storagePath, originalUrl: outputUrl } as any],
  } as any);
  try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'completed', images: [{ id: `replicate-${Date.now()}`, url: storedUrl, storagePath, originalUrl: outputUrl }] }); } catch {}

  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh) await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
      uid,
      username: creator?.username,
      displayName: (creator as any)?.displayName,
      photoURL: creator?.photoURL,
    });
  } catch {}

  return { images: [{ id: `replicate-${Date.now()}`, url: storedUrl, storagePath, originalUrl: outputUrl }], historyId, model: modelBase, status: 'completed' } as any;
}

export async function upscale(uid: string, body: any) {
  const key = ((env as any).replicateApiKey as string) || (process.env.REPLICATE_API_TOKEN as string);
  if (!key) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.upscale] Missing REPLICATE_API_TOKEN');
    throw new ApiError('Replicate API key not configured', 500);
  }
  if (!body?.image) throw new ApiError('image is required', 400);

  const replicate = new Replicate({ auth: key });

  const modelBase = (body.model && body.model.length > 0 ? String(body.model) : 'philz1337x/clarity-upscaler').trim();
  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: '[Upscale]',
    model: modelBase,
    generationType: 'text-to-image',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
  } as any);

  const legacyId = await replicateRepository.createGenerationRecord({ prompt: '[Upscale]', model: modelBase, isPublic: body.isPublic === true }, creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid });

  // If we receive a data URI, persist to Zata and use the public URL for Replicate
  if (typeof body.image === 'string' && body.image.startsWith('data:')) {
    try {
      const username = creator?.username || uid;
      const stored = await uploadDataUriToZata({ dataUri: body.image, keyPrefix: `users/${username}/input/${historyId}`, fileName: 'source' });
      body.image = stored.publicUrl;
    } catch {}
  }
  let outputUrls: string[] = [];
  try {
    const { model: _m, isPublic: _p, ...rest } = body || {};
    const input: any = { image: body.image, ...rest };
    // Sanitize inputs
    if (modelBase === 'philz1337x/clarity-upscaler') {
      if (input.dynamic != null) input.dynamic = clamp(input.dynamic, 1, 50);
      if (input.sharpen != null) input.sharpen = clamp(input.sharpen, 0, 10);
      if (input.scale_factor != null) input.scale_factor = clamp(input.scale_factor, 1, 4);
      if (input.creativity != null) input.creativity = clamp(input.creativity, 0, 1);
      if (input.resemblance != null) input.resemblance = clamp(input.resemblance, 0, 3);
      if (input.num_inference_steps != null) input.num_inference_steps = Math.max(1, Math.min(100, Number(input.num_inference_steps)));
    }
    if (modelBase === 'fermatresearch/magic-image-refiner') {
      if (input.hdr != null) input.hdr = clamp(input.hdr, 0, 1);
      if (input.creativity != null) input.creativity = clamp(input.creativity, 0, 1);
      if (input.resemblance != null) input.resemblance = clamp(input.resemblance, 0, 1);
      if (input.guidance_scale != null) input.guidance_scale = clamp(input.guidance_scale, 0.1, 30);
      if (input.steps != null) input.steps = Math.max(1, Math.min(100, Number(input.steps)));
      if (!input.resolution) input.resolution = '1024';
    }
    if (modelBase === 'nightmareai/real-esrgan') {
      // real-esrgan supports scale 0-10 (default 4) and face_enhance boolean
      if (input.scale != null) input.scale = Math.max(0, Math.min(10, Number(input.scale)));
      if (input.face_enhance != null) input.face_enhance = Boolean(input.face_enhance);
    }
    if (modelBase === 'mv-lab/swin2sr') {
      // Swin2SR expects `task` enum and image. If provided, allow pass-through of task
      if (input.task) {
        const allowed = new Set(['classical_sr','real_sr','compressed_sr']);
        if (!allowed.has(String(input.task))) input.task = 'real_sr';
      }
    }
    const modelSpec = composeModelSpec(modelBase, body.version);
    // eslint-disable-next-line no-console
    console.log('[replicateService.upscale] run', { modelSpec, inputKeys: Object.keys(input) });
    const output: any = await replicate.run(modelSpec as any, { input });
    // eslint-disable-next-line no-console
    console.log('[replicateService.upscale] output', typeof output, Array.isArray(output) ? output.length : 'n/a');
    if (Array.isArray(output)) {
      outputUrls = output.filter((x: any) => typeof x === 'string');
    } else {
      const one = extractFirstUrl(output);
      if (one) outputUrls = [one];
    }
    if (!outputUrls.length) throw new Error('No output URL returned by Replicate');
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.upscale] error', e?.message || e);
    try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'failed', error: e?.message || 'Replicate failed' }); } catch {}
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate failed' } as any);
    throw new ApiError('Replicate generation failed', 502, e);
  }

  // Upload possibly multiple output URLs
  const uploadedImages: Array<{ id: string; url: string; storagePath?: string; originalUrl: string }> = [];
  try {
    const username = creator?.username || uid;
    let idx = 1;
    for (const out of outputUrls) {
      try {
        const uploaded = await uploadFromUrlToZata({ sourceUrl: out, keyPrefix: `users/${username}/image/${historyId}`, fileName: `image-${idx}` });
        uploadedImages.push({ id: `replicate-${Date.now()}-${idx}`, url: uploaded.publicUrl, storagePath: uploaded.key, originalUrl: out });
      } catch {
        uploadedImages.push({ id: `replicate-${Date.now()}-${idx}`, url: out, originalUrl: out });
      }
      idx++;
    }
  } catch {
    // Fallback: store raw urls
    uploadedImages.push(...outputUrls.map((out, i) => ({ id: `replicate-${Date.now()}-${i+1}`, url: out, originalUrl: out })));
  }

  await generationHistoryRepository.update(uid, historyId, { status: 'completed', images: uploadedImages as any } as any);
  try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'completed', images: uploadedImages }); } catch {}
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh) await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, { uid, username: creator?.username, displayName: (creator as any)?.displayName, photoURL: creator?.photoURL });
  } catch {}
  return { images: uploadedImages, historyId, model: modelBase, status: 'completed' } as any;
}

export async function generateImage(uid: string, body: any) {
  const key = ((env as any).replicateApiKey as string) || (process.env.REPLICATE_API_TOKEN as string);
  if (!key) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.generateImage] Missing REPLICATE_API_TOKEN');
    throw new ApiError('Replicate API key not configured', 500);
  }
  if (!body?.prompt) throw new ApiError('prompt is required', 400);

  const replicate = new Replicate({ auth: key });
  const modelBase = (body.model && body.model.length > 0 ? String(body.model) : 'bytedance/seedream-4').trim();
  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: 'text-to-image',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid },
  } as any);
  const legacyId = await replicateRepository.createGenerationRecord({ prompt: body.prompt, model: modelBase, isPublic: body.isPublic === true }, creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid });

  if (body.image && typeof body.image === 'string' && body.image.startsWith('data:')) {
    try {
      const username = creator?.username || uid;
      const stored = await uploadDataUriToZata({ dataUri: body.image, keyPrefix: `users/${username}/input/${historyId}`, fileName: 'source' });
      body.image = stored.publicUrl;
    } catch {}
  }
  let outputUrls: string[] = [];
  try {
    const { model: _m, isPublic: _p, ...rest } = body || {};
    const input: any = { prompt: body.prompt };
    // Seedream schema mapping
    if (modelBase === 'bytedance/seedream-4') {
      // size handling
      const size = rest.size || '2K';
      if (['1K','2K','4K','custom'].includes(String(size))) input.size = size;
      if (input.size === 'custom') {
        if (rest.width) input.width = clamp(rest.width, 1024, 4096);
        if (rest.height) input.height = clamp(rest.height, 1024, 4096);
      }
      // aspect ratio (ignored if size=custom)
      if (rest.aspect_ratio) input.aspect_ratio = String(rest.aspect_ratio);
      // sequential image generation
      if (rest.sequential_image_generation) input.sequential_image_generation = String(rest.sequential_image_generation);
      // max_images
      if (rest.max_images != null) input.max_images = Math.max(1, Math.min(15, Number(rest.max_images)));
      // multi-image input: ensure URLs; upload data URIs to Zata
      let images: string[] = Array.isArray(rest.image_input) ? rest.image_input.slice(0, 10) : [];
      if (Array.isArray(images) && images.length > 0) {
        const normalized: string[] = [];
        for (let i = 0; i < images.length; i++) {
          const itm = images[i];
          if (typeof itm === 'string' && itm.startsWith('data:')) {
            try {
              const username = creator?.username || uid;
              const up = await uploadDataUriToZata({ dataUri: itm, keyPrefix: `users/${username}/input/${historyId}`, fileName: `ref-${i+1}` });
              normalized.push(up.publicUrl);
            } catch { /* skip */ }
          } else if (typeof itm === 'string') {
            normalized.push(itm);
          }
        }
        input.image_input = normalized;
      }
      // also support legacy single image
      if (!input.image_input && rest.image) input.image_input = [rest.image];
    }
    if (modelBase === 'fermatresearch/magic-image-refiner') {
      if (input.hdr != null) input.hdr = clamp(input.hdr, 0, 1);
      if (input.creativity != null) input.creativity = clamp(input.creativity, 0, 1);
      if (input.resemblance != null) input.resemblance = clamp(input.resemblance, 0, 1);
      if (input.guidance_scale != null) input.guidance_scale = clamp(input.guidance_scale, 0.1, 30);
      if (input.steps != null) input.steps = Math.max(1, Math.min(100, Number(input.steps)));
      if (!input.resolution) input.resolution = '1024';
    }
    const modelSpec = composeModelSpec(modelBase, body.version);
    // eslint-disable-next-line no-console
    console.log('[replicateService.generateImage] run', { modelSpec, hasImage: !!rest.image, inputKeys: Object.keys(input) });
    if (modelBase === 'bytedance/seedream-4') {
      try {
        // Deep print for Seedream I2I debugging
        const dump = {
          prompt: input.prompt,
          size: input.size,
          aspect_ratio: input.aspect_ratio,
          sequential_image_generation: input.sequential_image_generation,
          max_images: input.max_images,
          image_input_count: Array.isArray(input.image_input) ? input.image_input.length : 0,
          image_input_sample: Array.isArray(input.image_input) ? input.image_input.slice(0, 2) : [],
        };
        // eslint-disable-next-line no-console
        console.debug('[seedream] input dump', JSON.stringify(dump, null, 2));
      } catch {}
    }
    const output: any = await replicate.run(modelSpec as any, { input });
    // eslint-disable-next-line no-console
    console.log('[replicateService.generateImage] output', typeof output, Array.isArray(output) ? output.length : 'n/a');
    console.log('[replicateService.generateImage] output', output);
    if (modelBase === 'bytedance/seedream-4') {
      try {
        if (Array.isArray(output)) {
          const first = output[0];
          const firstInfo = first ? (typeof first === 'string' ? first : (typeof first?.url === 'function' ? '[function url()]' : Object.keys(first||{}))) : null;
          // eslint-disable-next-line no-console
          console.debug('[seedream] output array[0] info', firstInfo);
        } else if (output && typeof output === 'object') {
          // eslint-disable-next-line no-console
          console.debug('[seedream] output object keys', Object.keys(output));
        }
      } catch {}
    }
    // Seedream returns an array of urls per schema; handle multiple
    outputUrls = await resolveOutputUrls(output);
    if (!outputUrls.length) {
      try {
        // eslint-disable-next-line no-console
        console.error('[replicateService.generateImage] no urls – raw output dump (truncated)', JSON.stringify(output, null, 2).slice(0, 2000));
      } catch {}
      throw new Error('No output URL returned by Replicate');
    }
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.generateImage] error', e?.message || e);
    try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'failed', error: e?.message || 'Replicate failed' }); } catch {}
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate failed' } as any);
    throw new ApiError('Replicate generation failed', 502, e);
  }

  // Upload possibly multiple output URLs
  const uploadedImages: Array<{ id: string; url: string; storagePath?: string; originalUrl: string }> = [];
  try {
    const username = creator?.username || uid;
    let idx = 1;
    for (const out of outputUrls) {
      try {
        const uploaded = await uploadFromUrlToZata({ sourceUrl: out, keyPrefix: `users/${username}/image/${historyId}`, fileName: `image-${idx}` });
        uploadedImages.push({ id: `replicate-${Date.now()}-${idx}`, url: uploaded.publicUrl, storagePath: uploaded.key, originalUrl: out });
      } catch {
        uploadedImages.push({ id: `replicate-${Date.now()}-${idx}`, url: out, originalUrl: out });
      }
      idx++;
    }
  } catch {
    // Fallback: store raw urls
    uploadedImages.push(...outputUrls.map((out, i) => ({ id: `replicate-${Date.now()}-${i+1}`, url: out, originalUrl: out })));
  }

  await generationHistoryRepository.update(uid, historyId, { status: 'completed', images: uploadedImages as any } as any);
  try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'completed', images: uploadedImages }); } catch {}
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh) await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, { uid, username: creator?.username, displayName: (creator as any)?.displayName, photoURL: creator?.photoURL });
  } catch {}
  return { images: uploadedImages, historyId, model: modelBase, status: 'completed' } as any;
}

export const replicateService = { removeBackground, upscale, generateImage };
