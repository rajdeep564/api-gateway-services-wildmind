export interface FalSubmitRequest {
  prompt: string;
  model?: string;
  image_size?: string;
  num_images?: number;
  guidance_scale?: number;
  num_inference_steps?: number;
  enable_safety_checker?: boolean;
  seed?: number;
  sync_mode?: boolean;
}

export interface FalSubmitResponse {
  request_id: string;
  status: string;
}

export interface FalStatusResponse {
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  request_id: string;
  logs?: any[];
  metrics?: any;
}

export interface FalImageResult {
  id: string;
  url: string;
  originalUrl: string;
  zataUrl?: string;
  zataKey?: string;
  firebaseUrl?: string; // For compatibility
}

export interface FalResultResponse {
  status: 'success' | 'error';
  images: FalImageResult[];
  request_id: string;
}
