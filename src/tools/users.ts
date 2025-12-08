/**
 * Jira MCP Server - User Tools
 * 
 * Tools for getting user information.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jiraGet } from '../client.js';
import type { JiraUser } from '../types.js';

/**
 * Get current user (myself).
 */
export const getCurrentUser = async (): Promise<JiraUser> => {
  return jiraGet<JiraUser>('/myself');
};

/**
 * Get user by username.
 */
export const getUser = async (username: string): Promise<JiraUser> => {
  return jiraGet<JiraUser>(`/user?username=${encodeURIComponent(username)}`);
};

/**
 * Search for users.
 */
export const searchUsers = async (
  query: string,
  startAt: number = 0,
  maxResults: number = 50
): Promise<JiraUser[]> => {
  const params = new URLSearchParams({
    username: query,
    startAt: startAt.toString(),
    maxResults: maxResults.toString(),
  });

  return jiraGet<JiraUser[]>(`/user/search?${params}`);
};

/**
 * Get users assignable to a project.
 */
export const getAssignableUsers = async (
  projectKey: string,
  query?: string,
  startAt: number = 0,
  maxResults: number = 50
): Promise<JiraUser[]> => {
  const params = new URLSearchParams({
    project: projectKey,
    startAt: startAt.toString(),
    maxResults: maxResults.toString(),
  });

  if (query) params.set('username', query);

  return jiraGet<JiraUser[]>(`/user/assignable/search?${params}`);
};

/**
 * Simplify user data for response.
 */
const simplifyUser = (user: JiraUser) => ({
  key: user.key,
  name: user.name,
  displayName: user.displayName,
  emailAddress: user.emailAddress,
  active: user.active,
  timeZone: user.timeZone,
});

/**
 * Register user tools with the MCP server.
 */
export const registerUserTools = (server: McpServer): void => {
  // Get current user
  server.tool(
    'jira_get_myself',
    'Get profile information about the currently authenticated Jira user. Returns display name, email, username, timezone, and active status. Useful for verifying the connection and getting the current user\'s username for JQL queries like "assignee = currentUser()".',
    {},
    async () => {
      const user = await getCurrentUser();
      return {
        content: [{ type: 'text', text: JSON.stringify(simplifyUser(user), null, 2) }],
      };
    }
  );

  // Get user by username
  server.tool(
    'jira_get_user',
    'Look up a specific Jira user by their username. Returns display name, email, timezone, and active status. Use jira_search_users if you don\'t know the exact username.',
    {
      username: z.string().describe('Exact username to look up (e.g., "jsmith", "john.doe")'),
    },
    async ({ username }) => {
      const user = await getUser(username);
      return {
        content: [{ type: 'text', text: JSON.stringify(simplifyUser(user), null, 2) }],
      };
    }
  );

  // Search users
  server.tool(
    'jira_search_users',
    'Search for Jira users by name, username, or email. Use this to find usernames for assigning issues or filtering by assignee. Returns matching users with their display names and usernames.',
    {
      query: z.string().describe('Search text - matches against username, display name, and email'),
      startAt: z.number().min(0).default(0).describe('Starting index for pagination'),
      maxResults: z.number().min(1).max(100).default(50).describe('Maximum number of results'),
    },
    async ({ query, startAt, maxResults }) => {
      const users = await searchUsers(query, startAt, maxResults);
      return {
        content: [{ type: 'text', text: JSON.stringify(users.map(simplifyUser), null, 2) }],
      };
    }
  );

  // Get assignable users
  server.tool(
    'jira_get_assignable_users',
    'List users who can be assigned to issues in a specific project. Only users with the appropriate project permissions are returned. Use this before assigning issues to verify valid assignees.',
    {
      projectKey: z.string().describe('Project key to check assignable users for (e.g., KP)'),
      query: z.string().optional().describe('Optional filter to narrow results by name/username'),
      startAt: z.number().min(0).default(0).describe('Starting index for pagination'),
      maxResults: z.number().min(1).max(100).default(50).describe('Maximum number of results'),
    },
    async ({ projectKey, query, startAt, maxResults }) => {
      const users = await getAssignableUsers(projectKey, query, startAt, maxResults);
      return {
        content: [{ type: 'text', text: JSON.stringify(users.map(simplifyUser), null, 2) }],
      };
    }
  );
};
