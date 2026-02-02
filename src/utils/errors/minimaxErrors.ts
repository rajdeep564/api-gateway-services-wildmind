/**
 * MiniMax Error Codes and User-Friendly Messages
 * Based on provided documentation: https://platform.minimax.io/docs/llms.txt
 */

export interface MinimaxErrorResponse {
  code: string;
  message: string;
  title: string;
  originalError?: any;
}

export const MINIMAX_ERROR_CODES: Record<string | number, { title: string; message: string; code: string }> = {
  1000: { title: "Unknown Error", message: "An unknown error occurred. Please try again later.", code: "UNKNOWN_ERROR" },
  1001: { title: "Request Timeout", message: "The request timed out. Please try again later.", code: "TIMEOUT" },
  1002: { title: "Rate Limit Exceeded", message: "You are making too many requests. Please try again later.", code: "RATE_LIMIT" },
  1004: { title: "Authentication Failed", message: "API key validation failed. Please contact support.", code: "AUTH_FAILED" },
  1008: { title: "Service Balance Low", message: "The AI provider has insufficient balance. Please contact support.", code: "PROVIDER_BALANCE_LOW" },
  1024: { title: "Internal Server Error", message: "MiniMax encountered an internal error. Please try again later.", code: "INTERNAL_ERROR" },
  1026: { title: "Safety Check Failed", message: "Your input contains sensitive content. Please modify your prompt.", code: "SENSITIVE_INPUT" },
  1027: { title: "Safety Check Failed", message: "The generated output contained sensitive content.", code: "SENSITIVE_OUTPUT" },
  1033: { title: "System Error", message: "A database error occurred at the provider. Please try again later.", code: "SYSTEM_ERROR" },
  1039: { title: "Token Limit Exceeded", message: "The request exceeded the token limit. Please reduce your input length.", code: "TOKEN_LIMIT" },
  1041: { title: "Connection Limit", message: "Too many concurrent connections. Please try again later.", code: "CONN_LIMIT" },
  1042: { title: "Invalid Characters", message: "Input contains too many invisible or illegal characters. Please check your text.", code: "INVALID_CHARS" },
  1043: { title: "Similarity Check Failed", message: "ASR similarity check failed. Please check your file and text validation.", code: "ASR_FAILURE" },
  1044: { title: "Clone Check Failed", message: "Voice clone similarity check failed. Please verify your prompt audio.", code: "CLONE_FAILURE" },
  2013: { title: "Invalid Parameters", message: "One or more parameters are invalid. Please check your request.", code: "INVALID_PARAMS" },
  20132: { title: "Invalid Voice ID", message: "The provided sample or voice ID is invalid. Please check your inputs.", code: "INVALID_VOICE_ID" },
  2037: { title: "Duration Error", message: "Voice sample duration is too short or too long. Please adjust the file.", code: "DURATION_ERROR" },
  2039: { title: "Duplicate Voice ID", message: "This voice ID already exists. Please use a unique ID.", code: "DUPLICATE_VOICE_ID" },
  2042: { title: "Access Denied", message: "You do not have access to this voice ID.", code: "ACCESS_DENIED" },
  2045: { title: "Rate Growth Limit", message: "Request volume increased too quickly. Please slow down.", code: "RATE_GROWTH_LIMIT" },
  2048: { title: "Audio Too Long", message: "Prompt audio is too long. Please keep it under 8 seconds.", code: "AUDIO_TOO_LONG" },
  2049: { title: "Invalid API Key", message: "The MiniMax API key is invalid. Please contact support.", code: "INVALID_API_KEY" },
  2056: { title: "Usage Limit Exceeded", message: "Provider usage limit exceeded. Quota resets in the next window.", code: "USAGE_LIMIT" },
};

export function mapMinimaxError(error: any): MinimaxErrorResponse {
  // Extract error code from various potential locations
  // MiniMax often returns { base_resp: { status_code: 1001, status_msg: "..." } }
  const code = 
    error?.base_resp?.status_code || 
    error?.status_code || 
    error?.code || 
    error?.response?.data?.base_resp?.status_code ||
    error?.response?.data?.status_code;

  if (code && MINIMAX_ERROR_CODES[code]) {
    const mapping = MINIMAX_ERROR_CODES[code];
    return {
      code: mapping.code,
      title: mapping.title,
      message: mapping.message,
      originalError: error
    };
  }

  // HTTP Status Checks
  const status = error?.status || error?.statusCode || error?.response?.status;
  
  if (status === 402) {
    return {
      code: 'PROVIDER_LIMIT',
      title: 'Service Limit Reached',
      message: 'The system is currently experiencing limits. Please try again later.',
      originalError: error
    };
  }

  if (status === 429) {
    return {
      code: 'RATE_LIMIT',
      title: 'Too Many Requests',
      message: 'We are receiving too many requests. Please wait a moment and try again.',
      originalError: error
    };
  }

  return {
    code: 'UNKNOWN_MINIMAX_ERROR',
    title: 'Generation Failed',
    message: error?.base_resp?.status_msg || error?.message || 'An unknown error occurred with MiniMax.',
    originalError: error
  };
}
