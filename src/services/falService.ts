import {
  FalGenerateRequest,
  FalGenerateResponse,
  FalGeneratedImage,
} from "../types/fal";
import { ApiError } from "../utils/errorHandler";
import { fal } from "@fal-ai/client";
import { generationHistoryRepository } from "../repository/generationHistoryRepository";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import { authRepository } from "../repository/auth/authRepository";
import { GenerationHistoryItem, GenerationType, VideoMedia } from "../types/generate";
import { env } from "../config/env";
import { uploadFromUrlToZata, uploadDataUriToZata } from "../utils/storage/zataUpload";
import { falRepository } from "../repository/falRepository";
import { creditsRepository } from "../repository/creditsRepository";
import { computeFalVeoCostFromModel } from "../utils/pricing/falPricing";
import { syncToMirror, updateMirror, ensureMirrorSync } from "../utils/mirrorHelper";
import { aestheticScoreService } from "./aestheticScoreService";
import { markGenerationCompleted } from "./generationHistoryService";

const buildGenerationImageFileName = (historyId?: string, index: number = 0) => {
  if (historyId) {
    return `${historyId}-image-${index + 1}`;
  }
  return `image-${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 6)}`;
};

async function generate(
  uid: string,
  payload: FalGenerateRequest
): Promise<FalGenerateResponse & { historyId?: string }> {
  const {

    prompt,
    userPrompt,
    model,
    // Support both old (n) and new (num_images)
    n,
    num_images,
    // New schema: aspect_ratio (fallback to frameSize)
    aspect_ratio,
    frameSize,
    uploadedImages = [],
    output_format = "jpeg",
    generationType,
    tags,
    nsfw,
    visibility,
    isPublic,
    characterName,
  } = payload as any;

  const imagesRequested = Number.isFinite(num_images) && (num_images as number) > 0 ? (num_images as number) : (Number.isFinite(n) && (n as number) > 0 ? (n as number) : 1);
  const imagesRequestedClamped = Math.max(1, Math.min(10, imagesRequested));
  const resolvedAspect = (aspect_ratio || frameSize || '1:1') as any;

  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError("FAL AI API key not configured", 500);
  if (!prompt) throw new ApiError("Prompt is required", 400);

  fal.config({ credentials: falKey });

  // Resolve creator info up-front
  const creator = await authRepository.getUserById(uid);
  const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
  // Create history first (source of truth)
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt,
    userPrompt: userPrompt || undefined,
    model,
    generationType: (payload as any).generationType || 'text-to-image',
    visibility: (payload as any).visibility || 'private',
    tags: (payload as any).tags,
    nsfw: (payload as any).nsfw,
    isPublic: (payload as any).isPublic === true,
    frameSize: resolvedAspect,
    aspect_ratio: (payload as any).aspect_ratio || resolvedAspect,
    // Store characterName only for text-to-character generation type
    ...(generationType === 'text-to-character' && characterName ? { characterName } : {}),
    createdBy,
    
    
  });
  // Persist any user-uploaded input images to Zata and get public URLs
  // Use 'character' folder for text-to-character generation input images
  const inputFolder = generationType === 'text-to-character' ? 'character' : 'input';
  let publicImageUrls: string[] = [];
  try {
    const username = creator?.username || uid;
    const keyPrefix = `users/${username}/${inputFolder}/${historyId}`;
    const inputPersisted: any[] = [];
    let idx = 0;
    for (const src of (uploadedImages || [])) {
      if (!src || typeof src !== 'string') continue;
      try {
        const stored = /^data:/i.test(src)
          ? await uploadDataUriToZata({ dataUri: src, keyPrefix, fileName: `input-${++idx}` })
          : await uploadFromUrlToZata({ sourceUrl: src, keyPrefix, fileName: `input-${++idx}` });
        inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: src });
        publicImageUrls.push(stored.publicUrl);
      } catch {}
    }
    if (inputPersisted.length > 0) await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
  } catch {}
  // Create public generations record for FAL (like BFL)
  const legacyId = await falRepository.createGenerationRecord({ prompt, model, n: imagesRequested, isPublic: (payload as any).isPublic === true }, createdBy);

  // Map our model key to FAL endpoints
  let modelEndpoint: string;
  const modelLower = (model || '').toLowerCase();
  if (modelLower.includes('imagen-4')) {
    // Imagen 4 family
    if (modelLower.includes('ultra')) modelEndpoint = 'fal-ai/imagen4/preview/ultra';
    else if (modelLower.includes('fast')) modelEndpoint = 'fal-ai/imagen4/preview/fast';
    else modelEndpoint = 'fal-ai/imagen4/preview'; // standard
  } else if (modelLower.includes('seedream')) {
    modelEndpoint = 'fal-ai/bytedance/seedream/v4/text-to-image';
  } else {
    // Default to Google Nano Banana (Gemini)
    modelEndpoint = uploadedImages.length > 0
      ? 'fal-ai/gemini-25-flash-image/edit'
      : 'fal-ai/gemini-25-flash-image';
  }

  // Parse prompt to extract @references and map them to image indices
  // This ensures @Rajdeep maps to image[0], @Aryan maps to image[1], etc.
  const parseCharacterReferences = (promptText: string): string[] => {
    const refMatches = Array.from((promptText || '').matchAll(/@(\w+)/gi)) as RegExpMatchArray[];
    return refMatches.map(match => match[1].toLowerCase());
  };

  // Transform prompt to replace @references with explicit image references
  // @Rajdeep -> "the character from the first reference image" (image 0)
  // @Aryan -> "the character from the second reference image" (image 1)
  const transformPromptWithImageReferences = (promptText: string, imageCount: number): string => {
    if (!promptText || imageCount === 0) return promptText;
    
    const refMatches = Array.from((promptText || '').matchAll(/@(\w+)/gi)) as RegExpMatchArray[];
    if (refMatches.length === 0) return promptText;
    
    // Create a map of character names to their image indices (in order of appearance)
    const characterToIndex = new Map<string, number>();
    let currentIndex = 0;
    
    refMatches.forEach((match) => {
      const charName = match[1].toLowerCase();
      if (!characterToIndex.has(charName)) {
        characterToIndex.set(charName, currentIndex);
        currentIndex++;
      }
    });
    
    // Replace @references with explicit image references
    let transformedPrompt = promptText;
    characterToIndex.forEach((imageIndex, charName) => {
      const regex = new RegExp(`@${charName}\\b`, 'gi');
      const imageRef = imageIndex === 0 
        ? 'the character from the first reference image'
        : imageIndex === 1
        ? 'the character from the second reference image'
        : imageIndex === 2
        ? 'the character from the third reference image'
        : `the character from reference image ${imageIndex + 1}`;
      transformedPrompt = transformedPrompt.replace(regex, imageRef);
    });
    
    return transformedPrompt;
  };

  // Transform prompt if we have character references and images
  const hasCharacterRefs = prompt && /@\w+/i.test(prompt);
  const hasImages = (publicImageUrls.length > 0 || uploadedImages.length > 0);
  let finalPrompt = (hasCharacterRefs && hasImages) 
    ? transformPromptWithImageReferences(prompt, publicImageUrls.length || uploadedImages.length)
    : prompt;
  
  // For text-to-character generation, enhance prompt for passport photo style in square format with exact skin details
  if (generationType === 'text-to-character') {
    finalPrompt = `${finalPrompt}, passport photo style, front facing, looking directly at camera, neutral expression, head and shoulders visible, hands partially visible, preserve exact skin texture and details from reference image, natural looking, maintain identical skin tone and complexion, professional photography, high quality, photorealistic, square format, light neutral background, even studio lighting, no white borders, no white padding, no white margins, no frames, no white space, edge-to-edge, full frame character, seamless background integration`;
  }

  // If the requested model is an ElevenLabs variant, detect whether it's TTS or Dialogue and handle as audio generation
  const modelLowerRaw = String(model || '').toLowerCase();
  const wantsEleven = modelLowerRaw.includes('eleven');
  const wantsMaya = modelLowerRaw.includes('maya');
  const wantsChatterbox = modelLowerRaw.includes('chatterbox') || modelLowerRaw.includes('multilingual');
  // Heuristic: dialogue uses `inputs` array or mentions 'dialogue', TTS uses `text` or mentions 'tts'/'text-to-speech'
  const hasInputsArray = Array.isArray((payload as any).inputs) && (payload as any).inputs.length > 0;
  const hasText = typeof (payload as any).text === 'string' && (payload as any).text.trim().length > 0;
  const isElevenDialogue = hasInputsArray || modelLowerRaw.includes('dialogue') || modelLowerRaw.includes('text-to-dialogue');
  const isElevenTts = hasText || modelLowerRaw.includes('tts') || modelLowerRaw.includes('text-to-speech') || modelLowerRaw.includes('text-to-voice');
  const isMayaTts = hasText || modelLowerRaw.includes('maya') || modelLowerRaw.includes('maya-1') || modelLowerRaw.includes('maya-1-voice');
  const isChatterboxMultilingual = hasText || modelLowerRaw.includes('chatterbox') || modelLowerRaw.includes('multilingual');

  if (wantsMaya && isMayaTts) {
    // Maya TTS flow
    const mayaEndpoint = 'fal-ai/maya';
    try {
      const inputBody: any = {
        text: (payload as any).text || finalPrompt,
      };
      if ((payload as any).prompt) inputBody.prompt = (payload as any).prompt;
      if ((payload as any).temperature != null) inputBody.temperature = (payload as any).temperature;
      if ((payload as any).top_p != null) inputBody.top_p = (payload as any).top_p;
      if ((payload as any).max_tokens != null) inputBody.max_tokens = (payload as any).max_tokens;
      if ((payload as any).repetition_penalty != null) inputBody.repetition_penalty = (payload as any).repetition_penalty;
      if ((payload as any).output_format) inputBody.output_format = (payload as any).output_format;

      console.log('[falService.generate] Calling Maya TTS model:', { mayaEndpoint, input: { ...inputBody, text: String(inputBody.text).slice(0, 120) + (String(inputBody.text).length > 120 ? '...' : '') } });
      const result = await fal.subscribe(mayaEndpoint as any, ({ input: inputBody, logs: true } as unknown) as any);

      const audioUrl: string | undefined = (result as any)?.data?.audio?.url;
      if (!audioUrl) throw new ApiError('No audio URL returned from FAL Maya API', 502);

      const username = creator?.username || uid;
      let stored: any;
      try {
        stored = await uploadFromUrlToZata({ sourceUrl: audioUrl, keyPrefix: `users/${username}/audio/${historyId}`, fileName: 'maya-tts' });
      } catch (e) {
        stored = { publicUrl: audioUrl, key: '' };
      }

      const audioObj = { id: result.requestId || `fal-${Date.now()}`, url: stored.publicUrl, storagePath: stored.key, originalUrl: audioUrl } as any;

      await generationHistoryRepository.update(uid, historyId, { status: 'completed', audio: audioObj } as any);
      await falRepository.updateGenerationRecord(legacyId, { status: 'completed', audio: audioObj } as any);
      await syncToMirror(uid, historyId);

      return { audio: audioObj, historyId, model: mayaEndpoint, status: 'completed' } as any;
    } catch (err: any) {
      const message = err?.message || 'Failed to generate audio with FAL Maya API';
      try {
        await falRepository.updateGenerationRecord(legacyId, { status: 'failed', error: message } as any);
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
      } catch (mirrorErr) {
        console.error('[falService.generate][maya] Failed to mirror error state:', mirrorErr);
      }
      throw new ApiError(message, 500);
    }
  }

  // Chatterbox multilingual TTS flow
  if (wantsChatterbox && isChatterboxMultilingual) {
    const chatterEndpoint = 'fal-ai/chatterbox/text-to-speech/multilingual';
    try {
      const inputBody: any = {
        text: (payload as any).text || finalPrompt,
      };
      if ((payload as any).voice) inputBody.voice = (payload as any).voice;
      if ((payload as any).custom_audio_language) inputBody.custom_audio_language = (payload as any).custom_audio_language;
      if ((payload as any).exaggeration != null) inputBody.exaggeration = (payload as any).exaggeration;
      if ((payload as any).temperature != null) inputBody.temperature = (payload as any).temperature;
      if ((payload as any).cfg_scale != null) inputBody.cfg_scale = (payload as any).cfg_scale;
      if ((payload as any).seed != null) inputBody.seed = (payload as any).seed;
      if ((payload as any).audio_url) inputBody.audio_url = (payload as any).audio_url;

      console.log('[falService.generate] Calling Chatterbox multilingual TTS model:', { chatterEndpoint, input: { ...inputBody, text: String(inputBody.text).slice(0, 120) + (String(inputBody.text).length > 120 ? '...' : '') } });
      const result = await fal.subscribe(chatterEndpoint as any, ({ input: inputBody, logs: true } as unknown) as any);

      const audioUrl: string | undefined = (result as any)?.data?.audio?.url;
      if (!audioUrl) throw new ApiError('No audio URL returned from FAL Chatterbox API', 502);

      const username = creator?.username || uid;
      let stored: any;
      try {
        stored = await uploadFromUrlToZata({ sourceUrl: audioUrl, keyPrefix: `users/${username}/audio/${historyId}`, fileName: 'chatterbox-multilingual' });
      } catch (e) {
        stored = { publicUrl: audioUrl, key: '' };
      }

      const audioObj = { id: result.requestId || `fal-${Date.now()}`, url: stored.publicUrl, storagePath: stored.key, originalUrl: audioUrl } as any;

      await generationHistoryRepository.update(uid, historyId, { status: 'completed', audio: audioObj } as any);
      await falRepository.updateGenerationRecord(legacyId, { status: 'completed', audio: audioObj } as any);
      await syncToMirror(uid, historyId);

      return { audio: audioObj, historyId, model: chatterEndpoint, status: 'completed' } as any;
    } catch (err: any) {
      const message = err?.message || 'Failed to generate audio with FAL Chatterbox API';
      try {
        await falRepository.updateGenerationRecord(legacyId, { status: 'failed', error: message } as any);
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
      } catch (mirrorErr) {
        console.error('[falService.generate][chatterbox] Failed to mirror error state:', mirrorErr);
      }
      throw new ApiError(message, 500);
    }
  }

  if (wantsEleven && (isElevenDialogue || isElevenTts)) {
    // Prefer explicit payload shape first
    if (isElevenTts) {
      // Text-to-Speech flow
      const ttsEndpoint = 'fal-ai/elevenlabs/tts/eleven-v3';
      try {
        const inputBody: any = {
          text: (payload as any).text || finalPrompt,
        };
        if ((payload as any).voice) inputBody.voice = (payload as any).voice;
        if ((payload as any).stability != null) inputBody.stability = (payload as any).stability;
        if ((payload as any).similarity_boost != null) inputBody.similarity_boost = (payload as any).similarity_boost;
        if ((payload as any).style != null) inputBody.style = (payload as any).style;
        if ((payload as any).speed != null) inputBody.speed = (payload as any).speed;
        if ((payload as any).timestamps != null) inputBody.timestamps = (payload as any).timestamps;
        if ((payload as any).language_code) inputBody.language_code = (payload as any).language_code;
        if ((payload as any).output_format) inputBody.output_format = (payload as any).output_format;
        if ((payload as any).sync_mode != null) inputBody.sync_mode = (payload as any).sync_mode;
        if ((payload as any).seed != null) inputBody.seed = (payload as any).seed;

        console.log('[falService.generate] Calling ElevenLabs TTS model:', { ttsEndpoint, input: { ...inputBody, text: String(inputBody.text).slice(0, 120) + (String(inputBody.text).length > 120 ? '...' : '') } });
        const result = await fal.subscribe(ttsEndpoint as any, ({ input: inputBody, logs: true } as unknown) as any);

        const audioUrl: string | undefined = (result as any)?.data?.audio?.url;
        if (!audioUrl) throw new ApiError('No audio URL returned from FAL ElevenLabs TTS API', 502);

        const username = creator?.username || uid;
        let stored: any;
        try {
          stored = await uploadFromUrlToZata({ sourceUrl: audioUrl, keyPrefix: `users/${username}/audio/${historyId}`, fileName: 'eleven-tts' });
        } catch (e) {
          stored = { publicUrl: audioUrl, key: '' };
        }

        const audioObj = { id: result.requestId || `fal-${Date.now()}`, url: stored.publicUrl, storagePath: stored.key, originalUrl: audioUrl } as any;

        await generationHistoryRepository.update(uid, historyId, { status: 'completed', audio: audioObj } as any);
        await falRepository.updateGenerationRecord(legacyId, { status: 'completed', audio: audioObj } as any);
        await syncToMirror(uid, historyId);

        return { audio: audioObj, historyId, model: ttsEndpoint, status: 'completed' } as any;
      } catch (err: any) {
        const message = err?.message || 'Failed to generate audio with FAL ElevenLabs TTS API';
        try {
          await falRepository.updateGenerationRecord(legacyId, { status: 'failed', error: message } as any);
          await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
          await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
        } catch (mirrorErr) {
          console.error('[falService.generate][eleven-tts] Failed to mirror error state:', mirrorErr);
        }
        throw new ApiError(message, 500);
      }
    }

    if (isElevenDialogue) {
      // Text-to-Dialogue flow
      const dialogueEndpoint = 'fal-ai/elevenlabs/text-to-dialogue/eleven-v3';
      try {
        const inputs = (payload as any).inputs || [{ text: finalPrompt, voice: (payload as any).voice || 'Rachel' }];
        const inputBody: any = { inputs };
        if ((payload as any).stability != null) inputBody.stability = (payload as any).stability;
        if ((payload as any).use_speaker_boost != null) inputBody.use_speaker_boost = (payload as any).use_speaker_boost;
        if ((payload as any).pronunciation_dictionary_locators) inputBody.pronunciation_dictionary_locators = (payload as any).pronunciation_dictionary_locators;
        if ((payload as any).seed != null) inputBody.seed = (payload as any).seed;

        console.log('[falService.generate] Calling ElevenLabs dialogue model:', { dialogueEndpoint, input: { ...inputBody, inputs: `[${(inputs || []).length} items]` } });
        const result = await fal.subscribe(dialogueEndpoint as any, ({ input: inputBody, logs: true } as unknown) as any);

        const audioUrl: string | undefined = (result as any)?.data?.audio?.url;
        if (!audioUrl) throw new ApiError('No audio URL returned from FAL ElevenLabs API', 502);

        const username = creator?.username || uid;
        let stored: any;
        try {
          stored = await uploadFromUrlToZata({ sourceUrl: audioUrl, keyPrefix: `users/${username}/audio/${historyId}`, fileName: 'eleven-dialogue' });
        } catch (e) {
          stored = { publicUrl: audioUrl, key: '' };
        }

        const audioObj = { id: result.requestId || `fal-${Date.now()}`, url: stored.publicUrl, storagePath: stored.key, originalUrl: audioUrl } as any;

        await generationHistoryRepository.update(uid, historyId, { status: 'completed', audio: audioObj } as any);
        await falRepository.updateGenerationRecord(legacyId, { status: 'completed', audio: audioObj } as any);
        await syncToMirror(uid, historyId);

        return { audio: audioObj, historyId, model: dialogueEndpoint, status: 'completed' } as any;
      } catch (err: any) {
        const message = err?.message || 'Failed to generate audio with FAL ElevenLabs API';
        try {
          await falRepository.updateGenerationRecord(legacyId, { status: 'failed', error: message } as any);
          await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
          await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
        } catch (mirrorErr) {
          console.error('[falService.generate][eleven-dialogue] Failed to mirror error state:', mirrorErr);
        }
        throw new ApiError(message, 500);
      }
    }
  }

  try {
    const fileNameForIndex = (index: number) => buildGenerationImageFileName(historyId, index);
    const imagePromises = Array.from({ length: imagesRequested }, async (_, index) => {
  const input: any = { prompt: finalPrompt, output_format, num_images: 1 };
      // Seedream expects image_size instead of aspect_ratio; allow explicit image_size override
      if (modelEndpoint.includes('seedream')) {
        const explicit = (payload as any).image_size;
        if (explicit) {
          input.image_size = explicit;
        } else {
          // Map common aspect ratios to Seedream enums
          const map: Record<string, string> = {
            '1:1': 'square',
            '4:3': 'landscape_4_3',
            '3:4': 'portrait_4_3',
            '16:9': 'landscape_16_9',
            '9:16': 'portrait_16_9',
          };
          input.image_size = map[String(resolvedAspect)] || 'square';
        }
      } else if (resolvedAspect) {
        input.aspect_ratio = resolvedAspect;
      }
      // Imagen 4 supports resolution and seed/negative_prompt
      if (modelEndpoint.startsWith('fal-ai/imagen4/')) {
        if ((payload as any).resolution) input.resolution = (payload as any).resolution; // '1K' | '2K'
        if ((payload as any).seed != null) input.seed = (payload as any).seed;
        if ((payload as any).negative_prompt) input.negative_prompt = (payload as any).negative_prompt;
      }
      if (modelEndpoint.endsWith("/edit")) {
        // Use public URLs for edit endpoint; allow up to 10 reference images for Nano Banana I2I
        const refs = publicImageUrls.length > 0 ? publicImageUrls : uploadedImages;
        // Images are already ordered by frontend to match @references in prompt
        // @Rajdeep -> image[0], @Aryan -> image[1], etc.
        input.image_urls = Array.isArray(refs) ? refs.slice(0, 10) : [];
        
        // For text-to-character generation, add negative prompt to preserve skin details and prevent white padding
        if (generationType === 'text-to-character') {
          input.negative_prompt = 'white padding, white borders, white frames, white margins, thick white space, white background padding, white edges, white space around subject, white space around character, white border around image, white frame around image, pure white background, bright white background, white backdrop, white canvas, altered skin texture, smoothed skin, airbrushed, beautified skin, changed skin tone, different complexion, modified skin details, enhanced skin, retouched skin, changed facial expression, smiling, laughing, frowning, exaggerated expression, looking away, side profile, tilted head, three quarter view, cropped shoulders, missing hands, cut off hands, artistic interpretation, stylized, cartoon, illustration, landscape orientation, busy background, textured background, shadows on background, multiple people, group photo, blurry, low quality, distorted features, unnatural lighting, harsh shadows';
        }
        
        // Log for debugging character mapping
        if (prompt && refs.length > 0) {
          const characterRefs = parseCharacterReferences(prompt);
          try {
            console.log('[falService.generate] Character reference mapping:', {
              originalPrompt: prompt,
              transformedPrompt: finalPrompt,
              characterRefs,
              imageCount: refs.length,
              firstImage: refs[0]?.substring(0, 50) + '...',
            });
          } catch {}
        }
      }

      // Debug log for final body
      try { console.log('[falService.generate] request', { modelEndpoint, input }); } catch {}

      const result = await fal.subscribe(modelEndpoint as any, ({ input, logs: true } as unknown) as any);

      let imageUrl = "";
      if (result?.data?.images?.length > 0) {
        imageUrl = result.data.images[0].url;
      }
      if (!imageUrl)
        throw new ApiError("No image URL returned from FAL API", 502);

      return {
        url: imageUrl,
        originalUrl: imageUrl,
        id: result.requestId || `fal-${Date.now()}-${index}`,
      } as FalGeneratedImage;
    });

    const images = await Promise.all(imagePromises);
    
    // For text-to-character, upload to Zata synchronously to ensure storagePath is set
    // For other types, use background upload for faster response
    const username = creator?.username || uid;
    const outputFolder = generationType === 'text-to-character' ? 'character' : 'image';
    
    let storedImages: any[];
    if (generationType === 'text-to-character') {
      // Synchronous upload for character generation to ensure storagePath is available
      storedImages = await Promise.all(
        images.map(async (img, index) => {
          try {
            const { key, publicUrl } = await uploadFromUrlToZata({
              sourceUrl: img.url,
              keyPrefix: (payload as any)?.storageKeyPrefixOverride || `users/${username}/${outputFolder}/${historyId}`,
              fileName: fileNameForIndex(index),
            });
            return { id: img.id, url: publicUrl, storagePath: key, originalUrl: img.originalUrl || img.url } as any;
          } catch (e) {
            console.error('[falService.generate] Zata upload failed for character:', e);
            return { id: img.id, url: img.url, originalUrl: img.originalUrl || img.url, storagePath: '' } as any;
          }
        })
      );

      // Score images (character path)
      const scoredImages = await aestheticScoreService.scoreImages(storedImages);
      const highestScore = aestheticScoreService.getHighestScore(scoredImages);

      // Mark history completed with scored images & Zata URLs
      await generationHistoryRepository.update(uid, historyId, {
        status: 'completed',
        images: scoredImages,
        frameSize: resolvedAspect,
        aestheticScore: highestScore,
      } as Partial<GenerationHistoryItem>);

      await falRepository.updateGenerationRecord(legacyId, { status: 'completed', images: scoredImages });
      await syncToMirror(uid, historyId);

      // Trigger image optimization (AVIF + thumbnail + blur) in background for character generations
      try {
        markGenerationCompleted(uid, historyId, {
          status: 'completed',
          images: scoredImages,
          isPublic: (payload as any).isPublic === true,
        }).catch(err => console.error('[falService.generate] markGenerationCompleted (character) failed:', err));
      } catch (optErr) {
        console.warn('[falService.generate] markGenerationCompleted invocation error (character):', optErr);
      }

      // Save character to characters collection
      if (characterName && scoredImages.length > 0) {
        try {
          const { characterRepository } = await import('../repository/characterRepository');
          const generatedImage = scoredImages[0];
          const historyEntry = await generationHistoryRepository.get(uid, historyId);
          const inputImages = (historyEntry as any)?.inputImages || [];

          await characterRepository.createCharacter(uid, {
            characterName,
            historyId,
            frontImageUrl: generatedImage.url,
            frontImageStoragePath: generatedImage.storagePath,
            leftImageUrl: inputImages[1]?.url || undefined,
            leftImageStoragePath: inputImages[1]?.storagePath || undefined,
            rightImageUrl: inputImages[2]?.url || undefined,
            rightImageStoragePath: inputImages[2]?.storagePath || undefined,
          });
        } catch (charErr) {
          console.error('[falService.generate] Failed to save character:', charErr);
          // Non-fatal
        }
      }

  return { images: scoredImages as any, historyId, model, status: 'completed' };
    } else {
      // For canvas flows, force synchronous upload using override (so we have storagePath immediately)
      if ((payload as any)?.forceSyncUpload === true || (payload as any)?.storageKeyPrefixOverride) {
        const storedImages = await Promise.all(
          images.map(async (img, index) => {
            try {
              const { key, publicUrl } = await uploadFromUrlToZata({
                sourceUrl: img.url,
                keyPrefix: (payload as any)?.storageKeyPrefixOverride || `users/${username}/${outputFolder}/${historyId}`,
                fileName: fileNameForIndex(index),
              });
              return { id: img.id, url: publicUrl, storagePath: key, originalUrl: img.originalUrl || img.url } as any;
            } catch {
              return { id: img.id, url: img.url, originalUrl: img.originalUrl || img.url } as any;
            }
          })
        );
        await falRepository.updateGenerationRecord(legacyId, { status: 'completed', images: storedImages });
        await generationHistoryRepository.update(uid, historyId, { status: 'completed', images: storedImages, frameSize: resolvedAspect } as any);
        await ensureMirrorSync(uid, historyId);
        try {
          markGenerationCompleted(uid, historyId, { status: 'completed', images: storedImages, isPublic: (payload as any).isPublic === true }).catch(() => {});
        } catch {}
        return { images: storedImages as any, historyId, model, status: 'completed' };
      }
      // For non-character generation, use background upload for faster response
      const quickImages = images.map((img) => ({ id: img.id, url: img.url, originalUrl: img.originalUrl || img.url, storagePath: '' } as any));

      // Score quick images immediately using provider URLs
      const scoredQuick = await aestheticScoreService.scoreImages(quickImages);
      const quickHighest = aestheticScoreService.getHighestScore(scoredQuick);

      // Mark history completed with provider URLs and aesthetic score for instant UX
      await generationHistoryRepository.update(uid, historyId, {
        status: 'completed',
        images: scoredQuick,
        frameSize: resolvedAspect,
        aestheticScore: quickHighest,
      } as Partial<GenerationHistoryItem>);

      // Sync to mirror immediately with provider URLs
      await syncToMirror(uid, historyId);

      // Best-effort: background upload to Zata, then replace URLs in history/mirror and re-score
      setImmediate(async () => {
        try {
          const storedImages = await Promise.all(
            images.map(async (img, index) => {
              try {
                const { key, publicUrl } = await uploadFromUrlToZata({
                  sourceUrl: img.url,
                  keyPrefix: `users/${username}/${outputFolder}/${historyId}`,
                  fileName: fileNameForIndex(index),
                });
                return { id: img.id, url: publicUrl, storagePath: key, originalUrl: img.originalUrl || img.url } as any;
              } catch {
                return { id: img.id, url: img.url, originalUrl: img.originalUrl || img.url } as any;
              }
            })
          );

          // Re-score with final storage URLs for consistency
          const rescored = await aestheticScoreService.scoreImages(storedImages);
          const finalHighest = aestheticScoreService.getHighestScore(rescored);

          await falRepository.updateGenerationRecord(legacyId, { status: 'completed', images: rescored });
          await generationHistoryRepository.update(uid, historyId, { images: rescored, aestheticScore: finalHighest } as any);

          // Ensure mirror sync after Zata upload with retries
          await ensureMirrorSync(uid, historyId);

          // Trigger image optimization once storage paths are available
          try {
            markGenerationCompleted(uid, historyId, {
              status: 'completed',
              images: rescored,
              isPublic: (payload as any).isPublic === true,
            }).catch(err => console.error('[falService.generate] markGenerationCompleted (background upload) failed:', err));
          } catch (optErr) {
            console.warn('[falService.generate] markGenerationCompleted invocation error (background upload):', optErr);
          }
        } catch (e) {
          console.error('[falService.generate] Background Zata upload failed:', e);
          try { await falRepository.updateGenerationRecord(legacyId, { status: 'completed' }); } catch {}
        }
      });

      // Respond quickly with provider URLs & initial aesthetic score
  return { images: scoredQuick as any, historyId, model, status: 'completed' };
    }
  } catch (err: any) {
    const message = err?.message || "Failed to generate images with FAL API";
    try {
      await falRepository.updateGenerationRecord(legacyId, { status: 'failed', error: message });
      await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
      // Ensure failed generations are also mirrored
      await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
    } catch (mirrorErr) {
      console.error('[falService.generate] Failed to mirror error state:', mirrorErr);
    }
    throw new ApiError(message, 500);
  }
}

