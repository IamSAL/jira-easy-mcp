/**
 * Jira MCP Server - API Client Module
 * 
 * Low-level HTTP client for Jira REST API with authentication,
 * retry logic, timeout handling, and SSL configuration.
 */

import https from 'node:https';
import { getConfig } from './config.js';
import { logApiRequest, logApiResponse, logRetry, warn } from './logger.js';
import type { JiraApiError } from './types.js';

// Custom HTTPS agent for SSL configuration (lazy initialized)
let httpsAgent: https.Agent | null = null;

/**
 * Get or create the HTTPS agent with SSL configuration.
 */
const getHttpsAgent = (): https.Agent => {
  if (!httpsAgent) {
    const { sslVerify } = getConfig();
    httpsAgent = new https.Agent({
      rejectUnauthorized: sslVerify,
    });
    if (!sslVerify) {
      warn('SSL verification disabled - connections may be insecure');
    }
  }
  return httpsAgent;
};

/**
 * Build Basic Auth header from credentials.
 */
const getAuthHeader = (): string => {
  const { username, password } = getConfig();
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${credentials}`;
};

/**
 * Custom error class for Jira API errors.
 */
export class JiraApiException extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorDetails?: JiraApiError
  ) {
    super(message);
    this.name = 'JiraApiException';
  }
}

/**
 * Parse error response from Jira API.
 */
const parseErrorResponse = async (response: Response): Promise<string> => {
  try {
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const errorData = (await response.json()) as JiraApiError;
      const messages = [
        ...(errorData.errorMessages || []),
        ...Object.entries(errorData.errors || {}).map(([k, v]) => `${k}: ${v}`),
      ];
      return messages.length > 0 ? messages.join('; ') : `HTTP ${response.status}`;
    }
    return await response.text() || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
};

/**
 * Check if an error is retryable.
 */
const isRetryableError = (status: number): boolean => {
  // Retry on rate limiting, server errors, and gateway errors
  return status === 429 || status === 502 || status === 503 || status === 504;
};

/**
 * Sleep for a given number of milliseconds.
 */
const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calculate exponential backoff delay.
 */
const calculateBackoff = (attempt: number, baseDelay: number): number => {
  // Exponential backoff with jitter: baseDelay * 2^attempt + random jitter
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelay;
  return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
};

/**
 * Make authenticated request to Jira REST API v2 with retry and timeout.
 */
export const jiraFetch = async <T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const { baseUrl, timeout, retryCount, retryDelay, sslVerify } = getConfig();
  const url = `${baseUrl}/rest/api/2${endpoint}`;
  const method = options.method || 'GET';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': getAuthHeader(),
    ...(options.headers as Record<string, string> || {}),
  };

  // Build fetch options with SSL agent for Node.js
  const fetchOptions: RequestInit & { dispatcher?: unknown } = {
    ...options,
    headers,
  };

  // Add SSL agent if we need to skip verification
  if (!sslVerify && url.startsWith('https://')) {
    // @ts-expect-error - Node.js fetch supports agent option
    fetchOptions.agent = getHttpsAgent();
  }

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      logApiRequest(method, url);
      const startTime = Date.now();

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      logApiResponse(method, url, response.status, duration);

      if (!response.ok) {
        const errorText = await parseErrorResponse(response);
        
        // Check if we should retry
        if (isRetryableError(response.status) && attempt < retryCount) {
          const delay = calculateBackoff(attempt, retryDelay);
          logRetry(attempt + 1, retryCount, `HTTP ${response.status}`, delay);
          await sleep(delay);
          continue;
        }
        
        if (response.status === 401) {
          throw new JiraApiException(
            'Authentication failed. Check your JIRA_USERNAME and JIRA_PASSWORD.',
            response.status
          );
        }
        if (response.status === 403) {
          throw new JiraApiException(
            'Access forbidden. CAPTCHA may be triggered - log in via browser first, or check permissions.',
            response.status
          );
        }
        if (response.status === 404) {
          throw new JiraApiException(
            `Resource not found: ${errorText}`,
            response.status
          );
        }
        if (response.status === 429) {
          throw new JiraApiException(
            'Rate limited by Jira. Please wait and try again.',
            response.status
          );
        }
        
        throw new JiraApiException(
          `Jira API error (${response.status}): ${errorText}`,
          response.status
        );
      }

      // Handle empty responses (e.g., 204 No Content)
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return undefined as T;
      }

      return response.json() as Promise<T>;
      
    } catch (err) {
      clearTimeout(timeoutId);
      
      // Handle timeout/abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new JiraApiException(
          `Request timeout after ${timeout}ms`,
          0
        );
        
        if (attempt < retryCount) {
          const delay = calculateBackoff(attempt, retryDelay);
          logRetry(attempt + 1, retryCount, 'timeout', delay);
          await sleep(delay);
          continue;
        }
        throw lastError;
      }
      
      // Handle network errors (retryable)
      if (err instanceof TypeError && attempt < retryCount) {
        const delay = calculateBackoff(attempt, retryDelay);
        logRetry(attempt + 1, retryCount, err.message, delay);
        await sleep(delay);
        lastError = err;
        continue;
      }
      
      throw err;
    }
  }

  throw lastError || new Error('Request failed after retries');
};

/**
 * Make authenticated request to Jira Agile REST API with retry and timeout.
 */
export const jiraAgileFetch = async <T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const { baseUrl, timeout, retryCount, retryDelay, sslVerify } = getConfig();
  const url = `${baseUrl}/rest/agile/1.0${endpoint}`;
  const method = options.method || 'GET';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': getAuthHeader(),
    ...(options.headers as Record<string, string> || {}),
  };

  // Build fetch options with SSL agent for Node.js
  const fetchOptions: RequestInit & { dispatcher?: unknown } = {
    ...options,
    headers,
  };

  // Add SSL agent if we need to skip verification
  if (!sslVerify && url.startsWith('https://')) {
    // @ts-expect-error - Node.js fetch supports agent option
    fetchOptions.agent = getHttpsAgent();
  }

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      logApiRequest(method, url);
      const startTime = Date.now();

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      logApiResponse(method, url, response.status, duration);

      if (!response.ok) {
        const errorText = await parseErrorResponse(response);
        
        // Check if we should retry
        if (isRetryableError(response.status) && attempt < retryCount) {
          const delay = calculateBackoff(attempt, retryDelay);
          logRetry(attempt + 1, retryCount, `HTTP ${response.status}`, delay);
          await sleep(delay);
          continue;
        }
        
        throw new JiraApiException(
          `Jira Agile API error (${response.status}): ${errorText}`,
          response.status
        );
      }

      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return undefined as T;
      }

      return response.json() as Promise<T>;
      
    } catch (err) {
      clearTimeout(timeoutId);
      
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new JiraApiException(
          `Request timeout after ${timeout}ms`,
          0
        );
        
        if (attempt < retryCount) {
          const delay = calculateBackoff(attempt, retryDelay);
          logRetry(attempt + 1, retryCount, 'timeout', delay);
          await sleep(delay);
          continue;
        }
        throw lastError;
      }
      
      if (err instanceof TypeError && attempt < retryCount) {
        const delay = calculateBackoff(attempt, retryDelay);
        logRetry(attempt + 1, retryCount, err.message, delay);
        await sleep(delay);
        lastError = err;
        continue;
      }
      
      throw err;
    }
  }

  throw lastError || new Error('Request failed after retries');
};

/**
 * Build URL query string from parameters.
 */
export const buildQueryString = (params: Record<string, string | number | boolean | undefined>): string => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value));
    }
  }
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
};

// =============================================================================
// Convenience Methods
// =============================================================================

/**
 * GET request to Jira REST API v2.
 */
export const jiraGet = async <T = unknown>(endpoint: string): Promise<T> => {
  return jiraFetch<T>(endpoint, { method: 'GET' });
};

/**
 * POST request to Jira REST API v2.
 */
export const jiraPost = async <T = unknown>(endpoint: string, body: unknown): Promise<T> => {
  return jiraFetch<T>(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

/**
 * PUT request to Jira REST API v2.
 */
export const jiraPut = async <T = unknown>(endpoint: string, body: unknown): Promise<T> => {
  return jiraFetch<T>(endpoint, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
};

/**
 * DELETE request to Jira REST API v2.
 */
export const jiraDelete = async <T = unknown>(endpoint: string): Promise<T> => {
  return jiraFetch<T>(endpoint, { method: 'DELETE' });
};

/**
 * GET request to Jira Agile REST API.
 */
export const jiraAgileGet = async <T = unknown>(endpoint: string): Promise<T> => {
  return jiraAgileFetch<T>(endpoint, { method: 'GET' });
};

/**
 * POST request to Jira Agile REST API.
 */
export const jiraAgilePost = async <T = unknown>(endpoint: string, body: unknown): Promise<T> => {
  return jiraAgileFetch<T>(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

/**
 * PUT request to Jira Agile REST API.
 */
export const jiraAgilePut = async <T = unknown>(endpoint: string, body: unknown): Promise<T> => {
  return jiraAgileFetch<T>(endpoint, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
};
