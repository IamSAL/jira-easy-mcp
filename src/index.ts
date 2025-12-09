#!/usr/bin/env node
/**
 * Jira MCP Server
 * 
 * A comprehensive MCP server for Jira integration using REST API with Basic Authentication.
 * 
 * Environment variables:
 *   JIRA_BASE_URL          - Jira instance URL (e.g., https://your-jira.com)
 *   JIRA_USERNAME          - Jira username
 *   JIRA_PASSWORD          - Jira password (or API token for Jira Cloud)
 *   JIRA_PROJECTS_FILTER   - Optional: Comma-separated project keys to limit access
 *   JIRA_RESPONSE_FORMAT   - Optional: Response format - JSON (default) or TOON
 *   JIRA_TIMEOUT           - Optional: Request timeout in ms (default: 30000)
 *   JIRA_RETRY_COUNT       - Optional: Number of retries for failed requests (default: 3)
 *   JIRA_RETRY_DELAY       - Optional: Base delay between retries in ms (default: 1000)
 *   JIRA_SSL_VERIFY        - Optional: Verify SSL certificates (default: true)
 *   JIRA_LOG_LEVEL         - Optional: Log level - DEBUG, INFO, WARN, ERROR (default: INFO)
 *   JIRA_CACHE_TTL         - Optional: Cache TTL in seconds (default: 300)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { validateConfig, getConfig } from './config.js';
import { info, error as logError } from './logger.js';
import {
  registerIssueTools,
  registerCommentTools,
  registerTransitionTools,
  registerProjectTools,
  registerBoardTools,
  registerSprintTools,
  registerWorklogTools,
  registerLinkTools,
  registerUserTools,
  registerFieldTools,
} from './tools/index.js';

// Validate configuration early
try {
  validateConfig();
} catch (err) {
  logError('Configuration error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}

// Create MCP server
const server = new McpServer({
  name: 'jira-easy-mcp',
  version: '1.1.0',
});

// Register all tools
registerIssueTools(server);
registerCommentTools(server);
registerTransitionTools(server);
registerProjectTools(server);
registerBoardTools(server);
registerSprintTools(server);
registerWorklogTools(server);
registerLinkTools(server);
registerUserTools(server);
registerFieldTools(server);

// Start the server
const main = async (): Promise<void> => {
  const config = getConfig();
  
  info('Jira MCP Server starting...', {
    baseUrl: config.baseUrl,
    username: config.username,
    projectsFilter: config.projectsFilter?.join(', ') || 'none',
    responseFormat: config.responseFormat,
    timeout: `${config.timeout}ms`,
    retryCount: config.retryCount,
    sslVerify: config.sslVerify,
    logLevel: config.logLevel,
    cacheTtl: `${config.cacheTtl}s`,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  info('Jira MCP Server connected via stdio');
};

main().catch((err) => {
  logError('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