// Veo3 Text-to-Video (standard)
async function veoTextToVideo(uid: string, payload: {
  prompt: string;
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  duration?: '4s' | '6s' | '8s';
  negative_prompt?: string;
  enhance_prompt?: boolean;
  seed?: number;
  auto_fix?: boolean;
  resolution?: '720p' | '1080p';
  generate_audio?: boolean;
  isPublic?: boolean;
}): Promise<{ videos: VideoMedia[]; historyId: string; model: string; status: 'completed' }>{
  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  if (!payload.prompt) throw new ApiError('Prompt is required', 400);
  fal.config({ credentials: falKey });

  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: payload.prompt,
    model: 'fal-ai/veo3',
    generationType: 'text-to-video',
    visibility: payload.isPublic ? 'public' : 'private',
    isPublic: payload.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
  });

  try {
    const result = await fal.subscribe('fal-ai/veo3' as any, ({ input: {
      prompt: payload.prompt,
      aspect_ratio: payload.aspect_ratio ?? '16:9',
      duration: payload.duration ?? '8s',
      negative_prompt: payload.negative_prompt,
      enhance_prompt: payload.enhance_prompt ?? true,
      seed: payload.seed,
      auto_fix: payload.auto_fix ?? true,
      resolution: payload.resolution ?? '720p',
      generate_audio: payload.generate_audio ?? true,
    }, logs: true } as unknown) as any);

    const videoUrl: string | undefined = (result as any)?.data?.video?.url;
    if (!videoUrl) throw new ApiError('No video URL returned from FAL API', 502);
    const videos: VideoMedia[] = [
      { id: result.requestId || `fal-${Date.now()}`, url: videoUrl, storagePath: '', thumbUrl: undefined },
    ];

    // Score the video for aesthetic quality
    const scoredVideos = await aestheticScoreService.scoreVideos(videos);
    const highestScore = aestheticScoreService.getHighestScore(scoredVideos);

    await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos: scoredVideos, aestheticScore: highestScore } as any);
    // Sync to mirror with retries
    await syncToMirror(uid, historyId);
    return { videos: scoredVideos, historyId, model: 'fal-ai/veo3', status: 'completed' };
  } catch (err: any) {
    const message = err?.message || 'Failed to generate video with FAL API';
    try {
      await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
      await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
    } catch (mirrorErr) {
      console.error('[veoTextToVideo] Failed to mirror error state:', mirrorErr);
    }
    throw new ApiError(message, 500);
  }
}

