export type GenerationType =
  | 'text-to-image'
  | 'logo'
  | 'sticker-generation'
  | 'text-to-video'
  | 'text-to-music'
  | 'mockup-generation'
  | 'product-generation'
  | 'ad-generation'
  | 'live-chat'
  | 'text-to-character';

export const GenerationTypes = {
  TextToImage: 'text-to-image' as const,
  Logo: 'logo' as const,
  Sticker: 'sticker-generation' as const,
  TextToVideo: 'text-to-video' as const,
  TextToMusic: 'text-to-music' as const,
  Mockup: 'mockup-generation' as const,
  Product: 'product-generation' as const,
  Ad: 'ad-generation' as const,
  LiveChat: 'live-chat' as const,
  TextToCharacter: 'text-to-character' as const,
} as const;

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

export interface AudioMedia {
  id: string;
  url: string;
  storagePath?: string;
  originalUrl?: string;
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
  audios?: AudioMedia[];
  frameSize?: string;
  aspectRatio?: string;
  aspect_ratio?: string;
  style?: string;
  // replaced by isPublic in repositories/services
  isPublic?: boolean;
  // soft delete flag; when true item should be hidden everywhere
  isDeleted?: boolean;
  error?: string;
  // Character name for text-to-character generation type
  characterName?: string;
  createdAt: any;
  updatedAt: any;
  // Creator information
  createdBy?: { uid: string; username?: string; email?: string; photoURL?: string };
}

export interface CreateGenerationPayload {
  prompt: string;
  model: string;
  generationType: GenerationType | string;
  visibility?: Visibility | string;
  tags?: string[];
  nsfw?: boolean;
  frameSize?: string;
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


