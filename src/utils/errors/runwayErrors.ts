/**
 * Runway Error Codes and User-Friendly Messages
 * Based on provided documentation
 */

export interface RunwayErrorResponse {
  code: string;
  message: string;
  title: string;
  originalError?: any;
}

export const RUNWAY_ERROR_TITLES: Record<string, string> = {
  '400': 'Invalid Request',
  '401': 'Authentication Failed',
  '404': 'Resource Not Found',
  '405': 'Method Not Allowed',
  '429': 'Rate Limit Exceeded',
  '500': 'Runway System Error',
  '502': 'Service Overloaded',
  '503': 'Service Unavailable',
  '504': 'Generation Timeout',
  'moderation': 'Moderation Error',
};

export const RUNWAY_ERROR_MESSAGES: Record<string, string> = {
  '400': 'There is a problem with your input. Please check your request parameters and assets.',
  '401': 'Authentication with Runway failed. Please contact support.',
  '404': 'The requested resource could not be found.',
  '405': 'This operation is not supported.',
  '429': 'We are making too many requests to Runway. Please try again in a moment.',
  '500': 'Runway encountered an internal system error. Please retry later.',
  '502': 'Runway is currently shedding load. Please try again shortly.',
  '503': 'Runway service is currently unavailable. Please try again later.',
  '504': 'The generation took too long or Runway is overloaded. Please try again.',
};

export function mapRunwayError(error: any): RunwayErrorResponse {
  // Check for HTTP Status Codes
  const status = error?.status || error?.statusCode || error?.response?.status;
  
  if (status) {
    const statusStr = String(status);
    if (RUNWAY_ERROR_TITLES[statusStr]) {
      // Special handling for 400 with specific moderation/input messages
      let message = RUNWAY_ERROR_MESSAGES[statusStr];
      let title = RUNWAY_ERROR_TITLES[statusStr];
      let code = `HTTP_${status}`;

      // Check if it's a moderation error (Runway returns "failure" or "failureCode" in some cases, often masked as 400 or successful-but-failed-status)
      const errorBody = error?.response?.data || error?.body || error?.error;
      const isModeration = JSON.stringify(errorBody || '').toLowerCase().includes('moderation');
      
      if (isModeration) {
        title = 'Safety Check Failed';
        message = 'Your content was flagged by Runway moderation filters. Please modify your prompt or input.';
        code = 'MODERATION_FAILURE';
      } else if (status === 400 && errorBody?.error) {
        // Use specific error message if available and safe
        message = typeof errorBody.error === 'string' ? errorBody.error : message;
      }

      return {
        code,
        title,
        message,
        originalError: error
      };
    }
  }
  
  // Handling specific SDK or generic errors
  const errorMessage = error?.message || '';
  
  if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
    return {
      code: 'TIMEOUT',
      title: 'Connection Timeout',
      message: 'The connection to Runway timed out. Please check your internet or try again.',
      originalError: error
    };
  }

  return {
    code: 'UNKNOWN_RUNWAY_ERROR',
    title: 'Runway Error',
    message: errorMessage || 'An unexpected error occurred with Runway.',
    originalError: error
  };
}
