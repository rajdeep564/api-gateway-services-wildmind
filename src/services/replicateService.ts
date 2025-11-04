// Use dynamic import signature to avoid type requirement during build-time
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Replicate = require('replicate');
import sharp from 'sharp';
import util from 'util';
import { ApiError } from '../utils/errorHandler';
import { env } from '../config/env';
import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { generationsMirrorRepository } from '../repository/generationsMirrorRepository';
import { authRepository } from '../repository/auth/authRepository';
import { uploadFromUrlToZata, uploadDataUriToZata } from '../utils/storage/zataUpload';
import { replicateRepository } from '../repository/replicateRepository';
import { creditsRepository } from '../repository/creditsRepository';
import { computeWanVideoCost } from '../utils/pricing/wanPricing';

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

async function downloadToDataUri(sourceUrl: string): Promise<{ dataUri: string; ext: string } | null> {
  try {
    const res = await fetch(sourceUrl as any);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/png';
    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : (contentType.includes('webp') ? 'webp' : 'png');
    const ab = await res.arrayBuffer();
    const b64 = Buffer.from(new Uint8Array(ab)).toString('base64');
    return { dataUri: `data:${contentType};base64,${b64}`, ext };
  } catch {
    return null;
  }
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
        // Some SDKs may return URL objects or objects with toString()
        return typeof awaited === 'string' ? awaited : String(awaited);
      }
      return typeof result === 'string' ? result : String(result);
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
  // For bria/eraser, validator allows image OR image_url; basic guard here only for legacy models
  const modelHint = String(body?.model || '').toLowerCase();
  const isEraser = modelHint.includes('bria/eraser');
  if (!isEraser && !body?.image) throw new ApiError('image is required', 400);

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
  // Prepare model-specific input mapping
  const input: Record<string, any> = {};
  if (modelBase.startsWith('bria/eraser')) {
    // bria/eraser schema: support image or image_url; optional mask/mask_url; mask_type; preserve_alpha; content_moderation; sync
    const anyBody: any = body as any;
    if (typeof anyBody.image === 'string' && anyBody.image.length > 0) input.image = anyBody.image;
    if (!input.image && typeof anyBody.image_url === 'string' && anyBody.image_url.length > 0) input.image_url = anyBody.image_url;
    if (typeof anyBody.mask === 'string' && anyBody.mask.length > 0) input.mask = anyBody.mask;
    if (typeof anyBody.mask_url === 'string' && anyBody.mask_url.length > 0) input.mask_url = anyBody.mask_url;
    if (anyBody.mask_type) input.mask_type = String(anyBody.mask_type).toLowerCase() === 'manual' ? 'manual' : (String(anyBody.mask_type).toLowerCase() === 'automatic' ? 'automatic' : undefined);
    if (typeof anyBody.preserve_alpha === 'boolean') input.preserve_alpha = anyBody.preserve_alpha; else input.preserve_alpha = true;
    if (typeof anyBody.content_moderation === 'boolean') input.content_moderation = anyBody.content_moderation;
    if (typeof anyBody.sync === 'boolean') input.sync = anyBody.sync; else input.sync = true;
  } else {
    // Legacy background removers
    // Use input image directly (URL or data URI); only upload outputs to Zata
    input.image = body.image;
    if (modelBase.startsWith('851-labs/background-remover')) {
    if (body.format) input.format = body.format;
    if (typeof body.reverse === 'boolean') input.reverse = body.reverse;
    if (typeof body.threshold === 'number') input.threshold = body.threshold;
    if (body.background_type) input.background_type = body.background_type;
    }
  }

  let outputUrl = '';
  const version = (body as any).version as string | undefined;
  const modelSpec = composeModelSpec(modelBase, version);
  try {
    // eslint-disable-next-line no-console
    console.log('[replicateService.removeBackground] run', { modelSpec, input });
    let output: any = await replicate.run(modelSpec as any, { input });
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
    if (modelBase === 'leonardoai/lucid-origin') {
      if (rest.aspect_ratio) input.aspect_ratio = String(rest.aspect_ratio);
      if (rest.style) input.style = String(rest.style);
      if (rest.contrast) input.contrast = String(rest.contrast);
      if (rest.num_images != null && Number.isInteger(rest.num_images)) input.num_images = Math.max(1, Math.min(8, Number(rest.num_images)));
      if (typeof rest.prompt_enhance === 'boolean') input.prompt_enhance = rest.prompt_enhance;
      if (rest.generation_mode) input.generation_mode = String(rest.generation_mode);
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
    // Robustly resolve Replicate SDK file outputs (which may be objects with url())
    const urlsResolved = await resolveOutputUrls(output);
    if (urlsResolved && urlsResolved.length) {
      outputUrls = urlsResolved;
    } else {
      // Fallback to best-effort single URL extraction
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
        // Prefer downloading and re-uploading to ensure we store first-party resource URLs
        const dl = await downloadToDataUri(out);
        if (dl) {
          const uploaded = await uploadDataUriToZata({ dataUri: dl.dataUri, keyPrefix: `users/${username}/image/${historyId}`, fileName: `image-${idx}.${dl.ext}` });
          uploadedImages.push({ id: `replicate-${Date.now()}-${idx}`, url: uploaded.publicUrl, storagePath: uploaded.key, originalUrl: out });
        } else {
          const uploaded = await uploadFromUrlToZata({ sourceUrl: out, keyPrefix: `users/${username}/image/${historyId}`, fileName: `image-${idx}` });
          uploadedImages.push({ id: `replicate-${Date.now()}-${idx}`, url: uploaded.publicUrl, storagePath: uploaded.key, originalUrl: out });
        }
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

  // Do not upload input data URIs to Zata; pass directly to provider
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
      // If user requests multiple images, Seedream requires sequential generation to be 'auto'
      if ((input.max_images ?? 1) > 1 && input.sequential_image_generation !== 'auto') {
        input.sequential_image_generation = 'auto';
      }
      // multi-image input: ensure HTTP(S) URLs; upload data URIs to Zata first
      const username = creator?.username || uid;
      let images: string[] = Array.isArray(rest.image_input) ? rest.image_input.slice(0, 10) : [];
      if (!images.length && typeof rest.image === 'string' && rest.image.length) images = [rest.image];
      if (images.length > 0) {
        const resolved: string[] = [];
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          try {
            if (typeof img === 'string' && img.startsWith('data:')) {
              const uploaded = await uploadDataUriToZata({ dataUri: img, keyPrefix: `users/${username}/input/${historyId}`, fileName: `seedream-ref-${i+1}` });
              resolved.push(uploaded.publicUrl);
            } else if (typeof img === 'string') {
              resolved.push(img);
            }
          } catch {
            if (typeof img === 'string') resolved.push(img);
          }
        }
        // Normalize any out-of-range aspect ratios to Seedream's allowed bounds (0.33–3.0)
        async function normalizeIfNeeded(url: string, idx: number): Promise<string> {
          try {
            let buf: Buffer | null = null;
            if (url.startsWith('data:')) {
              const comma = url.indexOf(',');
              const b64 = comma >= 0 ? url.slice(comma + 1) : '';
              buf = Buffer.from(b64, 'base64');
            } else {
              const resp = await fetch(url as any);
              if (!resp.ok) return url;
              const ab = await resp.arrayBuffer();
              buf = Buffer.from(new Uint8Array(ab));
            }
            if (!buf) return url;
            const meta = await sharp(buf).metadata();
            const w = Number(meta.width || 0);
            const h = Number(meta.height || 0);
            if (!w || !h) return url;
            const ratio = w / h;
            const minR = 0.33;
            const maxR = 3.0;
            if (ratio >= minR && ratio <= maxR) return url; // already OK
            // Pad to nearest bound to avoid cropping content
            if (ratio > maxR) {
              const targetH = Math.ceil(w / maxR);
              const pad = Math.max(0, targetH - h);
              if (pad <= 0) return url;
              const top = Math.floor(pad / 2);
              const bottom = pad - top;
              const padded = await sharp(buf).extend({ top, bottom, left: 0, right: 0, background: { r: 0, g: 0, b: 0 } }).toBuffer();
              const uploaded = await uploadDataUriToZata({ dataUri: `data:image/jpeg;base64,${padded.toString('base64')}`, keyPrefix: `users/${username}/input/${historyId}`, fileName: `seedream-ref-fixed-${idx+1}.jpg` });
              return uploaded.publicUrl;
            } else {
              // ratio < minR => too tall; pad width
              const targetW = Math.ceil(h * minR);
              const pad = Math.max(0, targetW - w);
              if (pad <= 0) return url;
              const left = Math.floor(pad / 2);
              const right = pad - left;
              const padded = await sharp(buf).extend({ top: 0, bottom: 0, left, right, background: { r: 0, g: 0, b: 0 } }).toBuffer();
              const uploaded = await uploadDataUriToZata({ dataUri: `data:image/jpeg;base64,${padded.toString('base64')}`, keyPrefix: `users/${username}/input/${historyId}`, fileName: `seedream-ref-fixed-${idx+1}.jpg` });
              return uploaded.publicUrl;
            }
          } catch {
            return url;
          }
        }
        const fixed: string[] = [];
        for (let i = 0; i < resolved.length; i++) {
          // eslint-disable-next-line no-await-in-loop
          fixed.push(await normalizeIfNeeded(resolved[i], i));
        }
        if (fixed.length > 0) input.image_input = fixed;
      }
      // Enforce total images cap when auto: input_count + max_images <= 15
      if (input.sequential_image_generation === 'auto') {
        const inputCount = Array.isArray(input.image_input) ? input.image_input.length : 0;
        const requested = typeof input.max_images === 'number' ? input.max_images : 1;
        if (inputCount + requested > 15) {
          input.max_images = Math.max(1, 15 - inputCount);
        }
      }
    }
      // Leonardo Phoenix 1.0 mapping
      if (modelBase === 'leonardoai/phoenix-1.0') {
        if (rest.aspect_ratio) input.aspect_ratio = String(rest.aspect_ratio);
        if (rest.style) input.style = String(rest.style);
        if (rest.contrast) input.contrast = String(rest.contrast);
        if (rest.num_images != null) input.num_images = Math.max(1, Math.min(8, Number(rest.num_images)));
        if (typeof rest.prompt_enhance === 'boolean') input.prompt_enhance = rest.prompt_enhance;
        if (rest.generation_mode) input.generation_mode = String(rest.generation_mode);
      }
    if (modelBase === 'fermatresearch/magic-image-refiner') {
      if (input.hdr != null) input.hdr = clamp(input.hdr, 0, 1);
      if (input.creativity != null) input.creativity = clamp(input.creativity, 0, 1);
      if (input.resemblance != null) input.resemblance = clamp(input.resemblance, 0, 1);
      if (input.guidance_scale != null) input.guidance_scale = clamp(input.guidance_scale, 0.1, 30);
      if (input.steps != null) input.steps = Math.max(1, Math.min(100, Number(input.steps)));
      if (!input.resolution) input.resolution = '1024';
    }
    // Ideogram v3 (Turbo/Quality) mapping
    if (modelBase === 'ideogram-ai/ideogram-v3-quality' || modelBase === 'ideogram-ai/ideogram-v3-turbo') {
      // Map supported fields from provided schema
      if (rest.aspect_ratio) input.aspect_ratio = String(rest.aspect_ratio);
      if (rest.resolution) input.resolution = String(rest.resolution);
      if (rest.magic_prompt_option) input.magic_prompt_option = String(rest.magic_prompt_option);
      if (rest.style_type) input.style_type = String(rest.style_type);
      if (rest.style_preset) input.style_preset = String(rest.style_preset);
      if (rest.image) input.image = String(rest.image);
      if (rest.mask) input.mask = String(rest.mask);
      if (rest.seed != null && Number.isInteger(rest.seed)) input.seed = rest.seed;
      if (Array.isArray(rest.style_reference_images) && rest.style_reference_images.length) input.style_reference_images = rest.style_reference_images.slice(0, 10).map(String);
      // No additional clamping required; validator enforces enumerations and limits
    }
  const modelSpec = composeModelSpec(modelBase, body.version);
    // eslint-disable-next-line no-console
    console.log('[replicateService.generateImage] run', { modelSpec, hasImage: !!rest.image, inputKeys: Object.keys(input) });
    if (modelBase === 'bytedance/seedream-4') {
      try {
        const preDump = {
          incoming_image_input_count: Array.isArray(rest.image_input) ? rest.image_input.length : 0,
          incoming_first_is_data_uri: Array.isArray(rest.image_input) ? (typeof rest.image_input[0] === 'string' && rest.image_input[0]?.startsWith('data:')) : false,
        };
        console.debug('[seedream] incoming image_input summary', JSON.stringify(preDump));
      } catch {}
    }
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
          model: modelBase,
          isPublic: body.isPublic === true,
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
          // Deep inspect entire array with safe depth
          console.debug('[seedream] output full inspect', util.inspect(output, { depth: 4, maxArrayLength: 50 }));
          // Attempt to resolve urls for each item with logging
          for (let i = 0; i < output.length; i++) {
            try {
              const val = output[i];
              const url = await resolveItemUrl(val);
              console.debug(`[seedream] output[${i}] typeof=${typeof val} hasUrlFn=${typeof (val?.url) === 'function'} resolvedUrl=${url || '<none>'}`);
            } catch (e) {
              console.debug(`[seedream] output[${i}] resolve error`, (e as any)?.message || e);
            }
          }
        } else if (output && typeof output === 'object') {
          // eslint-disable-next-line no-console
          console.debug('[seedream] output object keys', Object.keys(output));
          console.debug('[seedream] output full inspect', util.inspect(output, { depth: 4 }));
        }
      } catch {}
    }
    // Seedream returns an array of urls per schema; handle multiple
    outputUrls = await resolveOutputUrls(output);
    // If fewer images returned than requested, fall back to sequential reruns
    if (modelBase === 'bytedance/seedream-4') {
      const requested = typeof input.max_images === 'number' ? input.max_images : 1;
      if (requested > 1 && outputUrls.length < requested) {
        // eslint-disable-next-line no-console
        console.warn(`[seedream] provider returned ${outputUrls.length}/${requested}; running additional ${requested - outputUrls.length} times sequentially`);
        const runsNeeded = Math.max(0, Math.min(15, requested - outputUrls.length));
        for (let i = 0; i < runsNeeded; i++) {
          try {
            const rerunInput = { ...input, max_images: 1, sequential_image_generation: 'disabled' };
            const more: any = await replicate.run(modelSpec as any, { input: rerunInput });
            const moreUrls = await resolveOutputUrls(more);
            if (moreUrls && moreUrls.length) outputUrls.push(...moreUrls.slice(0, 1));
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[seedream] sequential fallback run failed', (e as any)?.message || e);
          }
          if (outputUrls.length >= requested) break;
        }
      }
    }
    if (!outputUrls.length && Array.isArray(output)) {
      // Fallback: Replicate returned file-like streams; read and upload to Zata directly
      // eslint-disable-next-line no-console
      console.warn('[replicateService.generateImage] no URL strings; attempting stream->buffer->Zata fallback');
      const username = creator?.username || uid;
      const uploadedUrls: string[] = [];
      for (let i = 0; i < output.length; i++) {
        const item = output[i];
        try {
          let arrayBuffer: ArrayBuffer | null = null;
          if (item && typeof item.arrayBuffer === 'function') {
            arrayBuffer = await item.arrayBuffer();
          } else if (typeof Response !== 'undefined') {
            // Wrap in Response to consume web ReadableStream
            const resp = new Response(item as any);
            arrayBuffer = await resp.arrayBuffer();
          }
          if (arrayBuffer) {
            const buffer = Buffer.from(new Uint8Array(arrayBuffer));
            const b64 = buffer.toString('base64');
            const dataUri = `data:image/png;base64,${b64}`; // best-effort default; Replicate images are typically PNG/JPG
            const uploaded = await uploadDataUriToZata({ dataUri, keyPrefix: `users/${username}/image/${historyId}`, fileName: `image-${i+1}.png` });
            uploadedUrls.push(uploaded.publicUrl);
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[replicateService.generateImage] stream fallback upload failed', (e as any)?.message || e);
        }
      }
      if (uploadedUrls.length) outputUrls = uploadedUrls;
    }
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

export const replicateService = { removeBackground, upscale, generateImage, wanI2V, wanT2V };
// Wan 2.5 Image-to-Video via Replicate
export async function wanI2V(uid: string, body: any) {
  const key = ((env as any).replicateApiKey as string) || (process.env.REPLICATE_API_TOKEN as string);
  if (!key) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.wanI2V] Missing REPLICATE_API_TOKEN');
    throw new ApiError('Replicate API key not configured', 500);
  }
  if (!body?.image) throw new ApiError('image is required', 400);
  if (!body?.prompt) throw new ApiError('prompt is required', 400);

  const replicate = new Replicate({ auth: key });
  const isFast = ((): boolean => {
    const s = (body?.speed ?? '').toString().toLowerCase();
    const m = (body?.model ?? '').toString().toLowerCase();
    const speedFast = s === 'fast' || s === 'true' || s.includes('fast') || body?.speed === true;
    const modelFast = m.includes('fast');
    return speedFast || modelFast;
  })();
  const modelBase = isFast ? 'wan-video/wan-2.5-i2v-fast' : 'wan-video/wan-2.5-i2v';
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid } as any;
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: 'text-to-video',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy,
    // Save params for potential delayed debit
    duration: ((): any => {
      const s = String(body?.duration ?? '5').toLowerCase();
      const m = s.match(/(5|10)/);
      return m ? Number(m[1]) : 5;
    })(),
    resolution: ((): any => {
      const s = String(body?.resolution ?? '720p').toLowerCase();
      const m = s.match(/(480|720|1080)/);
      return m ? `${m[1]}p` : '720p';
    })(),
  } as any);
  const legacyId = await replicateRepository.createGenerationRecord({ prompt: body.prompt, model: modelBase, isPublic: body.isPublic === true }, createdBy);

  // Prepare input mapping
  const parseDurationSec = (d: any): number => {
    const s = String(d ?? '5').toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  };
  const normalizeRes = (r: any): string => {
    const s = String(r ?? '720p').toLowerCase();
    const m = s.match(/(480|720|1080)/);
    return m ? `${m[1]}p` : '720p';
  };

  const input: any = {
    image: body.image,
    prompt: body.prompt,
    duration: parseDurationSec(body.duration),
    resolution: normalizeRes(body.resolution),
  };
  if (body.seed != null && Number.isInteger(Number(body.seed))) input.seed = Number(body.seed);
  if (body.audio != null && typeof body.audio === 'string') input.audio = body.audio;
  if (body.negative_prompt != null && typeof body.negative_prompt === 'string') input.negative_prompt = body.negative_prompt;
  if (body.enable_prompt_expansion != null) input.enable_prompt_expansion = Boolean(body.enable_prompt_expansion);

  let outputUrl = '';
  try {
    const version = (body as any).version as string | undefined;
    const modelSpec = composeModelSpec(modelBase, version);
    // eslint-disable-next-line no-console
    console.log('[replicateService.wanI2V] run', { modelSpec, inputKeys: Object.keys(input) });
    const output: any = await replicate.run(modelSpec as any, { input });
    // eslint-disable-next-line no-console
    console.log('[replicateService.wanI2V] output', typeof output, Array.isArray(output) ? output.length : 'n/a');
    const urls = await resolveOutputUrls(output);
    outputUrl = urls[0] || '';
    if (!outputUrl) throw new Error('No output URL returned by Replicate');
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.wanI2V] error', e?.message || e);
    try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'failed', error: e?.message || 'Replicate failed' }); } catch {}
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate failed' } as any);
    throw new ApiError('Replicate generation failed', 502, e);
  }

  // Upload video to Zata
  let storedUrl = outputUrl;
  let storagePath = '';
  try {
    const username = creator?.username || uid;
    const uploaded = await uploadFromUrlToZata({ sourceUrl: outputUrl, keyPrefix: `users/${username}/video/${historyId}`, fileName: 'video-1' });
    storedUrl = uploaded.publicUrl;
    storagePath = uploaded.key;
  } catch {
    // fallback keep provider URL
  }

  const videoItem: any = { id: `replicate-${Date.now()}`, url: storedUrl, storagePath, originalUrl: outputUrl };
  await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos: [videoItem] } as any);
  try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'completed', videos: [videoItem] }); } catch {}
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh) await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, { uid, username: creator?.username, displayName: (creator as any)?.displayName, photoURL: creator?.photoURL });
  } catch {}
  return { videos: [videoItem], historyId, model: modelBase, status: 'completed' } as any;
}

