/**
 * Jira MCP Server - Configuration Module
 * 
 * Handles environment variable loading, OS credential store fallback,
 * and configuration management.
 */

import type { JiraConfig, ResponseFormat, LogLevel } from './types.js';
import { setLogLevel } from './logger.js';
import { findWindowsCredential, type StoredCredential } from './windows-credentials.js';

/** Service name (macOS Keychain / libsecret) or target name (Windows) for stored credentials. */
const CREDENTIAL_SERVICE = 'JiraMCP';

let cachedConfig: JiraConfig | null = null;
let storedCredential: StoredCredential | null = null;

/**
 * Read credentials for CREDENTIAL_SERVICE from the OS credential store.
 * keytar is an optional native dependency; if it failed to install, this throws.
 */
const findStoredCredentials = async (): Promise<StoredCredential[]> => {
  if (process.platform === 'win32') {
    const credential = await findWindowsCredential(CREDENTIAL_SERVICE);
    return credential ? [credential] : [];
  }
  const { default: keytar } = await import('keytar');
  return keytar.findCredentials(CREDENTIAL_SERVICE);
};

/**
 * Resolve credentials before the first getConfig() call.
 * JIRA_USERNAME + JIRA_PASSWORD take precedence; the OS credential store is
 * only consulted when they are not both set.
 */
export const initializeConfig = async (): Promise<void> => {
  const { JIRA_USERNAME: envUsername, JIRA_PASSWORD: envPassword } = process.env;
  if (envUsername && envPassword) {
    return;
  }

  let credentials: StoredCredential[];
  try {
    credentials = await findStoredCredentials();
  } catch (err) {
    throw new Error(
      `Unable to read the "${CREDENTIAL_SERVICE}" OS credential store (${err instanceof Error ? err.message : String(err)}). Set JIRA_USERNAME and JIRA_PASSWORD instead.`
    );
  }

  const matching = envUsername
    ? credentials.filter(({ account }) => account === envUsername)
    : credentials;

  if (matching.length > 1) {
    throw new Error(
      `Multiple Jira credentials found for service "${CREDENTIAL_SERVICE}". Set JIRA_USERNAME to select an account or remove extra credentials.`
    );
  }
  if (matching.length === 0) {
    throw new Error(
      `No Jira credentials found. Set JIRA_USERNAME and JIRA_PASSWORD, or store a credential under "${CREDENTIAL_SERVICE}": on macOS a Keychain item with service "${CREDENTIAL_SERVICE}"; on Windows a Generic Credential (cmdkey /generic:${CREDENTIAL_SERVICE} /user:<username> /pass), since cmdkey /add creates a Domain credential whose password cannot be read.`
    );
  }

  storedCredential = matching[0];
};

/** Read a non-negative integer env var, falling back when unset or invalid (e.g. "3s"). */
const readInt = (name: string, fallback: number): number => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isNaN(value) || value < 0 ? fallback : value;
};

/**
 * Get Jira configuration from environment variables.
 * Caches the configuration for subsequent calls.
 */
