export enum GenerationType {
  TextToImage = 'text-to-image',
  Logo = 'logo',
  Sticker = 'sticker',
  TextToVideo = 'text-to-video',
  TextToMusic = 'text-to-music',
  Mockup = 'mockup',
  Product = 'product',
  Ad = 'ad',
  LiveChat = 'live-chat'
}

export enum GenerationStatus {
  Generating = 'generating',
  Completed = 'completed',
  Failed = 'failed'
}

export enum Visibility {
  Private = 'private',
  Public = 'public',
  Unlisted = 'unlisted'
}

export interface ImageMedia {
  id: string;
  url: string;
  storagePath: string;
  originalUrl?: string;
}

export interface VideoMedia {
  id: string;
  url: string;
  storagePath: string;
  thumbUrl?: string;
}

export interface GenerationHistoryItem {
  id: string;
  uid: string;
  prompt: string;
  model: string;
  generationType: GenerationType;
  status: GenerationStatus;
  visibility: Visibility;
  tags?: string[];
  nsfw?: boolean;
  images?: ImageMedia[];
  videos?: VideoMedia[];
  // replaced by isPublic in repositories/services
  isPublic?: boolean;
  error?: string;
  createdAt: any;
  updatedAt: any;
}

export interface CreateGenerationPayload {
  prompt: string;
  model: string;
  generationType: GenerationType | string;
  visibility?: Visibility | string;
  tags?: string[];
  nsfw?: boolean;
}

export interface CompleteGenerationPayload {
  status: 'completed';
  images?: ImageMedia[];
  videos?: VideoMedia[];
  isPublic?: boolean;
  tags?: string[];
  nsfw?: boolean;
}

export interface FailGenerationPayload {
  status: 'failed';
  error: string;
}


