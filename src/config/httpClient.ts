import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

/**
 * Global HTTP client with timeout and retry configuration
 * 
 * CRITICAL: All external API calls MUST use this client to prevent hanging requests
 */

const DEFAULT_TIMEOUT = 420000; // 7 minutes
const DEFAULT_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Create axios instance with global timeout
 */
export const httpClient: AxiosInstance = axios.create({
  timeout: DEFAULT_TIMEOUT,
  headers: {
    'User-Agent': 'WildMind-AI/1.0',
  },
});

/**
 * Add request interceptor for logging (debug mode only)
 */
httpClient.interceptors.request.use(
  (config) => {
    if (process.env.HTTP_DEBUG === 'true') {
      console.log(`[HTTP] ${config.method?.toUpperCase()} ${config.url}`);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Add response interceptor for timeout handling
 */
httpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      console.error(`[HTTP TIMEOUT] ${error.config?.url} exceeded ${DEFAULT_TIMEOUT}ms`);
      error.message = `Request timed out after ${DEFAULT_TIMEOUT / 1000}s`;
    }
    return Promise.reject(error);
  }
);

/**
 * Create axios instance with custom timeout
 */
export function createHttpClient(config: AxiosRequestConfig): AxiosInstance {
  return axios.create({
    timeout: DEFAULT_TIMEOUT,
    ...config,
  });
}

/**
 * Fetch with timeout using AbortController
 * 
 * Usage:
 *   const response = await fetchWithTimeout('https://api.example.com', { timeout: 10000 });
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  attempts: number = DEFAULT_RETRY_ATTEMPTS,
  delayMs: number = RETRY_DELAY_MS
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (attempts <= 1) throw error;
    
    const delay = delayMs * (DEFAULT_RETRY_ATTEMPTS - attempts + 1);
    console.log(`[RETRY] Waiting ${delay}ms before retry (${attempts - 1} attempts remaining)`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return retryWithBackoff(fn, attempts - 1, delayMs);
  }
}
