export type FrameSize =
  | "1:1"
  | "3:4"
  | "4:3"
  | "16:9"
  | "9:16"
  | "3:2"
  | "2:3"
  | "21:9"
  | "9:21"
  | "16:10"
  | "10:16";

export interface BflGenerateRequest {
  prompt: string;
  userPrompt?: string;
  model: string;
  n?: number;
  frameSize?: FrameSize;
  style?: string;
  uploadedImages?: string[];
  width?: number;
  height?: number;
  generationType?: string;
}

export interface GeneratedImage {
  url: string;
  originalUrl: string;
  id: string;
}

export interface BflGenerateResponse {
  images: GeneratedImage[];
}
