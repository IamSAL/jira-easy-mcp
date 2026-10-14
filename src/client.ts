/**
 * Jira MCP Server - API Client Module
 * 
 * Low-level HTTP client for Jira REST API with authentication,
 * retry logic, timeout handling, and SSL configuration.
 */

import { getConfig } from './config.js';
import { logApiRequest, logApiResponse, logRetry } from './logger.js';
import type { JiraApiError } from './types.js';

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

export interface JiraBinaryResponse {
  data: string;
  mimeType: string;
  size: number;
  url: string;
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
    const text = await response.text();
    if (/<html|<!doctype/i.test(text)) {
      // Tomcat, proxies and login/CAPTCHA pages answer with HTML; keep just the gist
      const message = text.match(/<b>Message<\/b>\s*([^<]+)/i)?.[1]
        ?? text.match(/<title>([^<]+)<\/title>/i)?.[1];
      return message ? `HTTP ${response.status}: ${message.trim()}` : `HTTP ${response.status}`;
    }
    return text.slice(0, 500) || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
};

/**
 * Parse a successful response. Jira returns empty bodies for some writes
 * (e.g., 201 from POST /issueLink) without a Content-Length header.
 */
const parseSuccessResponse = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  if (text.trim() === '') {
    return undefined as T;
  }
  return JSON.parse(text) as T;
};

/**
 * Jira's REST API does not redirect; a 3xx means JIRA_BASE_URL is off
 * (http vs https, missing context path) or an SSO proxy wants a browser login.
 */