export const _wan = { wanI2V };
Object.assign(replicateService, { wanI2V });

// Wan 2.5 Text-to-Video via Replicate
export async function wanT2V(uid: string, body: any) {
  const key = ((env as any).replicateApiKey as string) || (process.env.REPLICATE_API_TOKEN as string);
  if (!key) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.wanT2V] Missing REPLICATE_API_TOKEN');
    throw new ApiError('Replicate API key not configured', 500);
  }
  if (!body?.prompt) throw new ApiError('prompt is required', 400);

  const replicate = new Replicate({ auth: key });
  const isFast = ((): boolean => {
    const s = (body?.speed ?? '').toString().toLowerCase();
    const m = (body?.model ?? '').toString().toLowerCase();
    const speedFast = s === 'fast' || s === 'true' || s.includes('fast') || body?.speed === true;
    const modelFast = m.includes('fast');
    return speedFast || modelFast;
  })();
  const modelBase = isFast ? 'wan-video/wan-2.5-t2v-fast' : 'wan-video/wan-2.5-t2v';
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid } as any;
  const durationSec = ((): number => {
    const s = String(body?.duration ?? '5').toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  })();
  // Derive resolution from size if provided
  const size = String(body?.size ?? '1280*720');
  const res = size.includes('*480') || size.startsWith('480*') ? '480p' : (size.includes('*1080') || size.startsWith('1080*') ? '1080p' : '720p');

  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: 'text-to-video',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec,
    resolution: res,
  } as any);
  const legacyId = await replicateRepository.createGenerationRecord({ prompt: body.prompt, model: modelBase, isPublic: body.isPublic === true }, createdBy);

  const input: any = {
    prompt: body.prompt,
    duration: durationSec,
    size,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed))) input.seed = Number(body.seed);
  if (body.audio != null && typeof body.audio === 'string') input.audio = body.audio;
  if (body.negative_prompt != null && typeof body.negative_prompt === 'string') input.negative_prompt = body.negative_prompt;
  if (body.enable_prompt_expansion != null) input.enable_prompt_expansion = Boolean(body.enable_prompt_expansion);

  let outputUrl = '';
  try {
    const version = (body as any).version as string | undefined;
    const modelSpec = composeModelSpec(modelBase, version);
    // eslint-disable-next-line no-console
    console.log('[replicateService.wanT2V] run', { modelSpec, inputKeys: Object.keys(input) });
    const output: any = await replicate.run(modelSpec as any, { input });
    // eslint-disable-next-line no-console
    console.log('[replicateService.wanT2V] output', typeof output, Array.isArray(output) ? output.length : 'n/a');
    const urls = await resolveOutputUrls(output);
    outputUrl = urls[0] || '';
    if (!outputUrl) throw new Error('No output URL returned by Replicate');
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.wanT2V] error', e?.message || e);
    try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'failed', error: e?.message || 'Replicate failed' }); } catch {}
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate failed' } as any);
    throw new ApiError('Replicate generation failed', 502, e);
  }

  // Upload video to Zata
  let storedUrl = outputUrl;
  let storagePath = '';
  try {
    const username = creator?.username || uid;
    const uploaded = await uploadFromUrlToZata({ sourceUrl: outputUrl, keyPrefix: `users/${username}/video/${historyId}`, fileName: 'video-1' });
    storedUrl = uploaded.publicUrl;
    storagePath = uploaded.key;
  } catch {
    // fallback keep provider URL
  }
  const videoItem: any = { id: `replicate-${Date.now()}`, url: storedUrl, storagePath, originalUrl: outputUrl };
  await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos: [videoItem] } as any);
  try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'completed', videos: [videoItem] }); } catch {}
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh) await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, { uid, username: creator?.username, displayName: (creator as any)?.displayName, photoURL: creator?.photoURL });
  } catch {}
  return { videos: [videoItem], historyId, model: modelBase, status: 'completed' } as any;
}
Object.assign(replicateService, { wanT2V });

