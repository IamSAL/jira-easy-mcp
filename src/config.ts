/**
 * Jira MCP Server - Configuration Module
 *
 * Handles OS credential loading, environment fallback, and configuration management.
 */

import type { JiraConfig, ResponseFormat, LogLevel } from "./types.js";
import { setLogLevel } from "./logger.js";
import keytar from "keytar";
import { findWindowsCredential } from "./windows-credentials.js";

let cachedConfig: JiraConfig | null = null;
let resolvedCredentials: { username: string; password: string } | null = null;

/**
 * Load credentials from the OS credential store, falling back to legacy env vars.
 */
export const initializeConfig = async (): Promise<void> => {
  if (resolvedCredentials || cachedConfig) {
    return;
  }

  const envUsername = process.env.JIRA_USERNAME;
  const envPassword = process.env.JIRA_PASSWORD;
  const hasEnvCredentials = Boolean(envUsername && envPassword);
  let storedCredentials: Awaited<ReturnType<typeof keytar.findCredentials>> =
    [];
  let credentialStoreUnavailable = false;

  try {
    if (process.platform === "win32") {
      const credential = await findWindowsCredential("JiraMCP");
      if (credential) {
        storedCredentials = [credential];
      }
    } else {
      storedCredentials = await keytar.findCredentials("JiraMCP");
    }
  } catch {
    credentialStoreUnavailable = true;
  }

  if (storedCredentials.length === 1) {
    resolvedCredentials = {
      username: storedCredentials[0].account,
      password: storedCredentials[0].password,
    };
    return;
  }

  if (storedCredentials.length > 1) {
    const matchingCredential = envUsername
      ? storedCredentials.find(({ account }) => account === envUsername)
      : undefined;

    if (matchingCredential) {
      resolvedCredentials = {
        username: matchingCredential.account,
        password: matchingCredential.password,
      };
      return;
    }

    if (!hasEnvCredentials) {
      throw new Error(
        'Multiple Jira credentials found for service "JiraMCP". Set JIRA_USERNAME to select an account or remove extra credentials.',
      );
    }
  }

  if (envUsername && envPassword) {
    resolvedCredentials = { username: envUsername, password: envPassword };
    return;
  }

  if (credentialStoreUnavailable) {
    throw new Error(
      "Unable to access the JiraMCP credential store. Provide both JIRA_USERNAME and JIRA_PASSWORD as legacy fallback variables.",
    );
  }

  throw new Error(
    'No Jira credentials found. On Windows, store a Generic Credential with target "JiraMCP" using cmdkey /generic:JiraMCP; cmdkey /add creates a Domain credential whose password is unavailable to this application. On macOS, use the "JiraMCP" Keychain item. You can also provide both JIRA_USERNAME and JIRA_PASSWORD as legacy fallback variables.',
  );
};

/**
 * Get Jira configuration after credential initialization.
 * Caches the configuration for subsequent calls.
 */
export const getConfig = (): JiraConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) {
    throw new Error("Missing JIRA_BASE_URL environment variable");
  }

  const username = resolvedCredentials?.username ?? process.env.JIRA_USERNAME;
  if (!username) {
    throw new Error("Missing Jira username");
  }

  const password = resolvedCredentials?.password ?? process.env.JIRA_PASSWORD;
  if (!password) {
    throw new Error("Missing Jira password");
  }

  // Optional: Project filter (comma-separated list of project keys)
  const projectsFilterStr = process.env.JIRA_PROJECTS_FILTER;
  const projectsFilter = projectsFilterStr
    ? projectsFilterStr
        .split(",")
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean)
    : undefined;

  // Optional: Response format (JSON or TOON, default: JSON)
  const responseFormatStr = process.env.JIRA_RESPONSE_FORMAT?.toUpperCase();
  const responseFormat: ResponseFormat =
    responseFormatStr === "TOON" ? "TOON" : "JSON";

  // Optional: Request timeout in milliseconds (default: 30000)
  const timeout = parseInt(process.env.JIRA_TIMEOUT || "30000", 10);

  // Optional: Number of retries for failed requests (default: 3)
  const retryCount = parseInt(process.env.JIRA_RETRY_COUNT || "3", 10);

  // Optional: Base delay between retries in ms (default: 1000)
  const retryDelay = parseInt(process.env.JIRA_RETRY_DELAY || "1000", 10);

  // Optional: SSL verification (default: true)
  const sslVerifyStr = process.env.JIRA_SSL_VERIFY?.toLowerCase();
  const sslVerify = sslVerifyStr !== "false" && sslVerifyStr !== "0";

  // Optional: Log level (default: INFO)
  const logLevelStr = process.env.JIRA_LOG_LEVEL?.toUpperCase() as
    | LogLevel
    | undefined;
  const validLogLevels: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];
  const logLevel: LogLevel = validLogLevels.includes(logLevelStr as LogLevel)
    ? (logLevelStr as LogLevel)
    : "INFO";

  // Optional: Cache TTL in seconds (default: 300 = 5 minutes)
  const cacheTtl = parseInt(process.env.JIRA_CACHE_TTL || "300", 10);

  // Set log level in logger
  setLogLevel(logLevel);

  cachedConfig = {
    baseUrl: baseUrl.replace(/\/$/, ""),
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
  resolvedCredentials = null;
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
  const spaces = "  ".repeat(indent);

  if (obj === null || obj === undefined) {
    return "null";
  }

  if (typeof obj === "string") {
    return obj.includes("\n")
      ? `|\\n${obj
          .split("\n")
          .map((line) => spaces + "  " + line)
          .join("\n")}`
      : obj;
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    if (
      obj.every((item) => typeof item === "string" || typeof item === "number")
    ) {
      return `[${obj.join(", ")}]`;
    }
    return obj
      .map((item, i) => `${spaces}- ${toToon(item, indent + 1).trimStart()}`)
      .join("\n");
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj).filter(
      ([_, v]) => v !== null && v !== undefined,
    );
    if (entries.length === 0) return "{}";
    return entries
      .map(([key, value]) => {
        const valueStr = toToon(value, indent + 1);
        if (
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value)
        ) {
          return `${spaces}${key}:\\n${valueStr}`;
        }
        if (
          Array.isArray(value) &&
          value.length > 0 &&
          typeof value[0] === "object"
        ) {
          return `${spaces}${key}:\\n${valueStr}`;
        }
        return `${spaces}${key}: ${valueStr}`;
      })
      .join("\n");
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

  if (config.responseFormat === "TOON") {
    return toToon(data);
  }

  return JSON.stringify(data, null, 2);
};

/**
 * Default fields to retrieve when reading Jira issues.
 */
export const DEFAULT_READ_FIELDS = [
  "summary",
  "status",
  "priority",
  "issuetype",
  "assignee",
  "reporter",
  "created",
  "updated",
  "description",
  "labels",
  "components",
  "fixVersions",
  "resolution",
  "parent",
  "subtasks",
  "issuelinks",
  "duedate",
  "timetracking",
] as const;

/**
 * Minimal fields for search results.
 */
export const SEARCH_FIELDS = [
  "summary",
  "status",
  "priority",
  "issuetype",
  "assignee",
  "reporter",
  "created",
  "updated",
] as const;
