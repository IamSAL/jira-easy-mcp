/**
 * Jira MCP Server - Logger Module
 * 
 * Structured logging for MCP tool calls and operations.
 * Uses stderr for all output (MCP protocol uses stdout).
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogContext {
  tool?: string;
  duration?: string | number;
  [key: string]: unknown;
}

interface ToolCallLog {
  tool: string;
  input: Record<string, unknown>;
  startTime: number;
}

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

const levelColors: Record<LogLevel, string> = {
  DEBUG: colors.gray,
  INFO: colors.cyan,
  WARN: colors.yellow,
  ERROR: colors.red,
};

const levelIcons: Record<LogLevel, string> = {
  DEBUG: '🔍',
  INFO: 'ℹ️ ',
  WARN: '⚠️ ',
  ERROR: '❌',
};

// Default log level - can be overridden by JIRA_LOG_LEVEL
let currentLogLevel: LogLevel = 'INFO';

const logLevelPriority: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Set the current log level.
 */
export const setLogLevel = (level: LogLevel): void => {
  currentLogLevel = level;
};

/**
 * Get the current log level.
 */
export const getLogLevel = (): LogLevel => currentLogLevel;

/**
 * Check if a message at the given level should be logged.
 */
const shouldLog = (level: LogLevel): boolean => {
  return logLevelPriority[level] >= logLevelPriority[currentLogLevel];
};

/**
 * Format a timestamp for logging.
 */
const formatTimestamp = (): string => {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace('Z', '');
};

/**
 * Truncate a value for display in logs.
 */
const truncateValue = (value: unknown, maxLength: number = 200): string => {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str && str.length > maxLength) {
    return str.substring(0, maxLength) + `... (${str.length - maxLength} more chars)`;
  }
  return str || '';
};

/**
 * Format log context for display.
 */
const formatContext = (context?: LogContext): string => {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }
  const parts = Object.entries(context)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${truncateValue(v, 100)}`);
  return parts.length > 0 ? ` ${colors.dim}[${parts.join(', ')}]${colors.reset}` : '';
};

/**
 * Main log function.
 */
const log = (level: LogLevel, message: string, context?: LogContext): void => {
  if (!shouldLog(level)) {
    return;
  }

  const timestamp = formatTimestamp();
  const color = levelColors[level];
  const icon = levelIcons[level];
  
  const output = `${colors.dim}${timestamp}${colors.reset} ${color}${icon} ${level.padEnd(5)}${colors.reset} ${message}${formatContext(context)}`;
  
  console.error(output);
};

/**
 * Log a debug message.
 */
export const debug = (message: string, context?: LogContext): void => {
  log('DEBUG', message, context);
};

/**
 * Log an info message.
 */
export const info = (message: string, context?: LogContext): void => {
  log('INFO', message, context);
};

/**
 * Log a warning message.
 */
export const warn = (message: string, context?: LogContext): void => {
  log('WARN', message, context);
};

/**
 * Log an error message.
 */
export const error = (message: string, context?: LogContext): void => {
  log('ERROR', message, context);
};

/**
 * Start tracking a tool call.
 */
export const startToolCall = (tool: string, input: Record<string, unknown>): ToolCallLog => {
  const sanitizedInput = { ...input };
  // Don't log passwords or sensitive data
  if ('password' in sanitizedInput) {
    sanitizedInput.password = '***';
  }
  
  info(`${colors.bright}→ ${tool}${colors.reset}`, { input: sanitizedInput });
  
  return {
    tool,
    input: sanitizedInput,
    startTime: Date.now(),
  };
};

/**
 * Log successful completion of a tool call.
 */
export const endToolCall = (callLog: ToolCallLog, result: unknown): void => {
  const duration = Date.now() - callLog.startTime;
  const resultSummary = summarizeResult(result);
  
  info(
    `${colors.green}${colors.bright}✓ ${callLog.tool}${colors.reset} ${colors.dim}completed${colors.reset}`,
    { duration: `${duration}ms`, result: resultSummary }
  );
};

/**
 * Log failed tool call.
 */
export const failToolCall = (callLog: ToolCallLog, err: unknown): void => {
  const duration = Date.now() - callLog.startTime;
  const errorMessage = err instanceof Error ? err.message : String(err);
  
  error(
    `${colors.red}${colors.bright}✗ ${callLog.tool}${colors.reset} ${colors.dim}failed${colors.reset}`,
    { duration: `${duration}ms`, error: errorMessage }
  );
};

/**
 * Summarize a result for logging.
 */
const summarizeResult = (result: unknown): string => {
  if (result === null || result === undefined) {
    return 'null';
  }
  
  if (typeof result === 'string') {
    return truncateValue(result, 100);
  }
  
  if (Array.isArray(result)) {
    return `Array(${result.length})`;
  }
  
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    // Handle common patterns
    if ('issues' in obj && Array.isArray(obj.issues)) {
      return `${(obj.issues as unknown[]).length} issues`;
    }
    if ('total' in obj && typeof obj.total === 'number') {
      return `total: ${obj.total}`;
    }
    if ('key' in obj) {
      return `key: ${obj.key}`;
    }
    if ('id' in obj) {
      return `id: ${obj.id}`;
    }
    const keys = Object.keys(obj);
    return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
  }
  
  return String(result);
};

/**
 * Log an API request (for debug level).
 */
export const logApiRequest = (method: string, url: string): void => {
  debug(`${colors.magenta}⇒ ${method}${colors.reset} ${url}`);
};

/**
 * Log an API response (for debug level).
 */
export const logApiResponse = (method: string, url: string, status: number, duration: number): void => {
  const statusColor = status >= 200 && status < 300 ? colors.green : 
                      status >= 400 ? colors.red : colors.yellow;
  debug(`${colors.magenta}⇐ ${method}${colors.reset} ${url} ${statusColor}${status}${colors.reset}`, { duration: `${duration}ms` });
};

/**
 * Log a cache hit.
 */
export const logCacheHit = (key: string): void => {
  debug(`${colors.cyan}⚡ Cache hit${colors.reset}`, { key });
};

/**
 * Log a cache miss.
 */
export const logCacheMiss = (key: string): void => {
  debug(`${colors.yellow}○ Cache miss${colors.reset}`, { key });
};

/**
 * Log retry attempt.
 */
export const logRetry = (attempt: number, maxAttempts: number, reason: string, delay: number): void => {
  warn(`Retry ${attempt}/${maxAttempts}`, { reason, delay: `${delay}ms` });
};

/**
 * Create a logger namespace for a specific component.
 */
export const createLogger = (namespace: string) => ({
  debug: (message: string, context?: LogContext) => debug(`[${namespace}] ${message}`, context),
  info: (message: string, context?: LogContext) => info(`[${namespace}] ${message}`, context),
  warn: (message: string, context?: LogContext) => warn(`[${namespace}] ${message}`, context),
  error: (message: string, context?: LogContext) => error(`[${namespace}] ${message}`, context),
});

// Default export for convenience
export default {
  debug,
  info,
  warn,
  error,
  setLogLevel,
  getLogLevel,
  startToolCall,
  endToolCall,
  failToolCall,
  logApiRequest,
  logApiResponse,
  logCacheHit,
  logCacheMiss,
  logRetry,
  createLogger,
};