export const getConfig = (): JiraConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) {
    throw new Error('Missing JIRA_BASE_URL environment variable');
  }
  
  const username = storedCredential?.account ?? process.env.JIRA_USERNAME;
  if (!username) {
    throw new Error('Missing JIRA_USERNAME environment variable');
  }

  const password = storedCredential?.password ?? process.env.JIRA_PASSWORD;
  if (!password) {
    throw new Error('Missing JIRA_PASSWORD environment variable');
  }

  // Optional: Project filter (comma-separated list of project keys)
  const projectsFilterStr = process.env.JIRA_PROJECTS_FILTER;
  const projectsFilter = projectsFilterStr
    ? projectsFilterStr.split(',').map(p => p.trim().toUpperCase()).filter(Boolean)
    : undefined;

  // Optional: Response format (JSON or TOON, default: JSON)
  const responseFormatStr = process.env.JIRA_RESPONSE_FORMAT?.toUpperCase();
  const responseFormat: ResponseFormat = responseFormatStr === 'TOON' ? 'TOON' : 'JSON';

  // Optional: Request timeout in milliseconds (default: 30000)
  const timeout = readInt('JIRA_TIMEOUT', 30000);

  // Optional: Number of retries for failed requests (default: 3)
  const retryCount = readInt('JIRA_RETRY_COUNT', 3);

  // Optional: Base delay between retries in ms (default: 1000)
  const retryDelay = readInt('JIRA_RETRY_DELAY', 1000);

  // Optional: SSL verification (default: true)
  const sslVerifyStr = process.env.JIRA_SSL_VERIFY?.toLowerCase();
  const sslVerify = sslVerifyStr !== 'false' && sslVerifyStr !== '0';
  if (!sslVerify) {
    // Node's fetch has no per-request TLS option; this process only talks to Jira
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  // Optional: Log level (default: INFO)
  const logLevelStr = process.env.JIRA_LOG_LEVEL?.toUpperCase() as LogLevel | undefined;
  const validLogLevels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
  const logLevel: LogLevel = validLogLevels.includes(logLevelStr as LogLevel) ? logLevelStr as LogLevel : 'INFO';

  // Optional: Cache TTL in seconds (default: 300 = 5 minutes)
  const cacheTtl = readInt('JIRA_CACHE_TTL', 300);

  // Set log level in logger
  setLogLevel(logLevel);

  cachedConfig = {
    baseUrl: baseUrl.replace(/\/$/, ''),
    username,
    password,
    projectsFilter,
    responseFormat,
    timeout,
    retryCount,
    retryDelay,
    sslVerify,
    logLevel,
    cacheTtl,
  };

  return cachedConfig;
};

/**
 * Validate configuration on startup.
 * Returns true if configuration is valid, throws error otherwise.
 */
export const validateConfig = (): boolean => {
  getConfig();
  return true;
};

/**
 * Clear cached configuration (useful for testing).
 */
export const clearConfigCache = (): void => {
  cachedConfig = null;
};

/**
 * Check if a project is allowed by the filter.
 * If no filter is configured, all projects are allowed.
 */
export const isProjectAllowed = (projectKey: string): boolean => {
  const config = getConfig();
  if (!config.projectsFilter || config.projectsFilter.length === 0) {
    return true;
  }
  return config.projectsFilter.includes(projectKey.toUpperCase());
};

/**
 * Convert object to TOON (Text Object-Oriented Notation) format.
 * TOON is a human-readable format that's more compact than JSON.
 */
const toToon = (obj: unknown, indent: number = 0): string => {
  const spaces = '  '.repeat(indent);
  
  if (obj === null || obj === undefined) {
    return 'null';
  }
  
  if (typeof obj === 'string') {
    return obj.includes('\n') ? `|\\n${obj.split('\n').map(line => spaces + '  ' + line).join('\n')}` : obj;
  }
  
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    if (obj.every(item => typeof item === 'string' || typeof item === 'number')) {
      return `[${obj.join(', ')}]`;
    }
    return obj.map(item => `${spaces}- ${toToon(item, indent + 1).trimStart()}`).join('\n');
  }
  
  if (typeof obj === 'object') {
    const entries = Object.entries(obj).filter(([_, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, value]) => {
        const valueStr = toToon(value, indent + 1);
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return `${spaces}${key}:\\n${valueStr}`;
        }
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
          return `${spaces}${key}:\\n${valueStr}`;
        }
        return `${spaces}${key}: ${valueStr}`;
      })
      .join('\n');
  }
  
  return String(obj);
};

/**
 * Format response data according to the configured format.
 * JSON: Standard JSON with 2-space indentation
 * TOON: Text Object-Oriented Notation - more human-readable
 */
export const formatResponse = (data: unknown): string => {
  const config = getConfig();
  
  if (config.responseFormat === 'TOON') {
    return toToon(data);
  }
  
  return JSON.stringify(data, null, 2);
};

/**
 * Default fields to retrieve when reading Jira issues.
 */
export const DEFAULT_READ_FIELDS = [
  'summary',
  'status',
  'priority',
  'issuetype',
  'assignee',
  'reporter',
  'created',
  'updated',
  'description',
  'labels',
  'components',
  'fixVersions',
  'resolution',
  'parent',
  'subtasks',
  'issuelinks',
  'duedate',
  'timetracking',
] as const;

/**
 * Minimal fields for search results.
 */
export const SEARCH_FIELDS = [
  'summary',
  'status',
  'priority',
  'issuetype',
  'assignee',
  'reporter',
  'created',
  'updated',
] as const;