// Veo3 Text-to-Video (fast)
async function veoTextToVideoFast(uid: string, payload: Parameters<typeof veoTextToVideo>[1]) {
  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  if (!payload.prompt) throw new ApiError('Prompt is required', 400);
  fal.config({ credentials: falKey });

  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: payload.prompt,
    model: 'fal-ai/veo3/fast',
    generationType: 'text-to-video',
    visibility: payload.isPublic ? 'public' : 'private',
    isPublic: payload.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
  });

  try {
    const result = await fal.subscribe('fal-ai/veo3/fast' as any, ({ input: {
      prompt: payload.prompt,
      aspect_ratio: payload.aspect_ratio ?? '16:9',
      duration: payload.duration ?? '8s',
      negative_prompt: payload.negative_prompt,
      enhance_prompt: payload.enhance_prompt ?? true,
      seed: payload.seed,
      auto_fix: payload.auto_fix ?? true,
      resolution: payload.resolution ?? '720p',
      generate_audio: payload.generate_audio ?? true,
    }, logs: true } as unknown) as any);
    const videoUrl: string | undefined = (result as any)?.data?.video?.url;
    if (!videoUrl) throw new ApiError('No video URL returned from FAL API', 502);
    const videos: VideoMedia[] = [
      { id: result.requestId || `fal-${Date.now()}`, url: videoUrl, storagePath: '', thumbUrl: undefined },
    ];

    // Score the video for aesthetic quality
    const scoredVideos = await aestheticScoreService.scoreVideos(videos);
    const highestScore = aestheticScoreService.getHighestScore(scoredVideos);

    await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos: scoredVideos, aestheticScore: highestScore } as any);
    // Sync to mirror with retries
    await syncToMirror(uid, historyId);
    return { videos: scoredVideos, historyId, model: 'fal-ai/veo3/fast', status: 'completed' };
  } catch (err: any) {
    const message = err?.message || 'Failed to generate video with FAL API';
    try {
      await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
      await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
    } catch (mirrorErr) {
      console.error('[veoTextToVideoFast] Failed to mirror error state:', mirrorErr);
    }
    throw new ApiError(message, 500);
  }
}

// Veo3 Image-to-Video (standard)
async function veoImageToVideo(uid: string, payload: {
  prompt: string;
  image_url: string;
  aspect_ratio?: 'auto' | '16:9' | '9:16';
  duration?: '4s' | '6s' | '8s';
  generate_audio?: boolean;
  resolution?: '720p' | '1080p';
  isPublic?: boolean;
}): Promise<{ videos: VideoMedia[]; historyId: string; model: string; status: 'completed' }> {
  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  if (!payload.prompt) throw new ApiError('Prompt is required', 400);
  if (!payload.image_url) throw new ApiError('image_url is required', 400);
  fal.config({ credentials: falKey });

  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: payload.prompt,
    model: 'fal-ai/veo3/image-to-video',
    generationType: 'text-to-video',
    visibility: payload.isPublic ? 'public' : 'private',
    isPublic: payload.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
  });

  try {
    const result = await fal.subscribe('fal-ai/veo3/image-to-video' as any, ({ input: {
      prompt: payload.prompt,
      image_url: payload.image_url,
      aspect_ratio: payload.aspect_ratio ?? 'auto',
      duration: payload.duration ?? '8s',
      generate_audio: payload.generate_audio ?? true,
      resolution: payload.resolution ?? '720p',
    }, logs: true } as unknown) as any);
    const videoUrl: string | undefined = (result as any)?.data?.video?.url;
    if (!videoUrl) throw new ApiError('No video URL returned from FAL API', 502);
    const videos: VideoMedia[] = [
      { id: result.requestId || `fal-${Date.now()}`, url: videoUrl, storagePath: '', thumbUrl: undefined },
    ];

    // Score the video for aesthetic quality
    const scoredVideos = await aestheticScoreService.scoreVideos(videos);
    const highestScore = aestheticScoreService.getHighestScore(scoredVideos);

    await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos: scoredVideos, aestheticScore: highestScore } as any);
    // Sync to mirror with retries
    await syncToMirror(uid, historyId);
    return { videos: scoredVideos, historyId, model: 'fal-ai/veo3/image-to-video', status: 'completed' };
  } catch (err: any) {
    const message = err?.message || 'Failed to generate video with FAL API';
    try {
      await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
      await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
    } catch (mirrorErr) {
      console.error('[veoImageToVideo] Failed to mirror error state:', mirrorErr);
    }
    throw new ApiError(message, 500);
  }
}