// ============ Queue-style API for Replicate WAN 2.5 ============

type SubmitReturn = { requestId: string; historyId: string; model: string; status: 'submitted' };

async function resolveWanModelFast(body: any): Promise<boolean> {
  const s = (body?.speed ?? '').toString().toLowerCase();
  const m = (body?.model ?? '').toString().toLowerCase();
  const speedFast = s === 'fast' || s === 'true' || s.includes('fast') || body?.speed === true;
  const modelFast = m.includes('fast');
  return speedFast || modelFast;
}

function ensureReplicate(): any {
  const key = ((env as any).replicateApiKey as string) || (process.env.REPLICATE_API_TOKEN as string);
  if (!key) {
    // eslint-disable-next-line no-console
    console.error('[replicateQueue] Missing REPLICATE_API_TOKEN');
    throw new ApiError('Replicate API key not configured', 500);
  }
  return new Replicate({ auth: key });
}

async function getLatestModelVersion(replicate: any, modelBase: string): Promise<string | null> {
  try {
    // Prefer model slug with latest version lookup; fallback to using model slug directly in predictions.create
    const [owner, name] = modelBase.split('/');
    if (!owner || !name) return null;
    const model = await replicate.models.get(`${owner}/${name}`);
    const latestVersion = (model as any)?.latest_version?.id || (Array.isArray((model as any)?.versions) ? (model as any).versions[0]?.id : null);
    return latestVersion || null;
  } catch {
    return null;
  }
}

