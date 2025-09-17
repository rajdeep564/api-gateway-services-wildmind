export interface GeneratePayload {
  model: string;
  prompt: string;
  options?: Record<string, any>;
}

export interface GenerateResult {
  id: string;
  input: GeneratePayload;
  output: {
    prompt: string;
    assets: any[];
  };
}