// Veo3 Image-to-Video (fast)
async function veoImageToVideoFast(uid: string, payload: Parameters<typeof veoImageToVideo>[1]) {
  const falKey = env.falKey as string;
  if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  if (!payload.prompt) throw new ApiError('Prompt is required', 400);
  if (!payload.image_url) throw new ApiError('image_url is required', 400);
  fal.config({ credentials: falKey });

  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: payload.prompt,
    model: 'fal-ai/veo3/fast/image-to-video',
    generationType: 'text-to-video',
    visibility: payload.isPublic ? 'public' : 'private',
    isPublic: payload.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
  });

  try {
    const result = await fal.subscribe('fal-ai/veo3/fast/image-to-video' as any, ({ input: {
      prompt: payload.prompt,
      image_url: payload.image_url,
      aspect_ratio: payload.aspect_ratio ?? 'auto',
      duration: payload.duration ?? '8s',
      generate_audio: payload.generate_audio ?? true,
      resolution: payload.resolution ?? '720p',
    }, logs: true } as unknown) as any);
    const videoUrl: string | undefined = (result as any)?.data?.video?.url;
    if (!videoUrl) throw new ApiError('No video URL returned from FAL API', 502);
    const videos: VideoMedia[] = [
      { id: result.requestId || `fal-${Date.now()}`, url: videoUrl, storagePath: '', thumbUrl: undefined },
    ];

    // Score the video for aesthetic quality
    const scoredVideos = await aestheticScoreService.scoreVideos(videos);
    const highestScore = aestheticScoreService.getHighestScore(scoredVideos);

    await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos: scoredVideos, aestheticScore: highestScore } as any);
    // Sync to mirror with retries
    await syncToMirror(uid, historyId);
    return { videos: scoredVideos, historyId, model: 'fal-ai/veo3/fast/image-to-video', status: 'completed' };
  } catch (err: any) {
    const message = err?.message || 'Failed to generate video with FAL API';
    try {
      await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
      await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
    } catch (mirrorErr) {
      console.error('[veoImageToVideoFast] Failed to mirror error state:', mirrorErr);
    }
    throw new ApiError(message, 500);
  }
}