export async function wanT2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError('prompt is required', 400);
  const replicate = ensureReplicate();
  const isFast = await resolveWanModelFast(body);
  const modelBase = isFast ? 'wan-video/wan-2.5-t2v-fast' : 'wan-video/wan-2.5-t2v';
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid } as any;
  const durationSec = ((): number => {
    const s = String(body?.duration ?? '5').toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  })();
  const size = String(body?.size ?? '1280*720');
  const res = size.includes('*480') || size.startsWith('480*') ? '480p' : (size.includes('*1080') || size.startsWith('1080*') ? '1080p' : '720p');

  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: 'text-to-video',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: res as any,
  } as any);

  // Build input
  const input: any = {
    prompt: body.prompt,
    duration: durationSec,
    size,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed))) input.seed = Number(body.seed);
  if (body.audio != null && typeof body.audio === 'string') input.audio = body.audio;
  if (body.negative_prompt != null && typeof body.negative_prompt === 'string') input.negative_prompt = body.negative_prompt;
  if (body.enable_prompt_expansion != null) input.enable_prompt_expansion = Boolean(body.enable_prompt_expansion);

  // Create prediction (non-blocking)
  let predictionId = '';
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    // eslint-disable-next-line no-console
    console.log('[replicateQueue.wanT2vSubmit] create', { modelBase, hasVersion: !!version });
    const pred = await replicate.predictions.create(version ? { version, input } : { model: modelBase, input });
    predictionId = (pred as any)?.id || '';
    if (!predictionId) throw new Error('Missing prediction id');
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[replicateQueue.wanT2vSubmit] error', e?.message || e);
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate submit failed' } as any);
    throw new ApiError('Failed to submit WAN T2V job', 502, e);
  }

  await generationHistoryRepository.update(uid, historyId, { provider: 'replicate', providerTaskId: predictionId } as any);
  return { requestId: predictionId, historyId, model: modelBase, status: 'submitted' };
}

