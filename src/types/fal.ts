export interface FalGenerateRequest {
  prompt: string;
  userPrompt?: string;
  model: string; // e.g., 'gemini-25-flash-image'
  n?: number;
  frameSize?: string;
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
