import { ApiError } from '../errorHandler';

// BFL HTTP Status Codes
export const BFL_HTTP_ERRORS: Record<number, { title: string; message: string }> = {
  400: { title: "Bad Request", message: "There was an issue with the format or content of the request. Please check your inputs." },
  401: { title: "Authentication Failed", message: "Invalid API key or authentication credentials." },
  402: { title: "Payment Required", message: "Insufficient credits or payment method issue. Please add credits to your BFL account." },
  403: { title: "Forbidden", message: "You do not have permission to access this resource or model." },
  404: { title: "Not Found", message: "The requested resource or task ID was not found." },
  422: { title: "Unprocessable Entity", message: "The request contained invalid parameters or data." },
  429: { title: "Too Many Requests", message: "Rate limit exceeded. Please try again in a moment." },
  500: { title: "Internal Server Error", message: "An unexpected error occurred on BFL servers. Please try again later." },
  503: { title: "Service Unavailable", message: "BFL service is temporarily unavailable due to high load or maintenance. Please retry shortly." },
  504: { title: "Gateway Timeout", message: "The request timed out waiting for a response from BFL." },
};

// BFL Response Statuses (for polling/results)
export const BFL_RESPONSE_STATUSES: Record<string, { title: string; message: string }> = {
  'Request Moderated': { title: "Request Moderated", message: "Your input prompt or image was flagged by the safety system." },
  'Content Moderated': { title: "Content Moderated", message: "The generated output was flagged by the safety system and cannot be displayed." },
  'Task not found': { title: "Task Not Found", message: "The specified task ID does not exist or has expired." },
  'Error': { title: "Generation Failed", message: "An error occurred during processing." },
  'Failed': { title: "Generation Failed", message: "The generation task failed." },
};

export interface BflErrorResponse {
  code: string;
  title: string;
  message: string;
  originalError: any;
}

export function mapBflError(error: any): BflErrorResponse {
  // Handle Axios/Network errors first
  if (error?.response) {
    const status = error.response.status;
    const data = error.response.data;
    
    // Check known HTTP status codes
    if (BFL_HTTP_ERRORS[status]) {
      const errInfo = BFL_HTTP_ERRORS[status];
      // Use specific message from API if available and user-friendly, otherwise use mapped message
      const apiMessage = data?.message || data?.error || data?.detail;
      return {
        code: `BFL_${status}`,
        title: errInfo.title,
        message: apiMessage && typeof apiMessage === 'string' ? apiMessage : errInfo.message,
        originalError: error
      };
    }
    
    return {
      code: `BFL_${status}`,
      title: "Provider Error",
      message: `BFL API returned status ${status}`,
      originalError: error
    };
  }

  // Handle Poll Result Status Errors (e.g. from pollForResults)
  if (typeof error === 'string' && BFL_RESPONSE_STATUSES[error]) {
    const info = BFL_RESPONSE_STATUSES[error];
    return {
      code: `BFL_STATUS_${error.toUpperCase().replace(/\s+/g, '_')}`,
      title: info.title,
      message: info.message,
      originalError: error
    };
  }
  
  // Handle Object-based status errors (from response body)
  const statusStr = error?.status;
  if (statusStr && BFL_RESPONSE_STATUSES[statusStr]) {
    const info = BFL_RESPONSE_STATUSES[statusStr];
    return {
      code: `BFL_STATUS_${statusStr.toUpperCase().replace(/\s+/g, '_')}`,
      title: info.title,
      message: error?.result?.message || error?.message || info.message,
      originalError: error
    };
  }
  
  // Special case for "Task not found" which might come as a message string or inside an object
  if (typeof error?.message === 'string' && error.message.includes('Task not found')) {
      return {
        code: 'BFL_TASK_NOT_FOUND',
        title: 'Task Not Found',
        message: 'The generation task could not be found or has expired.',
        originalError: error
      };
  }

  return {
    code: 'UNKNOWN_BFL_ERROR',
    title: 'Generation Failed',
    message: error?.message || 'An unexpected error occurred with the BFL generation.',
    originalError: error
  };
}
