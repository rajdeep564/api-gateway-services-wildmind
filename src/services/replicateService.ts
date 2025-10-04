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

export async function removeBackground(uid: string, body: {
  image: string;
  model?: string;
  format?: 'png' | 'jpg' | 'jpeg' | 'webp';
  reverse?: boolean;
  threshold?: number;
  background_type?: string;
  isPublic?: boolean;
}) {
  const key = (process.env.REPLICATE_API_TOKEN as string) || ((env as any).replicateApiKey as string);
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
    outputUrl = extractFirstUrl(output);
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
  const key = (process.env.REPLICATE_API_TOKEN as string) || ((env as any).replicateApiKey as string);
  if (!key) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.upscale] Missing REPLICATE_API_TOKEN');
    throw new ApiError('Replicate API key not configured', 500);
  }
  if (!body?.image) throw new ApiError('image is required', 400);

  const replicate = new Replicate({ auth: key });

  const modelBase = body.model && body.model.length > 0 ? body.model : 'philz1337x/clarity-upscaler';
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
  let outputUrl = '';
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
    const modelSpec = composeModelSpec(modelBase, body.version);
    // eslint-disable-next-line no-console
    console.log('[replicateService.upscale] run', { modelSpec, inputKeys: Object.keys(input) });
    const output: any = await replicate.run(modelSpec as any, { input });
    // eslint-disable-next-line no-console
    console.log('[replicateService.upscale] output', typeof output, Array.isArray(output) ? output.length : 'n/a');
    outputUrl = extractFirstUrl(output);
    if (!outputUrl) throw new Error('No output URL returned by Replicate');
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.upscale] error', e?.message || e);
    try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'failed', error: e?.message || 'Replicate failed' }); } catch {}
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate failed' } as any);
    throw new ApiError('Replicate generation failed', 502, e);
  }

  let storedUrl = outputUrl;
  let storagePath = '';
  try {
    const username = creator?.username || uid;
    const uploaded = await uploadFromUrlToZata({ sourceUrl: outputUrl, keyPrefix: `users/${username}/image/${historyId}`, fileName: 'image-1' });
    storedUrl = uploaded.publicUrl;
    storagePath = uploaded.key;
  } catch {}

  await generationHistoryRepository.update(uid, historyId, { status: 'completed', images: [{ id: `replicate-${Date.now()}`, url: storedUrl, storagePath, originalUrl: outputUrl } as any] } as any);
  try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'completed', images: [{ id: `replicate-${Date.now()}`, url: storedUrl, storagePath, originalUrl: outputUrl }] }); } catch {}
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh) await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, { uid, username: creator?.username, displayName: (creator as any)?.displayName, photoURL: creator?.photoURL });
  } catch {}
  return { images: [{ id: `replicate-${Date.now()}`, url: storedUrl, storagePath, originalUrl: outputUrl }], historyId, model: modelBase, status: 'completed' } as any;
}

export async function generateImage(uid: string, body: any) {
  const key = (process.env.REPLICATE_API_TOKEN as string) || ((env as any).replicateApiKey as string);
  if (!key) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.generateImage] Missing REPLICATE_API_TOKEN');
    throw new ApiError('Replicate API key not configured', 500);
  }
  if (!body?.prompt) throw new ApiError('prompt is required', 400);

  const replicate = new Replicate({ auth: key });
  const modelBase = body.model && body.model.length > 0 ? body.model : 'bytedance/seedream-4';
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
  let outputUrl = '';
  try {
    const { model: _m, isPublic: _p, ...rest } = body || {};
    const input: any = { prompt: body.prompt, ...rest };
    // Sanitize inputs
    if (modelBase === 'bytedance/seedream-4') {
      // seedream standard prompt-based: nothing special here
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
    const output: any = await replicate.run(modelSpec as any, { input });
    // eslint-disable-next-line no-console
    console.log('[replicateService.generateImage] output', typeof output, Array.isArray(output) ? output.length : 'n/a');
    outputUrl = extractFirstUrl(output);
    if (!outputUrl) throw new Error('No output URL returned by Replicate');
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[replicateService.generateImage] error', e?.message || e);
    try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'failed', error: e?.message || 'Replicate failed' }); } catch {}
    await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: e?.message || 'Replicate failed' } as any);
    throw new ApiError('Replicate generation failed', 502, e);
  }

  let storedUrl = outputUrl;
  let storagePath = '';
  try {
    const username = creator?.username || uid;
    const uploaded = await uploadFromUrlToZata({ sourceUrl: outputUrl, keyPrefix: `users/${username}/image/${historyId}`, fileName: 'image-1' });
    storedUrl = uploaded.publicUrl;
    storagePath = uploaded.key;
  } catch {}

  await generationHistoryRepository.update(uid, historyId, { status: 'completed', images: [{ id: `replicate-${Date.now()}`, url: storedUrl, storagePath, originalUrl: outputUrl } as any] } as any);
  try { await replicateRepository.updateGenerationRecord(legacyId, { status: 'completed', images: [{ id: `replicate-${Date.now()}`, url: storedUrl, storagePath, originalUrl: outputUrl }] }); } catch {}
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh) await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, { uid, username: creator?.username, displayName: (creator as any)?.displayName, photoURL: creator?.photoURL });
  } catch {}
  return { images: [{ id: `replicate-${Date.now()}`, url: storedUrl, storagePath, originalUrl: outputUrl }], historyId, model: modelBase, status: 'completed' } as any;
}

export const replicateService = { removeBackground, upscale, generateImage };
