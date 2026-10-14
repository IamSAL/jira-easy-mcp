/**
 * Jira MCP Server - Project Filter
 *
 * Enforces JIRA_PROJECTS_FILTER on tool arguments before any tool runs:
 * project keys and issue keys must belong to an allowed project, and JQL is
 * scoped to the allowed projects.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConfig } from './config.js';

const ISSUE_KEY_FIELDS = ['issueKey', 'inwardIssueKey', 'outwardIssueKey', 'parentKey'] as const;
// Tools whose optional `jql` narrows a board/sprint; scoping it adds a filter when absent
const JQL_SCOPED_TOOLS = new Set(['jira_search', 'jira_generate_filter_url', 'jira_get_board_issues', 'jira_get_sprint_issues']);

const deny = (what: string, allowed: string[]): never => {
  throw new Error(`${what} is outside the allowed projects (${allowed.join(', ')}) set by JIRA_PROJECTS_FILTER.`);
};

const checkIssueKey = (issueKey: string, allowed: string[]): void => {
  const match = issueKey.trim().match(/^([A-Za-z][A-Za-z0-9_]*)-\d+$/);
  if (!match) {
    throw new Error(`"${issueKey}" is not an issue key (e.g. ${allowed[0]}-123); issue IDs cannot be checked against JIRA_PROJECTS_FILTER.`);
  }
  if (!allowed.includes(match[1].toUpperCase())) deny(`Issue ${issueKey}`, allowed);
};

/**
 * Wrap a JQL query so it can only match the allowed projects, keeping any
 * trailing ORDER BY outside the parentheses.
 */
export const scopeJql = (jql: string | undefined, allowed: string[]): string => {
  const scope = `project in (${allowed.map(key => `"${key}"`).join(', ')})`;
  const query = (jql || '').trim();
  const orderBy = query.match(/\s*\border\s+by\b[\s\S]*$/i);
  const where = orderBy ? query.slice(0, orderBy.index).trim() : query;
  const scoped = where ? `${scope} AND (${where})` : scope;
  return orderBy ? `${scoped} ${orderBy[0].trim()}` : scoped;
};

/**
 * Validate and rewrite tool arguments against the project filter.
 * Throws when an argument points outside the allowed projects.
 */
export const applyProjectFilter = <T extends Record<string, unknown>>(toolName: string, args: T): T => {
  const allowed = getConfig().projectsFilter;
  if (!allowed || allowed.length === 0) return args;

  for (const field of ISSUE_KEY_FIELDS) {
    if (typeof args[field] === 'string') checkIssueKey(args[field] as string, allowed);
  }
  if (Array.isArray(args.issueKeys)) {
    for (const key of args.issueKeys) checkIssueKey(String(key), allowed);
  }
  if (typeof args.projectKey === 'string' && !allowed.includes(args.projectKey.trim().toUpperCase())) {
    deny(`Project ${args.projectKey}`, allowed);
  }
  if (JQL_SCOPED_TOOLS.has(toolName)) {
    return { ...args, jql: scopeJql(args.jql as string | undefined, allowed) };
  }
  return args;
};

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => unknown;

/**
 * Make every tool registered on `server` pass its arguments through
 * applyProjectFilter first. Call before registering tools.
 */
export const enforceProjectFilter = (server: McpServer): void => {
  const register = server.tool.bind(server) as (...params: unknown[]) => unknown;
  (server as unknown as { tool: (...params: unknown[]) => unknown }).tool = (...params: unknown[]) => {
    const name = params[0] as string;
    const handler = params.pop() as ToolHandler;
    return register(...params, (args: Record<string, unknown>, extra: unknown) =>
      handler(applyProjectFilter(name, args ?? {}), extra));
  };
};
