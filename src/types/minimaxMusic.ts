export interface MinimaxMusicRequest {
  model?: string;
  prompt: string;
  lyrics: string;
  audio_setting?: any;
  output_format?: "hex" | "url" | "b64_json";
}

export type MinimaxMusicResponse = any;