export async function wanI2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
  if (!body?.image) throw new ApiError('image is required', 400);
  if (!body?.prompt) throw new ApiError('prompt is required', 400);
  const replicate = ensureReplicate();
  const isFast = await resolveWanModelFast(body);
  const modelBase = isFast ? 'wan-video/wan-2.5-i2v-fast' : 'wan-video/wan-2.5-i2v';
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid } as any;
  const durationSec = ((): number => {
    const s = String(body?.duration ?? '5').toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  })();
  const res = ((): string => {
    const s = String(body?.resolution ?? '720p').toLowerCase();
    const m = s.match(/(480|720|1080)/);
    return m ? `${m[1]}p` : '720p';
  })();

  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: 'text-to-video',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: res as any,
  } as any);

  const input: any = {
    image: body.image,
    prompt: body.prompt,
    duration: durationSec,
    resolution: res,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed))) input.seed = Number(body.seed);
  if (body.audio != null && typeof body.audio === 'string') input.audio = body.audio;
  if (body.negative_prompt != null && typeof body.negative_prompt === 'string') input.negative_prompt = body.negative_prompt;
  if (body.enable_prompt_expansion != null) input.enable_prompt_expansion = Boolean(body.enable_prompt_expansion);

  let predictionId = '';
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    // eslint-disable-next-line no-console
    console.log('[replicateQueue.wanI2vSubmit] create', { modelBase, hasVersion: !!version });
    const pred = await replicate.predictions.create(version ? { version, input } : { model: modelBase, input });
    predictionId = (pred as any)?.id || '';
    if (!predictionId) throw new Error('Missing prediction id');
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[replicateQueue.wanI2vSubmit] error', e?.message || e);
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate submit failed' } as any);
    throw new ApiError('Failed to submit WAN I2V job', 502, e);
  }

  await generationHistoryRepository.update(uid, historyId, { provider: 'replicate', providerTaskId: predictionId } as any);
  return { requestId: predictionId, historyId, model: modelBase, status: 'submitted' };
}

export async function replicateQueueStatus(_uid: string, requestId: string): Promise<any> {
  const replicate = ensureReplicate();
  try {
    const status = await replicate.predictions.get(requestId);
    return status;
  } catch (e: any) {
    throw new ApiError(e?.message || 'Failed to fetch Replicate status', 502);
  }
}