const redirectError = (response: Response): JiraApiException => {
  const location = response.headers.get('location') || '(no location)';
  return new JiraApiException(
    `Jira redirected to ${location}. Set JIRA_BASE_URL to the address Jira redirects to (check http vs https and the context path, e.g. /jira); a redirect to a login page means an SSO proxy is in front of Jira.`,
    response.status
  );
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
  const { baseUrl, timeout, retryCount, retryDelay } = getConfig();
  const url = `${baseUrl}/rest/api/2${endpoint}`;
  const method = options.method || 'GET';
  // A POST that timed out or hit a 5xx may still have been applied (e.g. a
  // created issue or link); retrying it would duplicate the write.
  const canRetry = (status?: number) => method !== 'POST' || status === 429;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Authorization': getAuthHeader(),
    ...(options.headers as Record<string, string> || {}),
  };

  // Let fetch set the multipart boundary for FormData bodies
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] ??= 'application/json';
  }

  // Build fetch options with SSL agent for Node.js
  const fetchOptions: RequestInit = {
    ...options,
    headers,
  };


  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      logApiRequest(method, url);
      const startTime = Date.now();

      const response = await fetch(url, {
        ...fetchOptions,
        // Following a redirect would turn POST into GET and drop the
        // Authorization header on an origin change; report it instead
        redirect: 'manual',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      logApiResponse(method, url, response.status, duration);

      if (response.status >= 300 && response.status < 400) {
        throw redirectError(response);
      }

      if (!response.ok) {
        const errorText = await parseErrorResponse(response);
        
        // Check if we should retry
        if (isRetryableError(response.status) && canRetry(response.status) && attempt < retryCount) {
          const delay = calculateBackoff(attempt, retryDelay);
          logRetry(attempt + 1, retryCount, `HTTP ${response.status}`, delay);
          await sleep(delay);
          continue;
        }
        
        if (response.status === 401) {
          throw new JiraApiException(
            'Authentication failed. Check JIRA_USERNAME and JIRA_PASSWORD (or the "JiraMCP" OS credential).',
            response.status
          );
        }
        if (response.status === 403) {
          // Jira sets this header when too many failed logins triggered a CAPTCHA
          const deniedReason = response.headers.get('x-authentication-denied-reason') || '';
          throw new JiraApiException(
            /captcha/i.test(deniedReason)
              ? 'Login blocked by CAPTCHA after failed attempts. Log in to Jira in a browser once to clear it, then retry.'
              : `Access forbidden: ${errorText}`,
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

      return parseSuccessResponse<T>(response);
      
    } catch (err) {
      clearTimeout(timeoutId);
      
      // Handle timeout/abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new JiraApiException(
          `Request timeout after ${timeout}ms`,
          0
        );
        
        if (canRetry() && attempt < retryCount) {
          const delay = calculateBackoff(attempt, retryDelay);
          logRetry(attempt + 1, retryCount, 'timeout', delay);
          await sleep(delay);
          continue;
        }
        throw lastError;
      }
      
      // Handle network errors (retryable)
      if (err instanceof TypeError && canRetry() && attempt < retryCount) {
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
 * Download a Jira attachment through the same authenticated session used for
 * REST API calls. Attachment URLs come from Jira's attachment metadata, but are
 * still restricted to the configured Jira origin and attachment path so this
 * helper cannot become an arbitrary authenticated URL fetcher.
 */
export const jiraDownloadAttachment = async (
  contentUrl: string,
  maxBytes: number
): Promise<JiraBinaryResponse> => {
  const { baseUrl, timeout } = getConfig();
  const base = new URL(baseUrl);
  const url = new URL(contentUrl, `${baseUrl}/`);
  const contextPath = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');
  const allowedPathPrefix = `${contextPath}/secure/attachment/`;

  if (url.origin !== base.origin || !url.pathname.startsWith(allowedPathPrefix)) {
    throw new JiraApiException(
      'Jira returned an attachment URL outside the configured attachment path.',
      0
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const fetchOptions: RequestInit = {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'Accept': 'image/*',
      'Authorization': getAuthHeader(),
    },
    signal: controller.signal,
  };


  try {
    logApiRequest('GET', url.toString());
    const startTime = Date.now();
    const response = await fetch(url, fetchOptions);
    logApiResponse('GET', url.toString(), response.status, Date.now() - startTime);

    if (!response.ok) {
      const errorText = await parseErrorResponse(response);
      throw new JiraApiException(
        `Could not download Jira attachment (${response.status}): ${errorText}`,
        response.status
      );
    }

    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > maxBytes) {
      throw new JiraApiException(
        `Jira attachment is ${declaredSize} bytes; the limit is ${maxBytes} bytes.`,
        0
      );
    }
    if (!response.body) {
      throw new JiraApiException('Jira attachment response had no body.', 0);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let readResult = await reader.read();

    while (!readResult.done) {
      const { value } = readResult;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new JiraApiException(
          `Jira attachment exceeded the ${maxBytes}-byte limit while downloading.`,
          0
        );
      }
      chunks.push(value);
      readResult = await reader.read();
    }

    const buffer = Buffer.concat(chunks, size);
    const mimeType = (response.headers.get('content-type') || 'application/octet-stream')
      .split(';')[0]
      .trim();

    return {
      data: buffer.toString('base64'),
      mimeType,
      size,
      url: url.toString(),
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new JiraApiException(`Attachment download timed out after ${timeout}ms`, 0);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Make authenticated request to Jira Agile REST API with retry and timeout.
 */
export const jiraAgileFetch = async <T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const { baseUrl, timeout, retryCount, retryDelay } = getConfig();
  const url = `${baseUrl}/rest/agile/1.0${endpoint}`;
  const method = options.method || 'GET';
  // A POST that timed out or hit a 5xx may still have been applied (e.g. a
  // created issue or link); retrying it would duplicate the write.
  const canRetry = (status?: number) => method !== 'POST' || status === 429;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': getAuthHeader(),
    ...(options.headers as Record<string, string> || {}),
  };

  // Build fetch options with SSL agent for Node.js
  const fetchOptions: RequestInit = {
    ...options,
    headers,
  };


  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      logApiRequest(method, url);
      const startTime = Date.now();

      const response = await fetch(url, {
        ...fetchOptions,
        // Following a redirect would turn POST into GET and drop the
        // Authorization header on an origin change; report it instead
        redirect: 'manual',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      logApiResponse(method, url, response.status, duration);

      if (response.status >= 300 && response.status < 400) {
        throw redirectError(response);
      }

      if (!response.ok) {
        const errorText = await parseErrorResponse(response);
        
        // Check if we should retry
        if (isRetryableError(response.status) && canRetry(response.status) && attempt < retryCount) {
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

      return parseSuccessResponse<T>(response);
      
    } catch (err) {
      clearTimeout(timeoutId);
      
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new JiraApiException(
          `Request timeout after ${timeout}ms`,
          0
        );
        
        if (canRetry() && attempt < retryCount) {
          const delay = calculateBackoff(attempt, retryDelay);
          logRetry(attempt + 1, retryCount, 'timeout', delay);
          await sleep(delay);
          continue;
        }
        throw lastError;
      }
      
      if (err instanceof TypeError && canRetry() && attempt < retryCount) {
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
 * Encode a caller-supplied value (issue key, comment ID, ...) as one URL path
 * segment. Trims whitespace agents sometimes add, and stops values like
 * "../myself" from reaching other endpoints.
 */
export const pathSegment = (value: string | number): string =>
  encodeURIComponent(String(value).trim());

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
 * POST multipart form data to Jira REST API v2 (e.g., attachment uploads).
 */
export const jiraPostForm = async <T = unknown>(endpoint: string, body: FormData): Promise<T> => {
  return jiraFetch<T>(endpoint, {
    method: 'POST',
    headers: { 'X-Atlassian-Token': 'no-check' },
    body,
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
