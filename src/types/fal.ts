export interface FalGenerateRequest {
  characterName?: string;
  prompt: string;
  userPrompt?: string;
  model: string; // e.g., 'gemini-25-flash-image'
  // Legacy fields (still accepted for backwards compatibility)
  n?: number;
  frameSize?: string;
  // New schema fields
  num_images?: number;
  aspect_ratio?:
    | "auto"
    | "21:9"
    | "1:1"
    | "4:3"
    | "3:2"
    | "2:3"
    | "5:4"
    | "4:5"
    | "3:4"
    | "16:9"
    | "9:16";
  // For models like Seedream v4 which accept image_size enums
  image_size?: 'square_hd' | 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9' | { width: number; height: number };
  style?: string;
  uploadedImages?: string[]; // URLs or data URIs
  output_format?: "jpeg" | "png" | "webp";
  image_url?: string;
  end_image_url?: string;
  // Imagen 4 specific optional inputs
  resolution?: "1K" | "2K" | "4K" | "480p" | "720p" | "1080p" | "4k";
  duration?:
    | "auto"
    | "4"
    | "5"
    | "6"
    | "7"
    | "8"
    | "9"
    | "10"
    | "11"
    | "12"
    | "13"
    | "14"
    | "15"
    | "4s"
    | "5s"
    | "6s"
    | "7s"
    | "8s"
    | "9s"
    | "10s"
    | "11s"
    | "12s"
    | "13s"
    | "14s"
    | "15s";
  generate_audio?: boolean;
  seed?: number;
  end_user_id?: string;
  negative_prompt?: string;
  generationType?: string;
  tags?: string[];
  nsfw?: boolean;
  visibility?: string;
  isPublic?: boolean;
  // Optional: override output storage location (e.g., users/{username}/canvas/{projectId})
  storageKeyPrefixOverride?: string;
  // If true, force synchronous Zata upload (useful for canvas so we have storagePath immediately)
  forceSyncUpload?: boolean;
}

export interface FalGeneratedImage {
  url: string;
  originalUrl: string;
  id: string;
}

export interface FalGenerateResponse {
  images: FalGeneratedImage[];
  videos?: Array<{
    url: string;
    originalUrl?: string;
    id: string;
    storagePath?: string;
  }>;
  historyId?: string;
  model?: string;
  requestId?: string;
  status?: "completed" | "failed" | "generating" | "submitted";
}
