/**
 * WildMind — Requirement Schemas
 *
 * Every generation task type has a schema of fields the agent must collect
 * before handing off to the AI Planner. Each field carries:
 *   - key:       unique identifier (snake_case)
 *   - label:     human-readable name
 *   - required:  must be filled before spec is complete
 *   - type:      used for UI rendering hints
 *   - question:  what the agent asks the user for this field
 *   - options:   optional enum values
 */

export type FieldType = "string" | "number" | "boolean" | "enum";

export interface RequirementField {
  key: string;
  label: string;
  required: boolean;
  type: FieldType;
  question: string;
  options?: string[]; // for enum type
  defaultValue?: string | number | boolean;
}

export interface RequirementSchema {
  taskType: string;
  displayName: string;
  fields: RequirementField[];
}

// ── Schema definitions ────────────────────────────────────────────────────────

export const FALLBACK_SCHEMAS: Record<string, RequirementSchema> = {

  image: {
    taskType: "image",
    displayName: "Image Generation",
    fields: [
      {
        key: "subject",
        label: "Subject",
        required: true,
        type: "string",
        question: "What should be in the image? Describe the subject or scene.",
      },
      {
        key: "style",
        label: "Visual Style",
        required: true,
        type: "enum",
        question: "What visual style do you want? (e.g. photorealistic, cinematic, anime, illustration, oil painting, minimalist)",
        options: ["photorealistic", "cinematic", "anime", "illustration", "oil painting", "minimalist", "abstract", "3d render"],
      },
      {
        key: "mood",
        label: "Mood / Atmosphere",
        required: false,
        type: "string",
        question: "What mood or atmosphere should the image have? (e.g. dramatic, peaceful, dark, vibrant)",
      },
      {
        key: "aspect_ratio",
        label: "Aspect Ratio",
        required: false,
        type: "enum",
        question: "What aspect ratio do you need? (square, portrait, landscape, wide)",
        options: ["1:1", "9:16", "16:9", "4:3", "3:2"],
        defaultValue: "1:1",
      },
      {
        key: "color_palette",
        label: "Color Palette",
        required: false,
        type: "string",
        question: "Any specific colors or palette you want? (e.g. warm tones, blue and gold, monochrome)",
      },
      {
        key: "reference_image_url",
        label: "Reference / Mood board",
        required: false,
        type: "string",
        question: "Do you have a reference image, mood board, or style reference? If yes, upload it using the + button and then send a message (e.g. 'here it is'). If not, reply 'no' or 'skip'.",
      },
    ],
  },

  logo: {
    taskType: "logo",
    displayName: "Logo Generation",
    fields: [
      {
        key: "brand_name",
        label: "Brand Name",
        required: true,
        type: "string",
        question: "What is the brand or company name for the logo?",
      },
      {
        key: "industry",
        label: "Industry / Niche",
        required: true,
        type: "string",
        question: "What industry or niche is this brand in? (e.g. coffee, tech, fashion, fitness)",
      },
      {
        key: "style",
        label: "Logo Style",
        required: true,
        type: "enum",
        question: "What logo style do you prefer? (minimal, luxury, modern, playful, corporate, vintage)",
        options: ["minimal", "luxury", "modern", "playful", "corporate", "vintage", "geometric", "hand-drawn"],
      },
      {
        key: "colors",
        label: "Color Palette",
        required: true,
        type: "string",
        question: "What colors should the logo use? (e.g. navy and gold, earth tones, black and white)",
      },
      {
        key: "icon_preference",
        label: "Icon Preference",
        required: false,
        type: "enum",
        question: "What type of logo mark do you want? (icon only, text only, icon + text, abstract mark)",
        options: ["icon only", "text only", "icon + text", "abstract mark", "lettermark"],
      },
      {
        key: "tagline",
        label: "Tagline",
        required: false,
        type: "string",
        question: "Do you have a tagline or slogan to include? (leave blank if not)",
      },
      {
        key: "reference_image_url",
        label: "Reference / Mood board",
        required: false,
        type: "string",
        question: "Do you have a reference image or logo idea you'd like to match? Upload it with the + button and send a message, or reply 'no' to skip.",
      },
    ],
  },

  video: {
    taskType: "video",
    displayName: "Video Generation",
    fields: [
      {
        key: "subject",
        label: "Subject / Scene",
        required: true,
        type: "string",
        question: "What should the video show? Describe the main subject or scene.",
      },
      {
        key: "style",
        label: "Visual Style",
        required: true,
        type: "enum",
        question: "What visual style should the video have? (cinematic, documentary, animation, timelapse, drone)",
        options: ["cinematic", "documentary", "animation", "timelapse", "drone", "stylized", "realistic"],
      },
      {
        key: "duration",
        label: "Duration (seconds)",
        required: true,
        type: "number",
        question: "How long should the video be? (e.g. 10, 30, 60 seconds)",
      },
      {
        key: "aspect_ratio",
        label: "Aspect Ratio",
        required: false,
        type: "enum",
        question: "What aspect ratio? (16:9 for landscape, 9:16 for vertical/reels, 1:1 for square)",
        options: ["16:9", "9:16", "1:1", "4:3"],
        defaultValue: "16:9",
      },
      {
        key: "mood",
        label: "Mood / Tone",
        required: false,
        type: "string",
        question: "What mood or tone should the video have? (e.g. epic, calm, mysterious, energetic)",
      },
      {
        key: "reference_image_url",
        label: "Reference / Style reference",
        required: false,
        type: "string",
        question: "Do you have a reference image or style reference? Upload it with the + button and send a message, or reply 'no' to skip.",
      },
    ],
  },

  video_ad: {
    taskType: "video_ad",
    displayName: "Video Advertisement",
    fields: [
      {
        key: "product",
        label: "Product / Service",
        required: true,
        type: "string",
        question: "What product or service is being advertised?",
      },
      {
        key: "brand_name",
        label: "Brand Name",
        required: true,
        type: "string",
        question: "What is the brand or company name?",
      },
      {
        key: "target_audience",
        label: "Target Audience",
        required: true,
        type: "string",
        question: "Who is the target audience? (e.g. '25-40 year old professionals', 'fitness enthusiasts', 'parents')",
      },
      {
        key: "brand_tone",
        label: "Brand Tone",
        required: true,
        type: "enum",
        question: "What is the brand's tone? (premium, playful, bold, calm, inspirational, professional)",
        options: ["premium", "playful", "bold", "calm", "inspirational", "professional", "energetic", "luxurious"],
      },
      {
        key: "duration",
        label: "Duration (seconds)",
        required: true,
        type: "number",
        question: "How long should the ad be? (e.g. 15, 30, 60 seconds)",
      },
      {
        key: "visual_style",
        label: "Visual Style",
        required: true,
        type: "enum",
        question: "What visual style? (cinematic, minimalist, fast-cut, documentary, animated)",
        options: ["cinematic", "minimalist", "fast-cut", "documentary", "animated", "product-focused"],
      },
      {
        key: "voiceover",
        label: "Voiceover",
        required: false,
        type: "boolean",
        question: "Should the ad include a voiceover narration? (yes or no)",
        defaultValue: true,
      },
      {
        key: "music_style",
        label: "Background Music Style",
        required: false,
        type: "string",
        question: "What style of background music should be used? (e.g. upbeat pop, ambient, orchestral, hip-hop, none)",
      },
      {
        key: "aspect_ratio",
        label: "Aspect Ratio",
        required: false,
        type: "enum",
        question: "What aspect ratio? (16:9 for YouTube/TV, 9:16 for Instagram Reels/TikTok, 1:1 for Facebook)",
        options: ["16:9", "9:16", "1:1", "4:5"],
        defaultValue: "16:9",
      },
      {
        key: "reference_image_url",
        label: "Reference / Visual reference",
        required: false,
        type: "string",
        question: "Do you have a reference image or visual style reference for the ad? Upload it with the + button and send a message, or reply 'no' to skip.",
      },
    ],
  },

  music: {
    taskType: "music",
    displayName: "Music Generation",
    fields: [
      {
        key: "genre",
        label: "Genre",
        required: true,
        type: "string",
        question: "What genre or style of music do you want? (e.g. cinematic, lo-fi, hip-hop, jazz, electronic, orchestral)",
      },
      {
        key: "mood",
        label: "Mood",
        required: true,
        type: "enum",
        question: "What mood should the music convey? (uplifting, melancholic, tense, relaxing, epic, romantic)",
        options: ["uplifting", "melancholic", "tense", "relaxing", "epic", "romantic", "mysterious", "energetic"],
      },
      {
        key: "duration",
        label: "Duration (seconds)",
        required: true,
        type: "number",
        question: "How long should the track be? (e.g. 30, 60, 120 seconds)",
      },
      {
        key: "tempo",
        label: "Tempo",
        required: false,
        type: "enum",
        question: "What tempo do you prefer? (slow, medium, fast)",
        options: ["slow", "medium", "fast"],
        defaultValue: "medium",
      },
      {
        key: "instruments",
        label: "Instruments",
        required: false,
        type: "string",
        question: "Any specific instruments you want featured? (e.g. piano, guitar, strings, synths — or leave blank)",
      },
    ],
  },
};

// ── Helper to get a schema by taskType ────────────────────────────────────────

export function getFallbackSchema(taskType: string): RequirementSchema | null {
  return FALLBACK_SCHEMAS[taskType] ?? null;
}

/** Return only required fields for a given schema */
export function getRequiredFields(schema: RequirementSchema): RequirementField[] {
  return schema.fields.filter((f) => f.required) ?? [];
}

/** Return all fields (required + optional) for a schema */
export function getAllFields(schema: RequirementSchema): RequirementField[] {
  return schema.fields ?? [];
}

/** Detect whether a collection of fields satisfies required fields for the schema */
export function isSpecComplete(
  schema: RequirementSchema,
  collected: Record<string, any>,
): boolean {
  const required = getRequiredFields(schema);
  return required.every((f) => {
    const val = collected[f.key];
    return val !== undefined && val !== null && val !== "";
  });
}

/** Return list of missing required field keys */
export function getMissingFields(
  schema: RequirementSchema,
  collected: Record<string, any>,
): RequirementField[] {
  return getRequiredFields(schema).filter((f) => {
    const val = collected[f.key];
    return val === undefined || val === null || val === "";
  });
}