export async function replicateQueueResult(uid: string, requestId: string): Promise<any> {
  const replicate = ensureReplicate();
  try {
    const result = await replicate.predictions.get(requestId);
    const located = await generationHistoryRepository.findByProviderTaskId(uid, 'replicate', requestId);
    if (!located) return result;
    const historyId = located.id;
    // If completed and output present, persist video and finalize history
    const out = (result as any)?.output;
    const urls = await resolveOutputUrls(out);
    const outputUrl = urls[0] || '';
    if (!outputUrl) return result;
    let storedUrl = outputUrl;
    let storagePath = '';
    try {
      const creator = await authRepository.getUserById(uid);
      const username = creator?.username || uid;
      const uploaded = await uploadFromUrlToZata({ sourceUrl: outputUrl, keyPrefix: `users/${username}/video/${historyId}`, fileName: 'video-1' });
      storedUrl = uploaded.publicUrl;
      storagePath = uploaded.key;
    } catch {}
    const videoItem: any = { id: requestId, url: storedUrl, storagePath, originalUrl: outputUrl };
    await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos: [videoItem] } as any);
    try {
      const fresh = await generationHistoryRepository.get(uid, historyId);
      if (fresh) await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, { uid, username: (await authRepository.getUserById(uid))?.username });
    } catch {}
    // Compute and write debit (use stored history fields)
    try {
      const fresh = await generationHistoryRepository.get(uid, historyId);
      const model = (fresh as any)?.model?.toString().toLowerCase() || '';
      const modeGuess = (fresh as any)?.prompt && model.includes('i2v') ? 'i2v' : 't2v';
      if (model.includes('wan-2.5')) {
        const fakeReq = { body: { mode: modeGuess, duration: (fresh as any)?.duration, resolution: (fresh as any)?.resolution, model: (fresh as any)?.model } } as any;
        const { cost, pricingVersion, meta } = await computeWanVideoCost(fakeReq);
        await creditsRepository.writeDebitIfAbsent(uid, historyId, cost, `replicate.queue.wan-${modeGuess}`, { ...meta, historyId, provider: 'replicate', pricingVersion });
      } else if (model.includes('kling-v2.')) {
        const { computeKlingVideoCost } = await import('../utils/pricing/klingPricing');
        const fakeReq = { body: { kind: modeGuess, duration: (fresh as any)?.duration, resolution: (fresh as any)?.resolution, model: (fresh as any)?.model, kling_mode: (fresh as any)?.kling_mode } } as any;
        const { cost, pricingVersion, meta } = await computeKlingVideoCost(fakeReq as any);
        await creditsRepository.writeDebitIfAbsent(uid, historyId, cost, `replicate.queue.kling-${modeGuess}`, { ...meta, historyId, provider: 'replicate', pricingVersion });
      } else if (model.includes('seedance')) {
        const { computeSeedanceVideoCost } = await import('../utils/pricing/seedancePricing');
        const fakeReq = { body: { kind: modeGuess, duration: (fresh as any)?.duration, resolution: (fresh as any)?.resolution, model: (fresh as any)?.model } } as any;
        const { cost, pricingVersion, meta } = await computeSeedanceVideoCost(fakeReq as any);
        await creditsRepository.writeDebitIfAbsent(uid, historyId, cost, `replicate.queue.seedance-${modeGuess}`, { ...meta, historyId, provider: 'replicate', pricingVersion });
      } else if (model.includes('pixverse')) {
        const { computePixverseVideoCost } = await import('../utils/pricing/pixversePricing');
        const fakeReq = { body: { kind: modeGuess, duration: (fresh as any)?.duration, quality: (fresh as any)?.quality || (fresh as any)?.resolution, model: (fresh as any)?.model } } as any;
        const { cost, pricingVersion, meta } = await computePixverseVideoCost(fakeReq as any);
        await creditsRepository.writeDebitIfAbsent(uid, historyId, cost, `replicate.queue.pixverse-${modeGuess}`, { ...meta, historyId, provider: 'replicate', pricingVersion });
      }
    } catch {}
    return { videos: [videoItem], historyId, model: (located.item as any)?.model, requestId, status: 'completed' } as any;
  } catch (e: any) {
    throw new ApiError(e?.message || 'Failed to fetch Replicate result', 502);
  }
}

Object.assign(replicateService, { wanT2vSubmit, wanI2vSubmit, replicateQueueStatus, replicateQueueResult });

// ============ Queue-style API for Replicate Kling ============

export async function klingT2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError('prompt is required', 400);
  const replicate = ensureReplicate();
  const modelBase = (body.model && String(body.model).length > 0 ? String(body.model) : 'kwaivgi/kling-v2.5-turbo-pro');
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid } as any;
  const durationSec = ((): number => {
    const s = String(body?.duration ?? '5').toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  })();
  const aspect = ((): string => {
    const a = String(body?.aspect_ratio ?? '16:9');
    return ['16:9','9:16','1:1'].includes(a) ? a : '16:9';
  })();
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: 'text-to-video',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    // Kling v2.1 supports standard(720p) and pro(1080p). Default others to 720p for pricing/meta.
    resolution: ((): any => {
      const isV21 = modelBase.includes('kling-v2.1');
      const m = String(body?.mode || '').toLowerCase();
      if (isV21 && m === 'pro') return '1080p';
      return '720p';
    })(),
  } as any);

  const input: any = { prompt: body.prompt, duration: durationSec, aspect_ratio: aspect };
  if (body.guidance_scale != null) input.guidance_scale = Math.max(0, Math.min(1, Number(body.guidance_scale)));
  if (body.negative_prompt != null) input.negative_prompt = String(body.negative_prompt);
  if (modelBase.includes('kling-v2.1') && body.mode) input.mode = String(body.mode).toLowerCase();

  let predictionId = '';
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    const pred = await replicate.predictions.create(version ? { version, input } : { model: modelBase, input });
    predictionId = (pred as any)?.id || '';
    if (!predictionId) throw new Error('Missing prediction id');
  } catch (e: any) {
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate submit failed' } as any);
    throw new ApiError('Failed to submit Kling T2V job', 502, e);
  }
  await generationHistoryRepository.update(uid, historyId, { provider: 'replicate', providerTaskId: predictionId } as any);
  return { requestId: predictionId, historyId, model: modelBase, status: 'submitted' };
}

export async function klingI2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError('prompt is required', 400);
  const hasImg = !!(body?.image || body?.start_image);
  if (!hasImg) throw new ApiError('image or start_image is required', 400);
  const replicate = ensureReplicate();
  const modelBase = (body.model && String(body.model).length > 0 ? String(body.model) : (body.start_image ? 'kwaivgi/kling-v2.1' : 'kwaivgi/kling-v2.5-turbo-pro'));
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid } as any;
  const durationSec = ((): number => {
    const s = String(body?.duration ?? '5').toLowerCase();
    const m = s.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  })();
  const aspect = ((): string => {
    const a = String(body?.aspect_ratio ?? '16:9');
    return ['16:9','9:16','1:1'].includes(a) ? a : '16:9';
  })();
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: 'text-to-video',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: ((): any => {
      const isV21 = modelBase.includes('kling-v2.1');
      const m = String(body?.mode || '').toLowerCase();
      if (isV21 && m === 'pro') return '1080p';
      return '720p';
    })(),
  } as any);

  const input: any = { prompt: body.prompt, duration: durationSec };
  if (body.image) input.image = String(body.image);
  if (body.start_image) input.start_image = String(body.start_image);
  if (body.end_image) input.end_image = String(body.end_image);
  if (body.aspect_ratio) input.aspect_ratio = aspect;
  if (body.guidance_scale != null) input.guidance_scale = Math.max(0, Math.min(1, Number(body.guidance_scale)));
  if (body.negative_prompt != null) input.negative_prompt = String(body.negative_prompt);
  if (modelBase.includes('kling-v2.1') && body.mode) input.mode = String(body.mode).toLowerCase();

  let predictionId = '';
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    const pred = await replicate.predictions.create(version ? { version, input } : { model: modelBase, input });
    predictionId = (pred as any)?.id || '';
    if (!predictionId) throw new Error('Missing prediction id');
  } catch (e: any) {
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate submit failed' } as any);
    throw new ApiError('Failed to submit Kling I2V job', 502, e);
  }
  await generationHistoryRepository.update(uid, historyId, { provider: 'replicate', providerTaskId: predictionId } as any);
  return { requestId: predictionId, historyId, model: modelBase, status: 'submitted' };
}

