import { ApiResponse, Pagination } from '../types/apiResponse';

export function formatApiResponse<T = any>(
  responseStatus: 'success' | 'error',
  message: string,
  data: T,
  pagination?: Pagination
): ApiResponse<T> {
  return {
    responseStatus,
    message,
    data,
    ...(pagination ? { pagination } : {})
  };
}
