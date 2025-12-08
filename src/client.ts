/**
 * Jira MCP Server - API Client Module
 * 
 * Low-level HTTP client for Jira REST API with authentication.
 */

import { getConfig } from './config.js';
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
 * Make authenticated request to Jira REST API v2.
 */
export const jiraFetch = async <T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const { baseUrl } = getConfig();
  const url = `${baseUrl}/rest/api/2${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': getAuthHeader(),
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await parseErrorResponse(response);
    
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
};

/**
 * Make authenticated request to Jira Agile REST API.
 */
export const jiraAgileFetch = async <T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const { baseUrl } = getConfig();
  const url = `${baseUrl}/rest/agile/1.0${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': getAuthHeader(),
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await parseErrorResponse(response);
    throw new JiraApiException(
      `Jira Agile API error (${response.status}): ${errorText}`,
      response.status
    );
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return response.json() as Promise<T>;
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
