import { ApiError } from './errorHandler';

type FalErrorDetail = {
  loc?: string[];
  msg?: string;
  type?: string;
  url?: string;
  ctx?: Record<string, unknown>;
  input?: any;
};

type FalErrorOptions = {
  fallbackMessage?: string;
  context?: string;
  toastTitle?: string;
  defaultStatus?: number;
  extraData?: Record<string, unknown>;
};

const FAL_ERROR_HINTS: Record<string, string> = {
  internal_server_error: 'FAL encountered an internal issue. Please retry shortly.',
  generation_timeout: 'Generation timed out. Try simplifying the prompt or retrying.',
  downstream_service_error: 'A downstream dependency failed while processing the request.',
  downstream_service_unavailable: 'A downstream service is currently unavailable. Please retry later.',
  content_policy_violation:
    'Your prompt was blocked by the safety filters. Please adjust it to follow the content policy.',
  image_too_small: 'The input image is too small for this model. Please upload a larger image.',
  image_too_large: 'The input image exceeds the maximum dimensions allowed by this model.',
  image_load_error: 'The image could not be downloaded or decoded. Check the URL or format.',
  file_download_error: 'FAL was unable to download one of the referenced files. Ensure it is public.',
  face_detection_error: 'No face was detected. Please upload an image with a clearly visible face.',
  file_too_large: 'The provided file is larger than the allowed size.',
  greater_than: 'One of the numeric inputs must be greater than the allowed threshold.',
  greater_than_equal: 'One of the numeric inputs must be greater than or equal to the allowed threshold.',
  less_than: 'One of the numeric inputs must be less than the allowed threshold.',
  less_than_equal: 'One of the numeric inputs must be less than or equal to the allowed threshold.',
  multiple_of: 'One of the numeric inputs must be a multiple of the required value.',
  sequence_too_short: 'One of the list inputs is shorter than the minimum length.',
  sequence_too_long: 'One of the list inputs exceeds the maximum allowed length.',
  one_of: 'One of the inputs contains a value that is not supported by this endpoint.',
  feature_not_supported: 'The requested feature combination is not supported by this model.',
  invalid_archive: 'The uploaded archive could not be processed. Ensure it is valid and supported.',
  archive_file_count_below_minimum:
    'The uploaded archive does not contain enough valid files. Please add more files and retry.',
  archive_file_count_exceeds_maximum:
    'The uploaded archive contains more files than allowed. Remove some files and retry.',
  audio_duration_too_long: 'The audio file duration exceeds the maximum allowed limit.',
  audio_duration_too_short: 'The audio file must be longer to be processed.',
  unsupported_audio_format: 'The audio format is not supported. Please convert it to a supported format.',
  unsupported_image_format: 'The image format is not supported. Please use jpg, png, jpeg, or webp.',
  unsupported_video_format: 'The video format is not supported. Please upload mp4, mov, or webm.',
  video_duration_too_long: 'The video duration exceeds the maximum allowed limit.',
  video_duration_too_short: 'The video must be longer to be processed.',
};

const BOOLEAN_STRINGS: Record<string, boolean> = {
  true: true,
  false: false,
};

const getHeaderValue = (headers: any, key: string): any => {
  if (!headers || typeof headers !== 'object') return undefined;
  if (headers[key] !== undefined) return headers[key];
  const lower = key.toLowerCase();
  if (headers[lower] !== undefined) return headers[lower];
  const upper = key.toUpperCase();
  if (headers[upper] !== undefined) return headers[upper];
  const matchedKey = Object.keys(headers).find((headerKey) => headerKey.toLowerCase() === lower);
  return matchedKey ? headers[matchedKey] : undefined;
};

const normalizeBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered in BOOLEAN_STRINGS) return BOOLEAN_STRINGS[lowered];
  }
  return undefined;
};

const parseData = (data: any) => {
  if (!data) return undefined;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  if (typeof data === 'object') {
    if (data instanceof Error) {
      return { message: data.message, stack: data.stack };
    }
    return data;
  }
  return data;
};

const extractDetails = (raw: any): FalErrorDetail[] => {
  if (!raw) return [];
  if (Array.isArray(raw.detail)) return raw.detail;
  if (Array.isArray(raw?.body?.detail)) return raw.body.detail;
  if (Array.isArray(raw)) return raw;
  return [];
};

const pickMessage = (
  detail: FalErrorDetail | undefined,
  raw: any,
  fallback?: string,
  typeHint?: string
): string => {
  const detailedMsg = detail?.msg || raw?.msg || raw?.message || raw?.error;
  const friendly = typeHint && FAL_ERROR_HINTS[typeHint];
  return friendly || detailedMsg || fallback || 'FAL request failed';
};

export const normalizeFalError = (
  err: any,
  options?: FalErrorOptions
): { message: string; status: number; data: Record<string, unknown> } => {
  const response = err?.response;
  const headers = response?.headers || {};
  const parsedData = parseData(response?.data || err?.data || err?.body || err);
  const detailArray = extractDetails(parsedData);
  const primaryDetail: FalErrorDetail | undefined = detailArray[0];
  const type =
    primaryDetail?.type ||
    parsedData?.type ||
    (typeof parsedData === 'string' ? undefined : undefined);
  const message = pickMessage(primaryDetail, parsedData, options?.fallbackMessage, type);
  const status =
    response?.status ||
    err?.status ||
    err?.statusCode ||
    options?.defaultStatus ||
    502;
  const retryable =
    normalizeBoolean(getHeaderValue(headers, 'x-fal-retryable')) ??
    normalizeBoolean(parsedData?.retryable);
  const requestId =
    parsedData?.request_id ||
    getHeaderValue(headers, 'x-fal-request-id') ||
    getHeaderValue(headers, 'x-request-id') ||
    response?.requestId ||
    err?.requestId;
  const url = primaryDetail?.url || parsedData?.url;

  const data: Record<string, unknown> = {
    provider: 'fal',
    context: options?.context,
    type,
    detail: detailArray,
    url,
    retryable,
    requestId,
    headers,
    input: primaryDetail?.input ?? parsedData?.input,
    toast: {
      type: 'error',
      title: options?.toastTitle || 'FAL request failed',
      message,
      retryable,
      docUrl: url,
    },
    raw: parsedData,
    ...options?.extraData,
  };

  return { message, status, data };
};

export const buildFalApiError = (err: any, options?: FalErrorOptions): ApiError => {
  const normalized = normalizeFalError(err, options);
  return new ApiError(normalized.message, normalized.status, normalized.data);
};