export const falService = {
  generate,
  async briaExpandImage(uid: string, body: any): Promise<{ images: FalGeneratedImage[]; historyId: string; model: string; status: 'completed' }> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    if (!body?.image_url && !body?.image) throw new ApiError('image_url or image is required', 400);
    fal.config({ credentials: falKey });

    const model = 'fal-ai/bria/expand';
    const creator = await authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
    const promptText = typeof body?.prompt === 'string' ? String(body.prompt) : '';
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: promptText ? `Bria Expand: ${promptText}` : 'Bria Expand',
      model,
      generationType: 'image-outpaint',
      visibility: body.isPublic ? 'public' : 'private',
      isPublic: body.isPublic === true,
      createdBy,
    });

    try {
      let inputUrl: string | undefined = typeof body?.image_url === 'string' && body.image_url.length > 0 ? body.image_url : undefined;
      if (!inputUrl && typeof body?.image === 'string') {
        try {
          const username = creator?.username || uid;
          const stored = await uploadDataUriToZata({ dataUri: body.image, keyPrefix: `users/${username}/input/${historyId}`, fileName: 'bria-expand-source' });
          inputUrl = stored.publicUrl;
        } catch {}
      }
      if (!inputUrl) throw new ApiError('Unable to resolve image_url for Bria Expand', 400);

      // Normalize inputs
      const canvas = Array.isArray(body?.canvas_size) && body.canvas_size.length === 2
        ? [Number(body.canvas_size[0]), Number(body.canvas_size[1])]
        : undefined;
      const origSize = Array.isArray(body?.original_image_size) && body.original_image_size.length === 2
        ? [Number(body.original_image_size[0]), Number(body.original_image_size[1])]
        : undefined;
      const origLoc = Array.isArray(body?.original_image_location) && body.original_image_location.length === 2
        ? [Number(body.original_image_location[0]), Number(body.original_image_location[1])]
        : undefined;
      const aspect = typeof body?.aspect_ratio === 'string' && ['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9'].includes(body.aspect_ratio)
        ? body.aspect_ratio
        : undefined;

      const input: any = {
        image_url: inputUrl,
      };
      if (canvas) input.canvas_size = canvas;
      if (aspect) input.aspect_ratio = aspect;
      if (origSize) input.original_image_size = origSize;
      if (origLoc) input.original_image_location = origLoc;
      if (promptText) input.prompt = promptText;
      if (typeof body?.seed === 'number') input.seed = Math.round(Number(body.seed));
      if (typeof body?.negative_prompt === 'string') input.negative_prompt = String(body.negative_prompt);
      if (body?.sync_mode === true) input.sync_mode = true;

      console.log('[falService.briaExpandImage] Calling FAL API:', { model, input: { ...input, image_url: (input.image_url || '').slice(0,100) + '...' } });
      let result: any;
      try {
        result = await fal.subscribe(model as any, ({ input, logs: true } as unknown) as any);
      } catch (falErr: any) {
        const details = falErr?.response?.data || falErr?.message || falErr;
        console.error('[falService.briaExpandImage] FAL API error:', JSON.stringify(details, null, 2));
        throw new ApiError(`FAL API error: ${JSON.stringify(details)}`, 500);
      }

      const imgUrl: string | undefined = (result as any)?.data?.image?.url || (result as any)?.data?.output?.image?.url;
      if (!imgUrl) {
        console.error('[falService.briaExpandImage] No image in response:', JSON.stringify(result, null, 2));
        throw new ApiError('No image URL returned from FAL Bria Expand API', 502);
      }

      const username = creator?.username || uid;
      const { key, publicUrl } = await uploadFromUrlToZata({ sourceUrl: imgUrl, keyPrefix: `users/${username}/image/${historyId}`, fileName: 'bria-expand' });
  const images: FalGeneratedImage[] = [ { id: (result as any)?.requestId || `fal-${Date.now()}`, url: publicUrl, storagePath: key, originalUrl: imgUrl } as any ];

  // Score images
  const scoredImages = await aestheticScoreService.scoreImages(images as any);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);

  await generationHistoryRepository.update(uid, historyId, { status: 'completed', images: scoredImages, aestheticScore: highestScore } as any);
      
      // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
      markGenerationCompleted(uid, historyId, {
        status: "completed",
        images: images,
      }).catch(err => console.error('[FAL] Image optimization failed:', err));
      
      // Sync to mirror with retries
      await syncToMirror(uid, historyId);

  return { images: scoredImages as any, historyId, model, status: 'completed' };
    } catch (err: any) {
      const responseData = err?.response?.data;
      const detailedMessage = typeof responseData === 'string'
        ? responseData
        : responseData?.error || responseData?.message || responseData?.detail;
      const message = detailedMessage || err?.message || 'Failed to expand image with Bria API';
      try {
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
      } catch (mirrorErr) {
        console.error('[briaExpandImage] Failed to mirror error state:', mirrorErr);
      }
      throw new ApiError(message, 500);
    }
  },
  async outpaintImage(uid: string, body: any): Promise<{ images: FalGeneratedImage[]; historyId: string; model: string; status: 'completed' }> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    if (!body?.image_url && !body?.image) throw new ApiError('image_url or image is required', 400);
    fal.config({ credentials: falKey });

    const model = 'fal-ai/outpaint';
    const creator = await authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
    const promptText = typeof body?.prompt === 'string' && body.prompt.trim().length > 0 ? body.prompt.trim() : '';
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: promptText ? `Outpaint: ${promptText}` : 'Outpaint Image',
      model,
      generationType: 'image-outpaint',
      visibility: body.isPublic ? 'public' : 'private',
      isPublic: body.isPublic === true,
      createdBy,
    });

    const clampInt = (value: any, min: number, max: number, fallback: number) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return fallback;
      return Math.max(min, Math.min(max, Math.round(num)));
    };

    try {
      let resolvedUrl: string | undefined = typeof body?.image_url === 'string' && body.image_url.length > 0 ? body.image_url : undefined;
      if (!resolvedUrl && typeof body?.image === 'string' && body.image.startsWith('data:')) {
        try {
          const username = creator?.username || uid;
          const stored = await uploadDataUriToZata({ dataUri: body.image, keyPrefix: `users/${username}/input/${historyId}`, fileName: 'outpaint-source' });
          resolvedUrl = stored.publicUrl;
        } catch {
          resolvedUrl = undefined;
        }
      }
      if (!resolvedUrl) throw new ApiError('Unable to resolve image_url for outpaint', 400);

      // FAL cannot access Zata URLs due to TLS certificate issues
      // For Zata URLs, we need to download the image and upload it to a publicly accessible location
      // Since we don't have another storage service, we'll try to use FAL's file upload API
      // or re-upload to Zata and hope FAL can access it (though this may still fail)
      if (resolvedUrl && resolvedUrl.includes('idr01.zata.ai')) {
        try {
          const username = creator?.username || uid;
          // Download from Zata using our backend (bypasses TLS) and re-upload
          // This creates a new Zata URL, but FAL may still not be able to access it
          const reuploaded = await uploadFromUrlToZata({ 
            sourceUrl: resolvedUrl, 
            keyPrefix: `users/${username}/input/${historyId}`, 
            fileName: `outpaint-fal-${Date.now()}` 
          });
          resolvedUrl = reuploaded.publicUrl;
          console.log('[falService.outpaintImage] Re-uploaded image for FAL access:', resolvedUrl);
        } catch (err: any) {
          console.error('[falService.outpaintImage] Failed to re-upload image for FAL access:', err?.message || err);
          // Continue with original URL - FAL might still fail but we'll surface the error
        }
      }

      const expandLeft = clampInt(body?.expand_left, 0, 700, 0);
      const expandRight = clampInt(body?.expand_right, 0, 700, 0);
      const expandTop = clampInt(body?.expand_top, 0, 700, 0);
      const expandBottom = clampInt(body?.expand_bottom, 0, 700, 400);
      const zoomValue = Number(body?.zoom_out_percentage);
      const zoomOut = Number.isFinite(zoomValue) ? Math.max(0, Math.min(100, zoomValue)) : 20;
      const requestedImages = Number(body?.num_images ?? 1);
      const numImages = Number.isFinite(requestedImages) ? Math.max(1, Math.min(4, Math.round(requestedImages))) : 1;
      const enableSafety = body?.enable_safety_checker === false ? false : true;
      const syncMode = body?.sync_mode === true;
      const outputFormat = typeof body?.output_format === 'string' ? String(body.output_format).toLowerCase() : 'png';

      const input: any = {
        image_url: resolvedUrl,
        expand_left: expandLeft,
        expand_right: expandRight,
        expand_top: expandTop,
        expand_bottom: expandBottom,
        zoom_out_percentage: zoomOut,
        num_images: numImages,
        enable_safety_checker: enableSafety,
        sync_mode: syncMode,
        output_format: ['png', 'jpeg', 'jpg', 'webp'].includes(outputFormat) ? outputFormat : 'png',
      };
      if (promptText) input.prompt = promptText;
      if (typeof body?.aspect_ratio === 'string' && ['1:1', '16:9', '9:16', '4:3', '3:4'].includes(body.aspect_ratio)) {
        input.aspect_ratio = body.aspect_ratio;
      }

      console.log('[falService.outpaintImage] Calling FAL API:', { model, input: { ...input, image_url: input.image_url?.substring(0, 100) + '...' } });
      let result: any;
      const endpointCandidates = [model, 'fal-ai/image/outpaint', 'fal-ai/outpaint/image'];
      let lastErr: any = null;
      for (const endpoint of endpointCandidates) {
        try {
          if (endpoint !== model) {
            console.log('[falService.outpaintImage] Retrying with endpoint:', endpoint);
          }
          result = await fal.subscribe(endpoint as any, ({ input, logs: true } as unknown) as any);
          // If call succeeds, break the retry loop
          break;
        } catch (falErr: any) {
          lastErr = falErr;
          const details = falErr?.response?.data || falErr?.message || falErr;
          console.error('[falService.outpaintImage] FAL API error for', endpoint, ':', JSON.stringify(details, null, 2));
          // If explicit 404/Not Found, continue to try next candidate; else rethrow
          const msg = String(details || '').toLowerCase();
          const isNotFound = msg.includes('not found') || falErr?.response?.status === 404;
          if (!isNotFound) {
            throw new ApiError(`FAL API error: ${JSON.stringify(details)}`, 500);
          }
        }
      }
      if (!result) {
        const details = lastErr?.response?.data || lastErr?.message || lastErr;
        throw new ApiError(`FAL API error: ${JSON.stringify(details)}`, 500);
      }
      const files: any[] = Array.isArray((result as any)?.data?.images) ? (result as any).data.images : [];
      if (!files.length) {
        console.error('[falService.outpaintImage] No images in response:', JSON.stringify(result, null, 2));
        throw new ApiError('No image URL returned from FAL Outpaint API', 502);
      }

      const username = creator?.username || uid;
      const storedImages: FalGeneratedImage[] = await Promise.all(files.map(async (img, index) => {
        const sourceUrl: string | undefined = img?.url || img?.image_url;
        const fallbackId = img?.file_name || img?.id || (result as any)?.requestId || `fal-outpaint-${Date.now()}-${index}`;
        if (!sourceUrl) {
          return { id: fallbackId, url: '', originalUrl: '' } as any;
        }
        try {
          const { key, publicUrl } = await uploadFromUrlToZata({ sourceUrl, keyPrefix: `users/${username}/image/${historyId}`, fileName: `outpaint-${index + 1}` });
          return { id: fallbackId, url: publicUrl, storagePath: key, originalUrl: sourceUrl } as any;
        } catch {
          return { id: fallbackId, url: sourceUrl, originalUrl: sourceUrl } as any;
        }
      }));

      // Score images
      const scoredImages = await aestheticScoreService.scoreImages(storedImages as any);
      const highestScore = aestheticScoreService.getHighestScore(scoredImages);

      await generationHistoryRepository.update(uid, historyId, {
        status: 'completed',
        images: scoredImages,
        aestheticScore: highestScore,
        frameSize: body?.aspect_ratio,
      } as any);
      
      // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
      markGenerationCompleted(uid, historyId, {
        status: "completed",
        images: scoredImages as any,
      }).catch(err => console.error('[FAL] Image optimization failed:', err));
      
      // Sync to mirror with retries
      await syncToMirror(uid, historyId);

  return { images: scoredImages as any, historyId, model, status: 'completed' };
    } catch (err: any) {
      const responseData = err?.response?.data;
      const detailedMessage = typeof responseData === 'string'
        ? responseData
        : responseData?.error || responseData?.message || responseData?.detail;
      const message = detailedMessage || err?.message || 'Failed to outpaint image with FAL API';
      try {
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
      } catch (mirrorErr) {
        console.error('[outpaintImage] Failed to mirror error state:', mirrorErr);
      }
      throw new ApiError(message, 500);
    }
  },
  async topazUpscaleImage(uid: string, body: any): Promise<{ images: FalGeneratedImage[]; historyId: string; model: string; status: 'completed' }> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    if (!body?.image_url && !body?.image) throw new ApiError('image_url or image is required', 400);
    fal.config({ credentials: falKey });

    const model = 'fal-ai/topaz/upscale/image';
    const creator = await authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: 'Upscale Image',
      model,
      generationType: 'image-upscale',
      visibility: body.isPublic ? 'public' : 'private',
      isPublic: body.isPublic === true,
      createdBy,
    });

    try {
      // Resolve input URL: allow direct URL or data URI via temporary upload
      let resolvedUrl: string | undefined = typeof body.image_url === 'string' ? body.image_url : undefined;
      if (!resolvedUrl && typeof body.image === 'string' && /^data:/i.test(body.image)) {
        try {
          const stored = await uploadDataUriToZata({ dataUri: body.image, keyPrefix: `users/${(creator?.username || uid)}/input/${historyId}`, fileName: 'topaz-source' });
          resolvedUrl = stored.publicUrl;
        } catch {}
      }
      if (!resolvedUrl) throw new ApiError('Unable to resolve image_url for Topaz upscale', 400);

      const input: any = {
        image_url: resolvedUrl,
        upscale_factor: body.upscale_factor ?? 2,
        model: body.model || 'Standard V2',
        crop_to_fill: body.crop_to_fill ?? false,
        output_format: body.output_format || 'jpeg',
        subject_detection: body.subject_detection || 'All',
        face_enhancement: body.face_enhancement ?? true,
        face_enhancement_strength: body.face_enhancement_strength ?? 0.8,
        face_enhancement_creativity: body.face_enhancement_creativity,
      };
      const result = await fal.subscribe(model as any, ({ input, logs: true } as unknown) as any);
      const imgUrl: string | undefined = (result as any)?.data?.image?.url;
      if (!imgUrl) throw new ApiError('No image URL returned from FAL API', 502);
      const username = creator?.username || uid;
      const { key, publicUrl } = await uploadFromUrlToZata({ sourceUrl: imgUrl, keyPrefix: `users/${username}/image/${historyId}`, fileName: 'upscaled' });
  const images: FalGeneratedImage[] = [ { id: result.requestId || `fal-${Date.now()}`, url: publicUrl, storagePath: key, originalUrl: imgUrl } as any ];
  // Score images
  const scoredImages = await aestheticScoreService.scoreImages(images as any);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);
  await generationHistoryRepository.update(uid, historyId, { status: 'completed', images: scoredImages, aestheticScore: highestScore } as any);
      
      // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
      markGenerationCompleted(uid, historyId, {
        status: "completed",
        images: scoredImages as any,
      }).catch(err => console.error('[FAL] Image optimization failed:', err));
      
      // Sync to mirror with retries
      await syncToMirror(uid, historyId);
  return { images: scoredImages as any, historyId, model, status: 'completed' };
    } catch (err: any) {
      const message = err?.message || 'Failed to upscale image with FAL API';
      try {
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
      } catch (mirrorErr) {
        console.error('[topazUpscaleImage] Failed to mirror error state:', mirrorErr);
      }
      throw new ApiError(message, 500);
    }
  },
  async seedvrUpscale(uid: string, body: any): Promise<{ videos: VideoMedia[]; historyId: string; model: string; status: 'completed' }>{
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    if (!body?.video_url) throw new ApiError('video_url is required', 400);
    fal.config({ credentials: falKey });

    const model = 'fal-ai/seedvr/upscale/video';
    const creator = await authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: 'Upscale Video',
      model,
      generationType: 'video-upscale',
      visibility: body.isPublic ? 'public' : 'private',
      isPublic: body.isPublic === true,
      createdBy,
    });

    try {
      const input: any = { video_url: body.video_url };
      if (body.upscale_mode) input.upscale_mode = body.upscale_mode;
      if (body.upscale_factor != null) input.upscale_factor = body.upscale_factor;
      if (body.target_resolution) input.target_resolution = body.target_resolution;
      if (body.noise_scale != null) input.noise_scale = body.noise_scale;
      if (body.output_format) input.output_format = body.output_format;
      if (body.output_quality) input.output_quality = body.output_quality;
      if (body.output_write_mode) input.output_write_mode = body.output_write_mode;
      if (body.seed != null) input.seed = body.seed;
      
      console.log('[seedvrUpscale] Calling FAL API with input:', { ...input, video_url: input.video_url?.substring(0, 100) + '...' });
      
      let result: any;
      try {
        result = await fal.subscribe(model as any, ({ input, logs: true } as unknown) as any);
      } catch (falErr: any) {
        const errorDetails = falErr?.response?.data || falErr?.message || falErr;
        console.error('[seedvrUpscale] FAL API error:', JSON.stringify(errorDetails, null, 2));
        const errorMessage = typeof errorDetails === 'string' 
          ? errorDetails 
          : errorDetails?.error || errorDetails?.message || errorDetails?.detail || 'FAL API request failed';
        throw new ApiError(`FAL API error: ${errorMessage}`, 502);
      }
      
      const videoUrl: string | undefined = (result as any)?.data?.video?.url || (result as any)?.data?.video_url || (result as any)?.data?.output?.video?.url;
      if (!videoUrl) {
        console.error('[seedvrUpscale] No video URL in response:', JSON.stringify(result, null, 2));
        throw new ApiError('No video URL returned from FAL API', 502);
      }
      const username = creator?.username || uid;
      const keyPrefix = `users/${username}/video/${historyId}`;
      let stored: any;
      try {
        stored = await uploadFromUrlToZata({ sourceUrl: videoUrl, keyPrefix, fileName: 'upscaled' });
      } catch {
        stored = { publicUrl: videoUrl, key: '' };
      }
      const videos: VideoMedia[] = [ { id: result.requestId || `fal-${Date.now()}`, url: stored.publicUrl, storagePath: stored.key, originalUrl: videoUrl } as any ];
  // Score video
  const scoredVideos = await aestheticScoreService.scoreVideos(videos as any);
  const highestScore = aestheticScoreService.getHighestScore(scoredVideos);
  await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos: scoredVideos, aestheticScore: highestScore } as any);
      // Sync to mirror with retries
      await syncToMirror(uid, historyId);
  return { videos: scoredVideos as any, historyId, model, status: 'completed' };
    } catch (err: any) {
      const message = err?.message || 'Failed to upscale video with FAL API';
      try {
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
      } catch (mirrorErr) {
        console.error('[seedvrUpscale] Failed to mirror error state:', mirrorErr);
      }
      throw new ApiError(message, 500);
    }
  },
  async image2svg(uid: string, body: any): Promise<{ images: FalGeneratedImage[]; historyId: string; model: string; status: 'completed' }>{
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    if (!(body?.image_url) && !(body?.image)) throw new ApiError('image_url or image is required', 400);
    fal.config({ credentials: falKey });

    const model = 'fal-ai/image2svg';
    const creator = await authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: 'Convert to SVG',
      model,
      generationType: 'image-to-svg',
      visibility: body.isPublic ? 'public' : 'private',
      isPublic: body.isPublic === true,
      createdBy,
    });

    try {
      // Resolve input URL: accept direct URL or upload data URI to Zata
      let inputUrl: string | undefined = typeof body?.image_url === 'string' ? body.image_url : undefined;
      if (!inputUrl && typeof body?.image === 'string') {
        try {
          const username = creator?.username || uid;
          const stored = await uploadDataUriToZata({ dataUri: body.image, keyPrefix: `users/${username}/input/${historyId}`, fileName: 'vectorize-source' });
          inputUrl = stored.publicUrl;
        } catch {
          inputUrl = undefined;
        }
      }
      if (!inputUrl) throw new ApiError('Unable to resolve image_url for image2svg', 400);

      const result = await fal.subscribe(model as any, ({ input: {
        image_url: inputUrl,
        colormode: body.colormode ?? 'color',
        hierarchical: body.hierarchical ?? 'stacked',
        mode: body.mode ?? 'spline',
        filter_speckle: body.filter_speckle ?? 4,
        color_precision: body.color_precision ?? 6,
        layer_difference: body.layer_difference ?? 16,
        corner_threshold: body.corner_threshold ?? 60,
        length_threshold: body.length_threshold ?? 4,
        max_iterations: body.max_iterations ?? 10,
        splice_threshold: body.splice_threshold ?? 45,
        path_precision: body.path_precision ?? 3,
      }, logs: true } as unknown) as any);

      const files: any[] = Array.isArray((result as any)?.data?.images) ? (result as any).data.images : [];
      const svgUrl = files[0]?.url as string | undefined;
      if (!svgUrl) throw new ApiError('No SVG URL returned from FAL API', 502);

      const username = creator?.username || uid;
      let stored: any;
      try {
        stored = await uploadFromUrlToZata({ sourceUrl: svgUrl, keyPrefix: `users/${username}/image/${historyId}`, fileName: 'vectorized' });
      } catch {
        stored = { publicUrl: svgUrl, key: '' };
      }
      const images: FalGeneratedImage[] = [ { id: result.requestId || `fal-${Date.now()}`, url: stored.publicUrl, originalUrl: svgUrl } as any ];
      
      // Save input image to history (similar to upscale)
      let inputImages: any[] = [];
      try {
        // If inputUrl is external, upload it to Zata for consistency
        if (inputUrl && !inputUrl.includes(`users/${username}/input/${historyId}`)) {
          try {
            const inputStored = await uploadFromUrlToZata({ sourceUrl: inputUrl, keyPrefix: `users/${username}/input/${historyId}`, fileName: 'vectorize-input' });
            inputImages = [{ id: 'in-1', url: inputStored.publicUrl, storagePath: inputStored.key, originalUrl: inputUrl }];
          } catch {
            // If upload fails, use the original URL
            inputImages = [{ id: 'in-1', url: inputUrl, originalUrl: inputUrl }];
          }
        } else if (inputUrl) {
          // Input already in Zata (from data URI upload above)
          inputImages = [{ id: 'in-1', url: inputUrl, originalUrl: inputUrl }];
        }
      } catch (err) {
        console.error('[image2svg] Failed to save input image:', err);
      }
      
      // Preserve inputImages if they were already saved (don't overwrite them)
      const existing = await generationHistoryRepository.get(uid, historyId);
      const updateData: any = {
        status: 'completed',
        images,
      };
      // Add inputImages if we have them
      if (inputImages.length > 0) {
        updateData.inputImages = inputImages;
      }
      // Preserve existing inputImages if they exist
      if (existing && Array.isArray((existing as any).inputImages) && (existing as any).inputImages.length > 0 && inputImages.length === 0) {
        updateData.inputImages = (existing as any).inputImages;
      }
      
      await generationHistoryRepository.update(uid, historyId, updateData);
      
      // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
      markGenerationCompleted(uid, historyId, {
        status: "completed",
        images: images as any,
      }).catch(err => console.error('[FAL] Image optimization failed:', err));
      
      // Sync to mirror with retries
      await syncToMirror(uid, historyId);
      return { images, historyId, model, status: 'completed' };
    } catch (err: any) {
      const message = err?.message || 'Failed to convert image to SVG with FAL API';
      try {
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
      } catch (mirrorErr) {
        console.error('[image2svg] Failed to mirror error state:', mirrorErr);
      }
      throw new ApiError(message, 500);
    }
  },
  async recraftVectorize(uid: string, body: any): Promise<{ images: FalGeneratedImage[]; historyId: string; model: string; status: 'completed' }>{
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    if (!(body?.image_url) && !(body?.image)) throw new ApiError('image_url or image is required', 400);
    fal.config({ credentials: falKey });

    const model = 'fal-ai/recraft/vectorize';
    const creator = await authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: 'Vectorize Image',
      model,
      generationType: 'image-to-svg',
      visibility: body.isPublic ? 'public' : 'private',
      isPublic: body.isPublic === true,
      createdBy,
    });

    try {
      // Resolve input URL: accept direct URL, or upload data URI / raw image string to Zata
      let inputUrl: string | undefined = typeof body?.image_url === 'string' ? body.image_url : undefined;
      if (!inputUrl && typeof body?.image === 'string') {
        const imageStr: string = body.image;
        if (/^data:/i.test(imageStr)) {
          try {
            const username = creator?.username || uid;
            const stored = await uploadDataUriToZata({ dataUri: imageStr, keyPrefix: `users/${username}/input/${historyId}` , fileName: 'vectorize-source' });
            inputUrl = stored.publicUrl;
          } catch {
            inputUrl = undefined;
          }
        } else if (/^https?:\/\//i.test(imageStr)) {
          inputUrl = imageStr;
        }
      }
      if (!inputUrl) throw new ApiError('Unable to resolve image_url for vectorize', 400);

      const result = await fal.subscribe(model as any, ({ input: { image_url: inputUrl }, logs: true } as unknown) as any);
      const svgUrl: string | undefined = (result as any)?.data?.image?.url;
      if (!svgUrl) throw new ApiError('No SVG URL returned from FAL API', 502);

      const username = creator?.username || uid;
      let stored: any;
      try { stored = await uploadFromUrlToZata({ sourceUrl: svgUrl, keyPrefix: `users/${username}/image/${historyId}`, fileName: 'vectorized' }); }
      catch { stored = { publicUrl: svgUrl, key: '' }; }
      const images: FalGeneratedImage[] = [ { id: result.requestId || `fal-${Date.now()}`, url: stored.publicUrl, originalUrl: svgUrl } as any ];
      
      // Save input image to history (similar to upscale)
      let inputImages: any[] = [];
      try {
        // If inputUrl is external, upload it to Zata for consistency
        if (inputUrl && !inputUrl.includes(`users/${username}/input/${historyId}`)) {
          try {
            const inputStored = await uploadFromUrlToZata({ sourceUrl: inputUrl, keyPrefix: `users/${username}/input/${historyId}`, fileName: 'vectorize-input' });
            inputImages = [{ id: 'in-1', url: inputStored.publicUrl, storagePath: inputStored.key, originalUrl: inputUrl }];
          } catch {
            // If upload fails, use the original URL
            inputImages = [{ id: 'in-1', url: inputUrl, originalUrl: inputUrl }];
          }
        } else if (inputUrl) {
          // Input already in Zata (from data URI upload above)
          inputImages = [{ id: 'in-1', url: inputUrl, originalUrl: inputUrl }];
        }
      } catch (err) {
        console.error('[recraftVectorize] Failed to save input image:', err);
      }
      
      // Preserve inputImages if they were already saved (don't overwrite them)
      const existing = await generationHistoryRepository.get(uid, historyId);
      const updateData: any = {
        status: 'completed',
        images,
      };
      // Add inputImages if we have them
      if (inputImages.length > 0) {
        updateData.inputImages = inputImages;
      }
      // Preserve existing inputImages if they exist
      if (existing && Array.isArray((existing as any).inputImages) && (existing as any).inputImages.length > 0 && inputImages.length === 0) {
        updateData.inputImages = (existing as any).inputImages;
      }
      
      await generationHistoryRepository.update(uid, historyId, updateData);
      
      // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
      markGenerationCompleted(uid, historyId, {
        status: "completed",
        images: images as any,
      }).catch(err => console.error('[FAL] Image optimization failed:', err));
      
      // Sync to mirror with retries
      await syncToMirror(uid, historyId);
      return { images, historyId, model, status: 'completed' };
    } catch (err: any) {
      const message = err?.message || 'Failed to vectorize image with FAL API';
      try {
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
      } catch (mirrorErr) {
        console.error('[recraftVectorize] Failed to mirror error state:', mirrorErr);
      }
      throw new ApiError(message, 500);
    }
  },
  async briaGenfill(uid: string, body: any): Promise<{ images: FalGeneratedImage[]; historyId: string; model: string; status: 'completed' }> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    if (!body?.image_url && !body?.image) throw new ApiError('image_url or image is required', 400);
    if (!body?.mask_url && !body?.mask) throw new ApiError('mask_url or mask is required', 400);
    if (!body?.prompt) throw new ApiError('prompt is required', 400);
    fal.config({ credentials: falKey });

    const model = 'fal-ai/bria/genfill';
    const creator = await authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
    const promptText = typeof body?.prompt === 'string' ? String(body.prompt) : '';
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: promptText ? `Bria GenFill: ${promptText}` : 'Bria GenFill',
      model,
      generationType: 'image-edit',
      visibility: body.isPublic ? 'public' : 'private',
      isPublic: body.isPublic === true,
      createdBy,
    });

    try {
      // Resolve image URL
      let imageUrl: string | undefined = typeof body?.image_url === 'string' && body.image_url.length > 0 ? body.image_url : undefined;
      if (!imageUrl && typeof body?.image === 'string') {
        try {
          const username = creator?.username || uid;
          const stored = await uploadDataUriToZata({ dataUri: body.image, keyPrefix: `users/${username}/input/${historyId}`, fileName: 'genfill-source' });
          imageUrl = stored.publicUrl;
        } catch {}
      }
      if (!imageUrl) throw new ApiError('Unable to resolve image_url for Bria GenFill', 400);

      // Resolve mask URL
      let maskUrl: string | undefined = typeof body?.mask_url === 'string' && body.mask_url.length > 0 ? body.mask_url : undefined;
      if (!maskUrl && typeof body?.mask === 'string') {
        try {
          const username = creator?.username || uid;
          const stored = await uploadDataUriToZata({ dataUri: body.mask, keyPrefix: `users/${username}/input/${historyId}`, fileName: 'genfill-mask' });
          maskUrl = stored.publicUrl;
        } catch {}
      }
      if (!maskUrl) throw new ApiError('Unable to resolve mask_url for Bria GenFill', 400);

      const input: any = {
        image_url: imageUrl,
        mask_url: maskUrl,
        prompt: promptText,
      };
      if (typeof body?.negative_prompt === 'string' && body.negative_prompt.trim()) {
        input.negative_prompt = String(body.negative_prompt).trim();
      }
      if (typeof body?.seed === 'number') input.seed = Math.round(Number(body.seed));
      const numImages = Number(body?.num_images ?? 1);
      if (Number.isFinite(numImages) && numImages >= 1 && numImages <= 4) {
        input.num_images = Math.round(numImages);
      }
      if (body?.sync_mode === true) input.sync_mode = true;

      console.log('[falService.briaGenfill] Calling FAL API:', { model, input: { ...input, image_url: (input.image_url || '').slice(0,100) + '...', mask_url: (input.mask_url || '').slice(0,100) + '...' } });
      let result: any;
      try {
        result = await fal.subscribe(model as any, ({ input, logs: true } as unknown) as any);
      } catch (falErr: any) {
        const details = falErr?.response?.data || falErr?.message || falErr;
        console.error('[falService.briaGenfill] FAL API error:', JSON.stringify(details, null, 2));
        throw new ApiError(`FAL API error: ${JSON.stringify(details)}`, 500);
      }

      const imagesArray: any[] = Array.isArray((result as any)?.data?.images) ? (result as any).data.images : [];
      if (!imagesArray.length) {
        console.error('[falService.briaGenfill] No images in response:', JSON.stringify(result, null, 2));
        throw new ApiError('No images returned from FAL Bria GenFill API', 502);
      }

      const username = creator?.username || uid;
      const storedImages: FalGeneratedImage[] = await Promise.all(imagesArray.map(async (img, index) => {
        const sourceUrl: string | undefined = img?.url;
        const fallbackId = img?.file_name || img?.id || (result as any)?.requestId || `fal-genfill-${Date.now()}-${index}`;
        if (!sourceUrl) {
          return { id: fallbackId, url: '', originalUrl: '' } as any;
        }
        try {
          const { key, publicUrl } = await uploadFromUrlToZata({ sourceUrl, keyPrefix: `users/${username}/image/${historyId}`, fileName: `genfill-${index + 1}` });
          return { id: fallbackId, url: publicUrl, storagePath: key, originalUrl: sourceUrl } as any;
        } catch {
          return { id: fallbackId, url: sourceUrl, originalUrl: sourceUrl } as any;
        }
      }));

  // Score images
  const scoredImages = await aestheticScoreService.scoreImages(storedImages as any);
  const highestScore = aestheticScoreService.getHighestScore(scoredImages);
  await generationHistoryRepository.update(uid, historyId, { status: 'completed', images: scoredImages, aestheticScore: highestScore } as any);
      
      // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
      markGenerationCompleted(uid, historyId, {
        status: "completed",
        images: scoredImages as any,
      }).catch(err => console.error('[FAL] Image optimization failed:', err));
      
      // Sync to mirror with retries
      await syncToMirror(uid, historyId);

  return { images: scoredImages as any, historyId, model, status: 'completed' };
    } catch (err: any) {
      const responseData = err?.response?.data;
      const detailedMessage = typeof responseData === 'string'
        ? responseData
        : responseData?.error || responseData?.message || responseData?.detail;
      const message = detailedMessage || err?.message || 'Failed to generate with Bria GenFill API';
      try {
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
      } catch (mirrorErr) {
        console.error('[briaGenfill] Failed to mirror error state:', mirrorErr);
      }
      throw new ApiError(message, 500);
    }
  },
  async birefnetVideo(uid: string, body: any): Promise<{ videos: VideoMedia[]; historyId: string; model: string; status: 'completed' }>{
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    if (!body?.video_url) throw new ApiError('video_url is required', 400);
    fal.config({ credentials: falKey });
    const model = 'fal-ai/birefnet/v2/video';
    const creator = await authRepository.getUserById(uid);
    const createdBy = { uid, username: creator?.username, email: (creator as any)?.email };
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt: 'Remove Background (Video)',
      model,
      generationType: 'video-remove-bg',
      visibility: body.isPublic ? 'public' : 'private',
      isPublic: body.isPublic === true,
      createdBy,
    });
    try {
      const input: any = { video_url: body.video_url };
      if (body.model) input.model = body.model;
      if (body.operating_resolution) input.operating_resolution = body.operating_resolution;
      if (typeof body.output_mask === 'boolean') input.output_mask = body.output_mask;
      if (typeof body.refine_foreground === 'boolean') input.refine_foreground = body.refine_foreground;
      if (body.sync_mode === true) input.sync_mode = true;
      if (body.video_output_type) input.video_output_type = body.video_output_type;
      if (body.video_quality) input.video_quality = body.video_quality;
      if (body.video_write_mode) input.video_write_mode = body.video_write_mode;
      let result: any;
      try {
        result = await fal.subscribe(model as any, ({ input, logs: true } as unknown) as any);
      } catch (falErr: any) {
        const details = falErr?.response?.data || falErr?.message || falErr;
        console.error('[birefnetVideo] FAL API error:', JSON.stringify(details, null, 2));
        throw new ApiError(`FAL API error: ${JSON.stringify(details)}`, 502);
      }
      const videoUrl: string | undefined = (result as any)?.data?.video?.url || (result as any)?.data?.video_url;
      if (!videoUrl) {
        console.error('[birefnetVideo] No video URL in response:', JSON.stringify(result, null, 2));
        throw new ApiError('No video URL returned from FAL API', 502);
      }
      const username = creator?.username || uid;
      const keyPrefix = `users/${username}/video/${historyId}`;
      let stored: any;
      try {
        stored = await uploadFromUrlToZata({ sourceUrl: videoUrl, keyPrefix, fileName: 'remove-bg' });
      } catch {
        stored = { publicUrl: videoUrl, key: '' };
      }
      const videos: VideoMedia[] = [ { id: result.requestId || `fal-${Date.now()}`, url: stored.publicUrl, storagePath: stored.key, originalUrl: videoUrl } as any ];
  // Score video
  const scoredVideos = await aestheticScoreService.scoreVideos(videos as any);
  const highestScore = aestheticScoreService.getHighestScore(scoredVideos);
  await generationHistoryRepository.update(uid, historyId, { status: 'completed', videos: scoredVideos, aestheticScore: highestScore } as any);
      await syncToMirror(uid, historyId);
  return { videos: scoredVideos as any, historyId, model, status: 'completed' };
    } catch (err: any) {
      const message = err?.message || 'Failed to remove background from video with FAL API';
      try {
        await generationHistoryRepository.update(uid, historyId, { status: 'failed', error: message } as any);
        await updateMirror(uid, historyId, { status: 'failed' as any, error: message });
      } catch (mirrorErr) {
        console.error('[birefnetVideo] Failed to mirror error state:', mirrorErr);
      }
      throw new ApiError(message, 500);
    }
  }
};

