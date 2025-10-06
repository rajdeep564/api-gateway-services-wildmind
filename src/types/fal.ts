export interface FalGenerateRequest {
  prompt: string;
  userPrompt?: string;
  model: string; // e.g., 'gemini-25-flash-image'
  // Legacy fields (still accepted for backwards compatibility)
  n?: number;
  frameSize?: string;
  // New schema fields
  num_images?: number;
  aspect_ratio?: '21:9' | '1:1' | '4:3' | '3:2' | '2:3' | '5:4' | '4:5' | '3:4' | '16:9' | '9:16';
  // For models like Seedream v4 which accept image_size enums
  image_size?: 'square_hd' | 'square' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9' | { width: number; height: number };
  style?: string;
  uploadedImages?: string[]; // URLs or data URIs
  output_format?: "jpeg" | "png" | "webp";
  generationType?: string;
  tags?: string[];
  nsfw?: boolean;
  visibility?: string;
  isPublic?: boolean;
}

export interface FalGeneratedImage {
  url: string;
  originalUrl: string;
  id: string;
}

export interface FalGenerateResponse {
  images: FalGeneratedImage[];
  historyId?: string;
  model?: string;
  status?: "completed" | "failed" | "generating";
}
