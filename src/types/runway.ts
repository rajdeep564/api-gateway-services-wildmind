export type RunwayImageModel = "gen4_image" | "gen4_image_turbo";

export interface RunwayTextToImageRequest {
  promptText: string;
  ratio: string;
  model: RunwayImageModel;
  seed?: number;
  uploadedImages?: string[]; // base64 or URLs
  contentModeration?: { publicFigureThreshold?: "auto" | string };
  generationType?: string;
  style?: string;
}

export interface RunwayTextToImageResponse {
  taskId: string;
  historyId?: string;
  status: "pending" | "completed" | "failed";
  isExistingHistory?: boolean;
}

export type RunwayVideoMode = "image_to_video" | "video_to_video";