// Queue-oriented API
type SubmitReturn = { requestId: string; historyId: string; model: string; status: 'submitted' };

async function queueCreateHistory(uid: string, data: { prompt: string; model: string; isPublic?: boolean }) {
  const creator = await authRepository.getUserById(uid);
  const { historyId } = await generationHistoryRepository.create(uid, {
    prompt: data.prompt,
    model: data.model,
    generationType: 'text-to-video',
    visibility: data.isPublic ? 'public' : 'private',
    isPublic: data.isPublic ?? false,
    createdBy: creator ? { uid, username: creator.username, email: creator.email } : { uid },
  });
  return { historyId, creator };
}

async function veoTtvSubmit(uid: string, body: any, fast = false): Promise<SubmitReturn> {
  const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  fal.config({ credentials: falKey });
  if (!body?.prompt) throw new ApiError('Prompt is required', 400);
  const model = fast ? 'fal-ai/veo3/fast' : 'fal-ai/veo3';
  const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
  const { request_id } = await fal.queue.submit(model, {
    input: {
      prompt: body.prompt,
      aspect_ratio: body.aspect_ratio ?? '16:9',
      duration: body.duration ?? '8s',
      negative_prompt: body.negative_prompt,
      enhance_prompt: body.enhance_prompt ?? true,
      seed: body.seed,
      auto_fix: body.auto_fix ?? true,
      resolution: body.resolution ?? '720p',
      generate_audio: body.generate_audio ?? true,
    },
  } as any);
  await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id } as any);
  return { requestId: request_id, historyId, model, status: 'submitted' };
}

