export interface MinimaxGenerateRequest {
  model?: string;
  prompt: string;
  aspect_ratio?:
    | "1:1"
    | "16:9"
    | "4:3"
    | "3:2"
    | "2:3"
    | "3:4"
    | "9:16"
    | "21:9";
  width?: number;
  height?: number;
  response_format?: "url" | "b64_json";
  seed?: number;
  n?: number; // 1..9
  prompt_optimizer?: boolean;
  subject_reference?: Array<{ type: "character"; image_file: string }>;
  generationType?: string;
  style?: string;
}

export interface MinimaxGeneratedImage {
  id: string;
  url: string;
  originalUrl: string;
}

export interface MinimaxGenerateResponse {
  images: MinimaxGeneratedImage[];
  historyId?: string;
  id?: string | number;
}
