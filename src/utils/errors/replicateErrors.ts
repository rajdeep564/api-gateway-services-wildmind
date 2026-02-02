/**
 * Replicate Error Codes and User-Friendly Messages
 * Based on: https://replicate.com/docs/reference/error-codes
 */

export interface ReplicateErrorResponse {
  code: string;
  message: string;
  title: string;
  originalError?: any;
}

export const REPLICATE_ERROR_CODES: Record<string, { title: string; message: string }> = {
  'E1000': {
    title: "Unexpected Error",
    message: "An unexpected error occurred with the AI model. Please try again later."
  },
  'E1001': {
    title: "Model Out of Memory",
    message: "The model ran out of memory. Try reducing your input size (e.g., smaller image, shorter prompt) or use a different model."
  },
  'E4875': {
    title: "Configuration Error",
    message: "There was a configuration issue with the webhook. Please report this to support."
  },
  'E6716': {
    title: "Startup Timeout",
    message: "The model took too long to start. This happens during high traffic. Please try again in a moment."
  },
  'E8367': {
    title: "Generation Stopped",
    message: "The generation was interrupted. This might be due to a timeout or manual cancellation. Please try again."
  },
  'E8765': {
    title: "Model Unavailable",
    message: "The model is currently failing health checks. Please try a different model or wait a few minutes."
  },
  'E9243': {
    title: "Startup Error",
    message: "The model failed to start due to invalid inputs or configuration. Please check your settings."
  },
  'E9825': {
    title: "Upload Failed",
    message: "Failed to upload input file to Replicate. Please check your connection and file size."
  },
};

export function mapReplicateError(error: any): ReplicateErrorResponse {
  // Extract error code if present (E####)
  // Replicate often sends "E1001" in the error message or object
  const message = error?.message || error?.toString() || '';
  const codeMatch = message.match(/E\d{4}/);
  const code = codeMatch ? codeMatch[0] : (error?.code || 'UNKNOWN');

  // Check known codes
  if (code && REPLICATE_ERROR_CODES[code]) {
    return {
      code,
      ...REPLICATE_ERROR_CODES[code],
      originalError: error
    };
  }

  // HTTP Status Checks
  const status = error?.response?.status || error?.status || error?.statusCode;
  
  if (status === 429) {
    return {
      code: 'RATE_LIMIT',
      title: 'Too Many Requests',
      message: 'We are receiving too many requests. Please wait a moment and try again.',
      originalError: error
    };
  }

  if (status === 402) {
    return {
      code: 'PROVIDER_LIMIT',
      title: 'Service Limit Reached',
      message: 'The system is currently experiencing limits. Please try again later or contact support.',
      originalError: error
    };
  }
  
  if (status >= 500) {
    return {
      code: 'SERVER_ERROR',
      title: 'AI Provider Error',
      message: 'The AI provider is experiencing issues. Please try again later.',
      originalError: error
    };
  }

  // Fallback for NSFW/Safety (common in Replicate output logs)
  if (message.toLowerCase().includes('nsfw') || message.toLowerCase().includes('safety')) {
    return {
      code: 'NSFW_DETECTED',
      title: 'Safety Filter Triggered',
      message: 'The generated content was flagged by safety filters. Please adjust your prompt.',
      originalError: error
    };
  }

  return {
    code: 'UNKNOWN',
    title: 'Generation Failed',
    message: message || 'An unknown error occurred during generation.',
    originalError: error
  };
}