async function veoI2vSubmit(uid: string, body: any, fast = false): Promise<SubmitReturn> {
  const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  fal.config({ credentials: falKey });
  if (!body?.prompt) throw new ApiError('Prompt is required', 400);
  if (!body?.image_url) throw new ApiError('image_url is required', 400);
  const model = fast ? 'fal-ai/veo3/fast/image-to-video' : 'fal-ai/veo3/image-to-video';
  const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
  const { request_id } = await fal.queue.submit(model, {
    input: {
      prompt: body.prompt,
      image_url: body.image_url,
      aspect_ratio: body.aspect_ratio ?? 'auto',
      duration: body.duration ?? '8s',
      generate_audio: body.generate_audio ?? true,
      resolution: body.resolution ?? '720p',
    },
  } as any);
  await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id } as any);
  return { requestId: request_id, historyId, model, status: 'submitted' };
}

async function queueStatus(uid: string, model: string | undefined, requestId: string): Promise<any> {
  const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  fal.config({ credentials: falKey });
  
  // If model is not provided, look it up from generation history
  let resolvedModel = model;
  if (!resolvedModel && requestId) {
    try {
      const located = await generationHistoryRepository.findByProviderTaskId(uid, 'fal', requestId);
      if (located?.item?.model) {
        resolvedModel = located.item.model;
      }
    } catch (e) {
      console.warn('[queueStatus] Failed to lookup model from history', e);
    }
  }
  
  if (!resolvedModel) {
    throw new ApiError('Model is required. Either provide it in the request or ensure the requestId exists in generation history.', 400);
  }
  
  const status = await fal.queue.status(resolvedModel, { requestId, logs: true } as any);
  return status;
}

async function queueResult(uid: string, model: string | undefined, requestId: string): Promise<any> {
  const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
  fal.config({ credentials: falKey });
  
  // If model is not provided, look it up from generation history
  let resolvedModel = model;
  if (!resolvedModel && requestId) {
    try {
      const located = await generationHistoryRepository.findByProviderTaskId(uid, 'fal', requestId);
      if (located?.item?.model) {
        resolvedModel = located.item.model;
      }
    } catch (e) {
      console.warn('[queueResult] Failed to lookup model from history', e);
    }
  }
  
  if (!resolvedModel) {
    throw new ApiError('Model is required. Either provide it in the request or ensure the requestId exists in generation history.', 400);
  }
  
  const result = await fal.queue.result(resolvedModel, { requestId } as any);
  const located = await generationHistoryRepository.findByProviderTaskId(uid, 'fal', requestId);
  if (result?.data?.video?.url && located) {
    const providerUrl: string = result.data.video.url as string;
    const providerVideoId: string | undefined = (result as any)?.data?.video_id || (result as any)?.data?.videoId;
    let videos: VideoMedia[] = [];
    try {
      const username = (await authRepository.getUserById(uid))?.username || uid;
      const keyPrefix = `users/${username}/video/${located.id}`;
      const uploaded = await uploadFromUrlToZata({
        sourceUrl: providerUrl,
        keyPrefix,
        fileName: 'video-1',
      });
      const videoObj: any = { id: requestId, url: uploaded.publicUrl, storagePath: uploaded.key, originalUrl: providerUrl };
      if (providerVideoId) videoObj.soraVideoId = providerVideoId;
      videos = [ videoObj as any ];
      await generationHistoryRepository.update(uid, located.id, { status: 'completed', videos: [ videoObj ] as any, ...(providerVideoId ? { soraVideoId: providerVideoId } : {}) } as any);
    } catch (e) {
      // Fallback to provider URL if Zata upload fails
      const videoObj: any = { id: requestId, url: providerUrl, storagePath: '', originalUrl: providerUrl };
      if (providerVideoId) videoObj.soraVideoId = providerVideoId;
      videos = [ videoObj as any ];
      await generationHistoryRepository.update(uid, located.id, { status: 'completed', videos: [ videoObj ] as any, ...(providerVideoId ? { soraVideoId: providerVideoId } : {}) } as any);
    }
    const fresh = await generationHistoryRepository.get(uid, located.id);
    if (fresh) {
      // Sync to mirror with retries
      await syncToMirror(uid, located.id);
    }
    // Build enriched response with Zata and original URLs
    const enrichedVideos = (fresh?.videos && Array.isArray(fresh.videos) ? fresh.videos : videos).map((v: any) => ({
      id: v.id,
      url: v.url,
      storagePath: v.storagePath,
      originalUrl: v.originalUrl || providerUrl,
    }));
    try {
      const { cost, pricingVersion, meta } = computeFalVeoCostFromModel(resolvedModel, (located as any)?.item);
      await creditsRepository.writeDebitIfAbsent(uid, located.id, cost, 'fal.queue.veo', { ...meta, historyId: located.id, provider: 'fal', pricingVersion });
    } catch {}
    return { videos: enrichedVideos, historyId: located.id, model: resolvedModel, requestId, status: 'completed' } as any;
  }
  // Handle image outputs (T2I/I2I)
  if (located && (result?.data?.images?.length || result?.data?.image?.url)) {
    const username = (await authRepository.getUserById(uid))?.username || uid;
    const keyPrefix = `users/${username}/image/${located.id}`;
    const providerImages: { url: string }[] = Array.isArray(result?.data?.images)
      ? (result.data.images as any[])
      : result?.data?.image?.url
        ? [{ url: result.data.image.url as string }]
        : [];
    const stored = await Promise.all(providerImages.map(async (img, index) => {
      try {
        const up = await uploadFromUrlToZata({ sourceUrl: img.url, keyPrefix, fileName: buildGenerationImageFileName(located?.id, index) });
        return { id: `${requestId}-${index+1}`, url: up.publicUrl, storagePath: up.key, originalUrl: img.url } as any;
      } catch {
        return { id: `${requestId}-${index+1}`, url: img.url, originalUrl: img.url } as any;
      }
    }));
    await generationHistoryRepository.update(uid, located.id, { status: 'completed', images: stored } as any);
    try {
      const { cost, pricingVersion, meta } = computeFalVeoCostFromModel(resolvedModel, (located as any)?.item);
      await creditsRepository.writeDebitIfAbsent(uid, located.id, cost, 'fal.queue.image', { ...meta, historyId: located.id, provider: 'fal', pricingVersion });
    } catch {}
    
    // Trigger image optimization (thumbnails, AVIF, blur placeholders) in background
    markGenerationCompleted(uid, located.id, {
      status: "completed",
      images: stored,
    }).catch(err => console.error('[FAL] Image optimization failed:', err));
    
    // Sync to mirror with retries
    await syncToMirror(uid, located.id);
    return { images: stored, historyId: located.id, model: resolvedModel, requestId, status: 'completed' } as any;
  }
  return result;
}

