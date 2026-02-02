/**
 * Fal.ai Error Codes and User-Friendly Messages
 * Based on: https://docs.fal.ai/llms.txt
 */

export interface FalErrorResponse {
  code: string;
  message: string;
  title: string;
  originalError?: any;
}

export const FAL_ERROR_TYPES: Record<string, { title: string; message: (ctx?: any) => string }> = {
  'internal_server_error': {
    title: "System Error",
    message: () => "An unexpected error occurred with the AI provider. Please try again later."
  },
  'generation_timeout': {
    title: "Generation Timeout",
    message: () => "The generation took too long to complete. Please try again with simpler settings."
  },
  'downstream_service_error': {
    title: "Provider Error",
    message: () => "An issue occurred with a downstream service. Please try again."
  },
  'downstream_service_unavailable': {
    title: "Service Unavailable",
    message: () => "The AI service is currently unavailable. Please try again later."
  },
  'content_policy_violation': {
    title: "Safety Check Failed",
    message: () => "The content was flagged by safety filters. Please modify your prompt or input."
  },
  'image_too_small': {
    title: "Image Too Small",
    message: (ctx) => `Image dimensions are too small. Minimum required: ${ctx?.min_width || '?'}x${ctx?.min_height || '?'}.`
  },
  'image_too_large': {
    title: "Image Too Large",
    message: (ctx) => `Image dimensions are too large. Maximum allowed: ${ctx?.max_width || '?'}x${ctx?.max_height || '?'}.`
  },
  'image_load_error': {
    title: "Image Load Error",
    message: () => "Failed to load or process the provided image. Please check the file."
  },
  'file_download_error': {
    title: "Download Error",
    message: () => "Could not download the input file. Ensure the URL is accessible."
  },
  'face_detection_error': {
    title: "No Face Detected",
    message: () => "Could not detect a face in the image. Please use an image with a clear face."
  },
  'file_too_large': {
    title: "File Too Large",
    message: (ctx) => `File size exceeds the maximum limit ${ctx?.max_size ? `of ${Math.round(ctx.max_size/1024/1024)}MB` : ''}.`
  },
  'greater_than': {
    title: "Invalid Parameter",
    message: (ctx) => `Value must be greater than ${ctx?.gt}.`
  },
  'greater_than_equal': {
    title: "Invalid Parameter",
    message: (ctx) => `Value must be greater than or equal to ${ctx?.ge}.`
  },
  'less_than': {
    title: "Invalid Parameter",
    message: (ctx) => `Value must be less than ${ctx?.lt}.`
  },
  'less_than_equal': {
    title: "Invalid Parameter",
    message: (ctx) => `Value must be less than or equal to ${ctx?.le}.`
  },
  'multiple_of': {
    title: "Invalid Dimension",
    message: (ctx) => `Dimension must be a multiple of ${ctx?.multiple_of}.`
  },
  'sequence_too_short': {
    title: "Input Too Short",
    message: (ctx) => `Input has fewer items than required (minimum ${ctx?.min_length}).`
  },
  'sequence_too_long': {
    title: "Input Too Long",
    message: (ctx) => `Input exceeds maximum items allowed (maximum ${ctx?.max_length}).`
  },
  'one_of': {
    title: "Invalid Option",
    message: (ctx) => `Value must be one of: ${ctx?.expected?.join(', ')}.`
  },
  'feature_not_supported': {
    title: "Not Supported",
    message: () => "The requested feature combination is not supported."
  },
  'invalid_archive': {
    title: "Invalid Archive",
    message: () => "Could not read the provided archive file. Ensure it is not corrupted."
  },
  'archive_file_count_below_minimum': {
    title: "Not Enough Files",
    message: (ctx) => `Archive contains too few files (min ${ctx?.min_count}).`
  },
  'archive_file_count_exceeds_maximum': {
    title: "Too Many Files",
    message: (ctx) => `Archive contains too many files (max ${ctx?.max_count}).`
  },
  'audio_duration_too_long': {
    title: "Audio Too Long",
    message: (ctx) => `Audio duration exceeds limits (max ${ctx?.max_duration}s).`
  },
  'audio_duration_too_short': {
    title: "Audio Too Short",
    message: (ctx) => `Audio duration is too short (min ${ctx?.min_duration}s).`
  },
  'unsupported_audio_format': {
    title: "Unsupported Audio",
    message: (ctx) => `Audio format not supported. Allowed: ${ctx?.supported_formats?.join(', ')}.`
  },
  'unsupported_image_format': {
    title: "Unsupported Image",
    message: (ctx) => `Image format not supported. Allowed: ${ctx?.supported_formats?.join(', ')}.`
  },
  'unsupported_video_format': {
    title: "Unsupported Video",
    message: (ctx) => `Video format not supported. Allowed: ${ctx?.supported_formats?.join(', ')}.`
  },
  'video_duration_too_long': {
    title: "Video Too Long",
    message: (ctx) => `Video duration exceeds limits (max ${ctx?.max_duration}s).`
  },
  'video_duration_too_short': {
    title: "Video Too Short",
    message: (ctx) => `Video duration is too short (min ${ctx?.min_duration}s).`
  }
};

export function mapFalError(error: any): FalErrorResponse {
  // Check for Fal's structured error response: { body: { detail: [ ... ] } } or similar
  // Fal often returns 422 with a body like: { detail: [{ loc, msg, type, ctx }] }
  
  const detail = error?.body?.detail || error?.response?.data?.detail;
  
  if (Array.isArray(detail) && detail.length > 0) {
    // We usually take the first error
    const firstError = detail[0];
    const type = firstError.type;
    const ctx = firstError.ctx;
    
    if (type && FAL_ERROR_TYPES[type]) {
      return {
        code: type.toUpperCase(),
        title: FAL_ERROR_TYPES[type].title,
        message: FAL_ERROR_TYPES[type].message(ctx),
        originalError: error
      };
    }
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

  if (status >= 500) {
    return {
      code: 'SERVER_ERROR',
      title: 'AI Provider Error',
      message: 'The AI provider is experiencing issues. Please try again later.',
      originalError: error
    };
  }

  return {
    code: 'UNKNOWN',
    title: 'Generation Failed',
    message: error?.message || 'An unknown error occurred during generation.',
    originalError: error
  };
}