Object.assign(replicateService, { klingT2vSubmit, klingI2vSubmit });

// ============ Queue-style API for Replicate Seedance ============

export async function seedanceT2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError('prompt is required', 400);
  const replicate = ensureReplicate();
  const modelStr = String(body.model || '').toLowerCase();
  const speed = String(body.speed || '').toLowerCase();
  const isLite = modelStr.includes('lite') || speed === 'lite' || speed.includes('lite');
  // Correct model names on Replicate: bytedance/seedance-1-pro and bytedance/seedance-1-lite (not 1.0)
  const modelBase = isLite ? 'bytedance/seedance-1-lite' : 'bytedance/seedance-1-pro';
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid } as any;
  const durationSec = ((): number => {
    const d = Number(body?.duration ?? 5);
    return Math.max(2, Math.min(12, Math.round(d)));
  })();
  const res = ((): string => {
    const r = String(body?.resolution ?? '1080p').toLowerCase();
    const m = r.match(/(480|720|1080)/);
    return m ? `${m[1]}p` : '1080p';
  })();
  const aspect = ((): string => {
    const a = String(body?.aspect_ratio ?? '16:9');
    return ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', '9:21'].includes(a) ? a : '16:9';
  })();
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: 'text-to-video',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: res as any,
  } as any);

  const input: any = { 
    prompt: body.prompt, 
    duration: durationSec,
    resolution: res,
    aspect_ratio: aspect,
    fps: 24,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed))) input.seed = Number(body.seed);
  if (typeof body.camera_fixed === 'boolean') input.camera_fixed = body.camera_fixed;
  // Reference images (1-4 images) for guiding video generation
  // Note: Cannot be used with 1080p resolution or first/last frame images
  if (Array.isArray(body.reference_images) && body.reference_images.length > 0 && body.reference_images.length <= 4) {
    // Validate that reference images are not used with incompatible settings
    if (res === '1080p') {
      console.warn('[seedanceT2vSubmit] reference_images cannot be used with 1080p resolution, ignoring');
    } else {
      input.reference_images = body.reference_images.slice(0, 4); // Limit to 4 images
    }
  }

  let predictionId = '';
  try {
    // Try to get version, but if model doesn't exist, we'll get a better error message
    let version: string | null = null;
    try {
      version = await getLatestModelVersion(replicate, modelBase);
      // eslint-disable-next-line no-console
      console.log('[seedanceT2vSubmit] Model version lookup', { modelBase, version: version || 'not found' });
    } catch (versionError: any) {
      // eslint-disable-next-line no-console
      console.warn('[seedanceT2vSubmit] Version lookup failed, will try direct model', { modelBase, error: versionError?.message });
      // Continue without version - will try direct model usage
    }
    
    // eslint-disable-next-line no-console
    console.log('[seedanceT2vSubmit] Creating prediction', { modelBase, version: version || 'latest', input });
    const pred = await replicate.predictions.create(version ? { version, input } : { model: modelBase, input });
    predictionId = (pred as any)?.id || '';
    if (!predictionId) throw new Error('Missing prediction id');
    // eslint-disable-next-line no-console
    console.log('[seedanceT2vSubmit] Prediction created', { predictionId });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[seedanceT2vSubmit] Error creating prediction', { 
      modelBase, 
      error: e?.message || e, 
      stack: e?.stack,
      response: e?.response,
      status: e?.status,
      data: e?.data,
      statusCode: e?.statusCode
    });
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate submit failed' } as any);
    
    // Provide a more helpful error message for 404s
    if (e?.statusCode === 404 || e?.response?.status === 404 || (e?.message && e.message.includes('404'))) {
      const errorMessage = `Model "${modelBase}" not found on Replicate. Please verify the model name is correct. Error: ${e?.message || e?.response?.data?.detail || 'Model not found'}`;
      throw new ApiError(errorMessage, 404, e);
    }
    
    const errorMessage = e?.message || e?.response?.data?.detail || e?.response?.data?.message || 'Replicate API error';
    throw new ApiError(`Failed to submit Seedance T2V job: ${errorMessage}`, 502, e);
  }
  await generationHistoryRepository.update(uid, historyId, { provider: 'replicate', providerTaskId: predictionId } as any);
  return { requestId: predictionId, historyId, model: modelBase, status: 'submitted' };
}

