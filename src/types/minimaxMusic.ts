export interface MinimaxMusicRequest {
  model?: string;
  prompt: string;
  lyrics: string;
  audio_setting?: {
    sample_rate?: number;
    bitrate?: number;
    format?: string;
  };
  output_format?: "hex" | "url" | "b64_json";
  stream?: boolean;
  generationType?: string;
}

export type MinimaxMusicResponse = any;
