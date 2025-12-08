#!/usr/bin/env node
/**
 * Jira MCP Server
 * 
 * A comprehensive MCP server for Jira integration using REST API with Basic Authentication.
 * 
 * Environment variables:
 *   JIRA_BASE_URL        - Jira instance URL (e.g., https://your-jira.com)
 *   JIRA_USERNAME        - Jira username
 *   JIRA_PASSWORD        - Jira password (or API token for Jira Cloud)
 *   JIRA_PROJECTS_FILTER - Optional: Comma-separated project keys to limit access
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { validateConfig, getConfig } from './config.js';
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
} catch (error) {
  console.error('Configuration error:', error instanceof Error ? error.message : error);
  process.exit(1);
}

// Create MCP server
const server = new McpServer({
  name: 'jira-basic-mcp',
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
  console.error(`Jira MCP Server starting...`);
  console.error(`  Base URL: ${config.baseUrl}`);
  console.error(`  Username: ${config.username}`);
  if (config.projectsFilter) {
    console.error(`  Projects Filter: ${config.projectsFilter.join(', ')}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Jira MCP Server connected via stdio');
};

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
