const MODE_GENERATION_TYPES: Record<'image' | 'video' | 'music' | 'branding', string[]> = {
  image: [
    'text-to-image',
    'image-to-image',
    'image-generation',
    'image',
    'text-to-character',
    'image-upscale',
    'image-edit',
    'image-to-svg',
    'image-vectorize',
    'vectorize',
  ],
  video: [
    'text-to-video',
    'image-to-video',
    'video-to-video',
    'video-generation',
    'video',
    'video-edit',
  ],
  music: [
    'text-to-music',
    'music-generation',
    'music',
    'text-to-speech',
    'text-to-dialogue',
    'dialogue',
    'tts',
    'text-to-audio',
    'audio-generation',
    'audio',
    'sound-effect',
    'sound-effects',
    'sfx',
  ],
  branding: [
    'logo',
    'logo-generation',
    'branding',
    'branding-kit',
    'sticker-generation',
    'product-generation',
    'mockup-generation',
    'ad-generation',
  ],
};

const NORMALIZE_TYPE = (value?: string) =>
  value ? String(value).replace(/[_-]/g, '-').toLowerCase() : '';

export const normalizeMode = (
  mode?: string
): 'video' | 'image' | 'music' | 'branding' | 'all' | undefined => {
  if (!mode) return undefined;
  const normalized = String(mode).trim().toLowerCase();
  if (!normalized) return undefined;
  if (['video', 'image', 'music', 'branding', 'all'].includes(normalized)) {
    return normalized as 'video' | 'image' | 'music' | 'branding' | 'all';
  }
  return undefined;
};

export const mapModeToGenerationTypes = (mode?: string): string[] | undefined => {
  const normalized = normalizeMode(mode);
  if (!normalized || normalized === 'all') return undefined;
  const values = MODE_GENERATION_TYPES[normalized];
  return values ? [...values] : undefined;
};

export const getModeTypeSet = (
  mode?: string
): Set<string> | undefined => {
  const types = mapModeToGenerationTypes(mode);
  if (!types || types.length === 0) return undefined;
  return new Set(types.map((t) => NORMALIZE_TYPE(t)));
};

export const MODE_TYPE_MAP = MODE_GENERATION_TYPES;