export async function seedanceI2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError('prompt is required', 400);
  if (!body?.image) throw new ApiError('image is required', 400);
  const replicate = ensureReplicate();
  const modelStr = String(body.model || '').toLowerCase();
  const speed = String(body.speed || '').toLowerCase();
  const isLite = modelStr.includes('lite') || speed === 'lite' || speed.includes('lite');
  // Correct model names on Replicate: bytedance/seedance-1-pro and bytedance/seedance-1-lite (not 1.0)
  const modelBase = isLite ? 'bytedance/seedance-1-lite' : 'bytedance/seedance-1-pro';
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid } as any;
  const durationSec = ((): number => {
    const d = Number(body?.duration ?? 5);
    return Math.max(2, Math.min(12, Math.round(d)));
  })();
  const res = ((): string => {
    const r = String(body?.resolution ?? '1080p').toLowerCase();
    const m = r.match(/(480|720|1080)/);
    return m ? `${m[1]}p` : '1080p';
  })();
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: 'text-to-video',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: res as any,
  } as any);

  const input: any = { 
    prompt: body.prompt,
    image: String(body.image),
    duration: durationSec,
    resolution: res,
    fps: 24,
  };
  if (body.seed != null && Number.isInteger(Number(body.seed))) input.seed = Number(body.seed);
  if (typeof body.camera_fixed === 'boolean') input.camera_fixed = body.camera_fixed;
  if (body.last_frame_image && String(body.last_frame_image).length > 5) input.last_frame_image = String(body.last_frame_image);
  // Reference images (1-4 images) for guiding video generation
  // Note: Cannot be used with 1080p resolution or first/last frame images
  if (Array.isArray(body.reference_images) && body.reference_images.length > 0 && body.reference_images.length <= 4) {
    // Validate that reference images are not used with incompatible settings
    if (res === '1080p' || (body.last_frame_image && String(body.last_frame_image).length > 5)) {
      console.warn('[seedanceI2vSubmit] reference_images cannot be used with 1080p resolution or last_frame_image, ignoring');
    } else {
      input.reference_images = body.reference_images.slice(0, 4); // Limit to 4 images
    }
  }

  let predictionId = '';
  try {
    // Try to get version, but if model doesn't exist, we'll get a better error message
    let version: string | null = null;
    try {
      version = await getLatestModelVersion(replicate, modelBase);
      // eslint-disable-next-line no-console
      console.log('[seedanceI2vSubmit] Model version lookup', { modelBase, version: version || 'not found' });
    } catch (versionError: any) {
      // eslint-disable-next-line no-console
      console.warn('[seedanceI2vSubmit] Version lookup failed, will try direct model', { modelBase, error: versionError?.message });
      // Continue without version - will try direct model usage
    }
    
    // eslint-disable-next-line no-console
    console.log('[seedanceI2vSubmit] Creating prediction', { modelBase, version: version || 'latest', inputKeys: Object.keys(input) });
    const pred = await replicate.predictions.create(version ? { version, input } : { model: modelBase, input });
    predictionId = (pred as any)?.id || '';
    if (!predictionId) throw new Error('Missing prediction id');
    // eslint-disable-next-line no-console
    console.log('[seedanceI2vSubmit] Prediction created', { predictionId });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[seedanceI2vSubmit] Error creating prediction', { 
      modelBase, 
      error: e?.message || e, 
      stack: e?.stack,
      response: e?.response,
      status: e?.status,
      data: e?.data,
      statusCode: e?.statusCode
    });
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate submit failed' } as any);
    
    // Provide a more helpful error message for 404s
    if (e?.statusCode === 404 || e?.response?.status === 404 || (e?.message && e.message.includes('404'))) {
      const errorMessage = `Model "${modelBase}" not found on Replicate. Please verify the model name is correct. Error: ${e?.message || e?.response?.data?.detail || 'Model not found'}`;
      throw new ApiError(errorMessage, 404, e);
    }
    
    const errorMessage = e?.message || e?.response?.data?.detail || e?.response?.data?.message || 'Replicate API error';
    throw new ApiError(`Failed to submit Seedance I2V job: ${errorMessage}`, 502, e);
  }
  await generationHistoryRepository.update(uid, historyId, { provider: 'replicate', providerTaskId: predictionId } as any);
  return { requestId: predictionId, historyId, model: modelBase, status: 'submitted' };
}

Object.assign(replicateService, { seedanceT2vSubmit, seedanceI2vSubmit });

// ============ Queue-style API for Replicate PixVerse v5 ============

export async function pixverseT2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError('prompt is required', 400);
  const replicate = ensureReplicate();
  const modelBase = (body.model && String(body.model).length > 0 ? String(body.model) : 'pixverseai/pixverse-v5');
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid } as any;
  const durationSec = ((): number => {
    const s = String(body?.duration ?? '5').toLowerCase();
    const m = s.match(/(5|8)/);
    return m ? Number(m[1]) : 5;
  })();
  const quality = ((): string => {
    const q = String(body?.quality ?? body?.resolution ?? '720p').toLowerCase();
    const m = q.match(/(360|540|720|1080)/);
    return m ? `${m[1]}p` : '720p';
  })();

  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: 'text-to-video',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: quality as any,
  } as any);

  const input: any = {
    prompt: body.prompt,
    duration: durationSec,
    quality,
    aspect_ratio: ((): string => {
      const a = String(body?.aspect_ratio ?? '16:9');
      return ['16:9','9:16','1:1'].includes(a) ? a : '16:9';
    })(),
  };
  if (body.seed != null && Number.isInteger(Number(body.seed))) input.seed = Number(body.seed);
  if (body.negative_prompt != null) input.negative_prompt = String(body.negative_prompt);

  let predictionId = '';
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    const pred = await replicate.predictions.create(version ? { version, input } : { model: modelBase, input });
    predictionId = (pred as any)?.id || '';
    if (!predictionId) throw new Error('Missing prediction id');
  } catch (e: any) {
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate submit failed' } as any);
    throw new ApiError('Failed to submit PixVerse T2V job', 502, e);
  }
  await generationHistoryRepository.update(uid, historyId, { provider: 'replicate', providerTaskId: predictionId } as any);
  return { requestId: predictionId, historyId, model: modelBase, status: 'submitted' };
}

export async function pixverseI2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError('prompt is required', 400);
  if (!body?.image) throw new ApiError('image is required', 400);
  const replicate = ensureReplicate();
  const modelBase = (body.model && String(body.model).length > 0 ? String(body.model) : 'pixverseai/pixverse-v5');
  const creator = await authRepository.getUserById(uid);
  const createdBy = creator ? { uid, username: creator.username, email: (creator as any)?.email } : { uid } as any;
  const durationSec = ((): number => {
    const s = String(body?.duration ?? '5').toLowerCase();
    const m = s.match(/(5|8)/);
    return m ? Number(m[1]) : 5;
  })();
  const quality = ((): string => {
    const q = String(body?.quality ?? body?.resolution ?? '720p').toLowerCase();
    const m = q.match(/(360|540|720|1080)/);
    return m ? `${m[1]}p` : '720p';
  })();

  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: body.prompt,
    model: modelBase,
    generationType: 'text-to-video',
    visibility: body.isPublic ? 'public' : 'private',
    isPublic: body.isPublic ?? false,
    createdBy,
    duration: durationSec as any,
    resolution: quality as any,
  } as any);

  const input: any = {
    prompt: body.prompt,
    image: String(body.image),
    duration: durationSec,
    quality,
    aspect_ratio: ((): string => {
      const a = String(body?.aspect_ratio ?? '16:9');
      return ['16:9','9:16','1:1'].includes(a) ? a : '16:9';
    })(),
  };
  if (body.seed != null && Number.isInteger(Number(body.seed))) input.seed = Number(body.seed);
  if (body.negative_prompt != null) input.negative_prompt = String(body.negative_prompt);

  let predictionId = '';
  try {
    const version = await getLatestModelVersion(replicate, modelBase);
    const pred = await replicate.predictions.create(version ? { version, input } : { model: modelBase, input });
    predictionId = (pred as any)?.id || '';
    if (!predictionId) throw new Error('Missing prediction id');
  } catch (e: any) {
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate submit failed' } as any);
    throw new ApiError('Failed to submit PixVerse I2V job', 502, e);
  }
  await generationHistoryRepository.update(uid, historyId, { provider: 'replicate', providerTaskId: predictionId } as any);
  return { requestId: predictionId, historyId, model: modelBase, status: 'submitted' };
}

Object.assign(replicateService, { pixverseT2vSubmit, pixverseI2vSubmit });