export const falQueueService = {
  veoTtvSubmit,
  veoI2vSubmit,
  // Veo 3.1 variants
  async veo31TtvSubmit(uid: string, body: any, fast = false): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    const model = fast ? 'fal-ai/veo3.1/fast' : 'fal-ai/veo3.1';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        aspect_ratio: body.aspect_ratio ?? '16:9',
        duration: body.duration ?? '8s',
        negative_prompt: body.negative_prompt,
        enhance_prompt: body.enhance_prompt ?? true,
        seed: body.seed,
        auto_fix: body.auto_fix ?? true,
        resolution: body.resolution ?? '720p',
        generate_audio: body.generate_audio ?? true,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id, generate_audio: body.generate_audio ?? true } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  async veo31I2vSubmit(uid: string, body: any, fast = false): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!body?.image_url) throw new ApiError('image_url is required', 400);
    const model = fast ? 'fal-ai/veo3.1/fast/image-to-video' : 'fal-ai/veo3.1/image-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        image_url: body.image_url,
        aspect_ratio: body.aspect_ratio ?? 'auto',
        duration: body.duration ?? '8s',
        generate_audio: body.generate_audio ?? true,
        resolution: body.resolution ?? '720p',
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id, generate_audio: body.generate_audio ?? true } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  async veo31ReferenceToVideoSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!Array.isArray(body?.image_urls) || body.image_urls.length === 0) throw new ApiError('image_urls is required and must contain at least one URL', 400);
    const model = 'fal-ai/veo3.1/reference-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        image_urls: body.image_urls,
        duration: body.duration ?? '8s',
        resolution: body.resolution ?? '720p',
        generate_audio: body.generate_audio ?? true,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id, generate_audio: body.generate_audio ?? true } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  async veo31FirstLastFastSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!body?.start_image_url) throw new ApiError('start_image_url is required', 400);
    if (!body?.last_frame_image_url) throw new ApiError('last_frame_image_url is required', 400);
    const model = 'fal-ai/veo3.1/fast/image-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        image_url: body.start_image_url,
        last_frame_image_url: body.last_frame_image_url,
        aspect_ratio: body.aspect_ratio ?? 'auto',
        duration: body.duration ?? '8s',
        generate_audio: body.generate_audio ?? true,
        resolution: body.resolution ?? '720p',
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id, generate_audio: body.generate_audio ?? true } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  async veo31FirstLastSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    const firstUrl = body.first_frame_url || body.start_image_url;
    const lastUrl = body.last_frame_url || body.last_frame_image_url;
    if (!firstUrl) throw new ApiError('first_frame_url is required', 400);
    if (!lastUrl) throw new ApiError('last_frame_url is required', 400);
    const model = 'fal-ai/veo3.1/first-last-frame-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        first_frame_url: firstUrl,
        last_frame_url: lastUrl,
        aspect_ratio: body.aspect_ratio ?? 'auto',
        duration: body.duration ?? '8s',
        generate_audio: body.generate_audio ?? true,
        resolution: body.resolution ?? '720p',
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id, generate_audio: body.generate_audio ?? true } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // Sora 2 - Image to Video (standard)
  async sora2I2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!body?.image_url) throw new ApiError('image_url is required', 400);
    const model = 'fal-ai/sora-2/image-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    
    // Normalize duration to ensure it's a number and valid (4, 8, or 12)
    let duration = body.duration ?? 8;
    if (typeof duration !== 'number') {
      duration = parseInt(String(duration), 10) || 8;
    }
    // Clamp to valid values
    if (![4, 8, 12].includes(duration)) {
      if (duration < 6) duration = 4;
      else if (duration < 10) duration = 8;
      else duration = 12;
    }
    
    // Normalize resolution - Standard only supports 'auto' or '720p'
    let resolution = body.resolution ?? 'auto';
    if (resolution !== 'auto' && resolution !== '720p') {
      resolution = 'auto';
    }
    
    // Normalize aspect_ratio
    let aspect_ratio = body.aspect_ratio ?? 'auto';
    if (!['auto', '16:9', '9:16'].includes(aspect_ratio)) {
      aspect_ratio = 'auto';
    }
    
    const input: any = {
      prompt: body.prompt,
      image_url: body.image_url,
      resolution,
      aspect_ratio,
      duration,
    };
    
    // Only include api_key if provided
    if (body.api_key) {
      input.api_key = body.api_key;
    }
    
    console.log('[sora2I2vSubmit] Submitting to FAL:', { model, input: { ...input, image_url: input.image_url?.substring(0, 100) + '...' } });
    
    const { request_id } = await fal.queue.submit(model, { input } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      // persist normalized params for final debit mapping
      duration,
      resolution,
      aspect_ratio,
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // Sora 2 - Image to Video (Pro)
  async sora2ProI2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!body?.image_url) throw new ApiError('image_url is required', 400);
    const model = 'fal-ai/sora-2/image-to-video/pro';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    
    // Normalize duration to ensure it's a number and valid (4, 8, or 12)
    let duration = body.duration ?? 8;
    if (typeof duration !== 'number') {
      duration = parseInt(String(duration), 10) || 8;
    }
    // Clamp to valid values
    if (![4, 8, 12].includes(duration)) {
      if (duration < 6) duration = 4;
      else if (duration < 10) duration = 8;
      else duration = 12;
    }
    
    // Normalize resolution - Pro supports 'auto', '720p', or '1080p'
    let resolution = body.resolution ?? 'auto';
    if (!['auto', '720p', '1080p'].includes(resolution)) {
      resolution = 'auto';
    }
    
    // Normalize aspect_ratio
    let aspect_ratio = body.aspect_ratio ?? 'auto';
    if (!['auto', '16:9', '9:16'].includes(aspect_ratio)) {
      aspect_ratio = 'auto';
    }
    
    const input: any = {
      prompt: body.prompt,
      image_url: body.image_url,
      resolution,
      aspect_ratio,
      duration,
    };
    
    // Only include api_key if provided
    if (body.api_key) {
      input.api_key = body.api_key;
    }
    
    console.log('[sora2ProI2vSubmit] Submitting to FAL:', { model, input: { ...input, image_url: input.image_url?.substring(0, 100) + '...' } });
    
    const { request_id } = await fal.queue.submit(model, { input } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      // persist normalized params for final debit mapping
      duration,
      resolution,
      aspect_ratio,
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // Sora 2 - Video to Video Remix
  async sora2RemixV2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    let videoId = body.video_id as string | undefined;
    // If caller passed a source history id, load its stored soraVideoId
    if (!videoId && body?.source_history_id) {
      const src = await generationHistoryRepository.get(uid, String(body.source_history_id));
      const stored = (src as any)?.soraVideoId || (Array.isArray((src as any)?.videos) && (src as any)?.videos[0]?.soraVideoId);
      if (stored) videoId = stored;
    }
    if (!videoId) throw new ApiError('video_id or source_history_id (with stored soraVideoId) is required', 400);
    const model = 'fal-ai/sora-2/video-to-video/remix';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    // Persist source meta used for final debit mapping if available
    if (body?.source_history_id) {
      try {
        const src = await generationHistoryRepository.get(uid, String(body.source_history_id));
        if (src) {
          const source_duration = (src as any)?.duration ?? undefined;
          const source_resolution = (src as any)?.resolution ?? undefined;
          const source_is_pro = String((src as any)?.model || '').toLowerCase().includes('/pro') || String(source_resolution || '').toLowerCase() === '1080p';
          await generationHistoryRepository.update(uid, historyId, { source_history_id: String(body.source_history_id), source_duration, source_resolution, source_is_pro: String(!!source_is_pro) } as any);
        }
      } catch {}
    }
    const { request_id } = await fal.queue.submit(model, {
      input: {
        api_key: body.api_key,
        video_id: videoId,
        prompt: body.prompt,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, { provider: 'fal', providerTaskId: request_id } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // Sora 2 - Text to Video (Standard)
  async sora2T2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    const model = 'fal-ai/sora-2/text-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    
    // Normalize duration to ensure it's a number and valid (4, 8, or 12)
    let duration = body.duration ?? 8;
    if (typeof duration !== 'number') {
      duration = parseInt(String(duration), 10) || 8;
    }
    // Clamp to valid values
    if (![4, 8, 12].includes(duration)) {
      if (duration < 6) duration = 4;
      else if (duration < 10) duration = 8;
      else duration = 12;
    }
    
    // Normalize resolution - Standard only supports '720p'
    let resolution = body.resolution ?? '720p';
    if (resolution !== '720p') {
      resolution = '720p';
    }
    
    // Normalize aspect_ratio - Standard supports '16:9' or '9:16'
    let aspect_ratio = body.aspect_ratio ?? '16:9';
    if (!['16:9', '9:16'].includes(aspect_ratio)) {
      aspect_ratio = '16:9';
    }
    
    const input: any = {
      prompt: body.prompt,
      resolution,
      aspect_ratio,
      duration,
    };
    
    // Only include api_key if provided
    if (body.api_key) {
      input.api_key = body.api_key;
    }
    
    console.log('[sora2T2vSubmit] Submitting to FAL:', { model, input });
    
    const { request_id } = await fal.queue.submit(model, { input } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      // persist normalized params for final debit mapping
      duration,
      resolution,
      aspect_ratio,
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // Sora 2 - Text to Video (Pro)
  async sora2ProT2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    const model = 'fal-ai/sora-2/text-to-video/pro';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    
    // Normalize duration to ensure it's a number and valid (4, 8, or 12)
    let duration = body.duration ?? 8;
    if (typeof duration !== 'number') {
      duration = parseInt(String(duration), 10) || 8;
    }
    // Clamp to valid values
    if (![4, 8, 12].includes(duration)) {
      if (duration < 6) duration = 4;
      else if (duration < 10) duration = 8;
      else duration = 12;
    }
    
    // Normalize resolution - Pro supports '720p' or '1080p'
    let resolution = body.resolution ?? '1080p';
    if (!['720p', '1080p'].includes(resolution)) {
      resolution = '1080p';
    }
    
    // Normalize aspect_ratio - Pro supports '16:9' or '9:16'
    let aspect_ratio = body.aspect_ratio ?? '16:9';
    if (!['16:9', '9:16'].includes(aspect_ratio)) {
      aspect_ratio = '16:9';
    }
    
    const input: any = {
      prompt: body.prompt,
      resolution,
      aspect_ratio,
      duration,
    };
    
    // Only include api_key if provided
    if (body.api_key) {
      input.api_key = body.api_key;
    }
    
    console.log('[sora2ProT2vSubmit] Submitting to FAL:', { model, input });
    
    const { request_id } = await fal.queue.submit(model, { input } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      // persist normalized params for final debit mapping
      duration,
      resolution,
      aspect_ratio,
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // LTX V2 - Image to Video (shared)
  async ltx2I2vSubmit(uid: string, body: any, fast = false): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!body?.image_url) throw new ApiError('image_url is required', 400);
    const model = fast ? 'fal-ai/ltxv-2/image-to-video/fast' : 'fal-ai/ltxv-2/image-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        image_url: body.image_url,
        resolution: body.resolution ?? '1080p',
        aspect_ratio: body.aspect_ratio ?? 'auto',
        duration: body.duration ?? 8, // seconds
        fps: body.fps ?? 25,
        generate_audio: body.generate_audio ?? true,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      duration: body.duration ?? 8,
      resolution: body.resolution ?? '1080p',
      aspect_ratio: body.aspect_ratio ?? 'auto',
      fps: body.fps ?? 25,
      generate_audio: body.generate_audio ?? true,
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // LTX V2 - Image to Video wrappers
  async ltx2ProI2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!body?.image_url) throw new ApiError('image_url is required', 400);
    const model = 'fal-ai/ltxv-2/image-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        image_url: body.image_url,
        resolution: body.resolution ?? '1080p',
        aspect_ratio: body.aspect_ratio ?? 'auto',
        duration: body.duration ?? 8,
        fps: body.fps ?? 25,
        generate_audio: body.generate_audio ?? true,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      duration: body.duration ?? 8,
      resolution: body.resolution ?? '1080p',
      aspect_ratio: body.aspect_ratio ?? 'auto',
      fps: body.fps ?? 25,
      generate_audio: body.generate_audio ?? true,
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  async ltx2FastI2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    if (!body?.image_url) throw new ApiError('image_url is required', 400);
    const model = 'fal-ai/ltxv-2/image-to-video/fast';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        image_url: body.image_url,
        resolution: body.resolution ?? '1080p',
        aspect_ratio: body.aspect_ratio ?? 'auto',
        duration: body.duration ?? 8,
        fps: body.fps ?? 25,
        generate_audio: body.generate_audio ?? true,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      duration: body.duration ?? 8,
      resolution: body.resolution ?? '1080p',
      aspect_ratio: body.aspect_ratio ?? 'auto',
      fps: body.fps ?? 25,
      generate_audio: body.generate_audio ?? true,
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // LTX V2 - Text to Video (shared)
  async ltx2T2vSubmit(uid: string, body: any, fast = false): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    const model = fast ? 'fal-ai/ltxv-2/text-to-video/fast' : 'fal-ai/ltxv-2/text-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        duration: body.duration ?? 8,
        resolution: body.resolution ?? '1080p',
        aspect_ratio: body.aspect_ratio ?? '16:9',
        fps: body.fps ?? 25,
        generate_audio: body.generate_audio ?? true,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      duration: body.duration ?? 8,
      resolution: body.resolution ?? '1080p',
      aspect_ratio: body.aspect_ratio ?? '16:9',
      fps: body.fps ?? 25,
      generate_audio: body.generate_audio ?? true,
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  // LTX V2 - Text to Video wrappers
  async ltx2ProT2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    const model = 'fal-ai/ltxv-2/text-to-video';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        duration: body.duration ?? 8,
        resolution: body.resolution ?? '1080p',
        aspect_ratio: body.aspect_ratio ?? '16:9',
        fps: body.fps ?? 25,
        generate_audio: body.generate_audio ?? true,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      duration: body.duration ?? 8,
      resolution: body.resolution ?? '1080p',
      aspect_ratio: body.aspect_ratio ?? '16:9',
      fps: body.fps ?? 25,
      generate_audio: body.generate_audio ?? true,
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  async ltx2FastT2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
    const falKey = env.falKey as string; if (!falKey) throw new ApiError('FAL AI API key not configured', 500);
    fal.config({ credentials: falKey });
    if (!body?.prompt) throw new ApiError('Prompt is required', 400);
    const model = 'fal-ai/ltxv-2/text-to-video/fast';
    const { historyId } = await queueCreateHistory(uid, { prompt: body.prompt, model, isPublic: body.isPublic });
    const { request_id } = await fal.queue.submit(model, {
      input: {
        prompt: body.prompt,
        duration: body.duration ?? 8,
        resolution: body.resolution ?? '1080p',
        aspect_ratio: body.aspect_ratio ?? '16:9',
        fps: body.fps ?? 25,
        generate_audio: body.generate_audio ?? true,
      },
    } as any);
    await generationHistoryRepository.update(uid, historyId, {
      provider: 'fal',
      providerTaskId: request_id,
      duration: body.duration ?? 8,
      resolution: body.resolution ?? '1080p',
      aspect_ratio: body.aspect_ratio ?? '16:9',
      fps: body.fps ?? 25,
      generate_audio: body.generate_audio ?? true,
    } as any);
    return { requestId: request_id, historyId, model, status: 'submitted' };
  },
  queueStatus,
  queueResult,
};

