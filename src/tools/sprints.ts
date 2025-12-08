/**
 * Jira MCP Server - Sprint Tools
 * 
 * Tools for managing Scrum sprints.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jiraAgileGet, jiraAgilePost, jiraAgilePut } from '../client.js';
import { formatResponse } from '../config.js';
import { startToolCall, endToolCall, failToolCall } from '../logger.js';
import { toSimplifiedSprint, toSimplifiedSearchResult } from '../transformers.js';
import type { JiraSprintsResult, JiraSprint, JiraSearchResult, SimplifiedSprint } from '../types.js';

/**
 * Get sprints for a board.
 */
export const getSprintsFromBoard = async (
  boardId: number,
  state?: 'active' | 'future' | 'closed',
  startAt: number = 0,
  maxResults: number = 50
): Promise<{ sprints: SimplifiedSprint[]; total: number; isLast: boolean }> => {
  const params = new URLSearchParams({
    startAt: startAt.toString(),
    maxResults: maxResults.toString(),
  });

  if (state) params.set('state', state);

  const result = await jiraAgileGet<JiraSprintsResult>(`/board/${boardId}/sprint?${params}`);
  
  return {
    sprints: result.values.map(toSimplifiedSprint),
    total: result.total,
    isLast: result.isLast,
  };
};

/**
 * Get issues in a sprint.
 */
export const getSprintIssues = async (
  sprintId: number,
  jql?: string,
  startAt: number = 0,
  maxResults: number = 50
): Promise<{ issues: unknown[]; total: number }> => {
  const params = new URLSearchParams({
    startAt: startAt.toString(),
    maxResults: maxResults.toString(),
    fields: 'summary,status,priority,issuetype,assignee,reporter',
  });

  if (jql) params.set('jql', jql);

  const result = await jiraAgileGet<JiraSearchResult>(`/sprint/${sprintId}/issue?${params}`);
  
  return {
    issues: toSimplifiedSearchResult(result).issues,
    total: result.total,
  };
};

/**
 * Create a new sprint.
 */
export const createSprint = async (
  name: string,
  boardId: number,
  options?: {
    goal?: string;
    startDate?: string;
    endDate?: string;
  }
): Promise<JiraSprint> => {
  const body: Record<string, unknown> = {
    name,
    originBoardId: boardId,
  };

  if (options?.goal) body.goal = options.goal;
  if (options?.startDate) body.startDate = options.startDate;
  if (options?.endDate) body.endDate = options.endDate;

  return jiraAgilePost<JiraSprint>('/sprint', body);
};

/**
 * Update a sprint.
 */
export const updateSprint = async (
  sprintId: number,
  updates: {
    name?: string;
    goal?: string;
    startDate?: string;
    endDate?: string;
    state?: 'active' | 'future' | 'closed';
  }
): Promise<JiraSprint> => {
  const body: Record<string, unknown> = {};

  if (updates.name) body.name = updates.name;
  if (updates.goal !== undefined) body.goal = updates.goal;
  if (updates.startDate) body.startDate = updates.startDate;
  if (updates.endDate) body.endDate = updates.endDate;
  if (updates.state) body.state = updates.state;

  return jiraAgilePut<JiraSprint>(`/sprint/${sprintId}`, body);
};

/**
 * Move issues to a sprint.
 */
export const moveIssuesToSprint = async (
  sprintId: number,
  issueKeys: string[]
): Promise<void> => {
  await jiraAgilePost(`/sprint/${sprintId}/issue`, {
    issues: issueKeys,
  });
};

/**
 * Register sprint tools with the MCP server.
 */
export const registerSprintTools = (server: McpServer): void => {
  // Get sprints from board
  server.tool(
    'jira_get_sprints',
    'List all sprints for a Scrum board. Sprints are time-boxed iterations for completing work. Returns sprint names, goals, dates, and states. Use jira_get_boards first to find the board ID. Filter by state to see only active, future, or closed sprints.',
    {
      boardId: z.number().describe('Scrum board ID (get from jira_get_boards with type=scrum)'),
      state: z.enum(['active', 'future', 'closed']).optional().describe('Filter by sprint state: active (current), future (planned), closed (completed)'),
      startAt: z.number().min(0).default(0).describe('Starting index for pagination'),
      maxResults: z.number().min(1).max(100).default(50).describe('Maximum number of results'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_sprints', args);
      try {
        const result = await getSprintsFromBoard(args.boardId, args.state, args.startAt, args.maxResults);
        endToolCall(callLog, result);
        return {
          content: [{ type: 'text', text: formatResponse(result) }],
        };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Get sprint issues
  server.tool(
    'jira_get_sprint_issues',
    'Get all issues assigned to a specific sprint. Use this to see what work is planned or in progress for a sprint. Get sprint IDs from jira_get_sprints. Can add JQL filter for additional narrowing.',
    {
      sprintId: z.number().describe('Sprint ID (get from jira_get_sprints)'),
      jql: z.string().optional().describe('Additional JQL filter (e.g., "status = \"In Progress\"", "assignee = currentUser()")'),
      startAt: z.number().min(0).default(0).describe('Starting index for pagination'),
      maxResults: z.number().min(1).max(100).default(50).describe('Maximum number of results'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_sprint_issues', args);
      try {
        const result = await getSprintIssues(args.sprintId, args.jql, args.startAt, args.maxResults);
        endToolCall(callLog, result);
        return {
          content: [{ type: 'text', text: formatResponse(result) }],
        };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Create sprint
  server.tool(
    'jira_create_sprint',
    'Create a new sprint on a Scrum board for planning upcoming work. New sprints start in "future" state. Use jira_move_issues_to_sprint to add issues after creation. Dates should be in ISO format.',
    {
      name: z.string().describe('Sprint name (e.g., "Sprint 5", "January Sprint")'),
      boardId: z.number().describe('Scrum board ID where sprint will be created (get from jira_get_boards)'),
      goal: z.string().optional().describe('Sprint goal - what the team aims to achieve'),
      startDate: z.string().optional().describe('Sprint start date (ISO format: 2024-01-15T09:00:00.000Z)'),
      endDate: z.string().optional().describe('Sprint end date (ISO format: 2024-01-29T17:00:00.000Z)'),
    },
    async (args) => {
      const callLog = startToolCall('jira_create_sprint', args);
      try {
        const sprint = await createSprint(args.name, args.boardId, { goal: args.goal, startDate: args.startDate, endDate: args.endDate });
        const result = toSimplifiedSprint(sprint);
        endToolCall(callLog, result);
        return {
          content: [{ type: 'text', text: formatResponse(result) }],
        };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Update sprint
  server.tool(
    'jira_update_sprint',
    'Modify an existing sprint\'s name, goal, dates, or state. Change state to "active" to start a sprint, "closed" to complete it. Only fields you specify will be updated.',
    {
      sprintId: z.number().describe('Sprint ID to update (get from jira_get_sprints)'),
      name: z.string().optional().describe('New sprint name'),
      goal: z.string().optional().describe('New sprint goal'),
      startDate: z.string().optional().describe('New start date (ISO format)'),
      endDate: z.string().optional().describe('New end date (ISO format)'),
      state: z.enum(['active', 'future', 'closed']).optional().describe('New state: active (start sprint), closed (complete sprint), future (revert to planned)'),
    },
    async (args) => {
      const callLog = startToolCall('jira_update_sprint', args);
      try {
        const sprint = await updateSprint(args.sprintId, { name: args.name, goal: args.goal, startDate: args.startDate, endDate: args.endDate, state: args.state });
        const result = toSimplifiedSprint(sprint);
        endToolCall(callLog, result);
        return {
          content: [{ type: 'text', text: formatResponse(result) }],
        };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Move issues to sprint
  server.tool(
    'jira_move_issues_to_sprint',
    'Add/move one or more issues into a sprint for sprint planning. Issues will be removed from their current sprint (if any) and added to the specified sprint. Get sprint ID from jira_get_sprints.',
    {
      sprintId: z.number().describe('Target sprint ID (get from jira_get_sprints)'),
      issueKeys: z.array(z.string()).describe('Array of issue keys to move (e.g., ["KP-1", "KP-2", "KP-3"])'),
    },
    async (args) => {
      const callLog = startToolCall('jira_move_issues_to_sprint', args);
      try {
        await moveIssuesToSprint(args.sprintId, args.issueKeys);
        const result = { success: true, message: `Moved ${args.issueKeys.length} issue(s) to sprint ${args.sprintId}.` };
        endToolCall(callLog, result);
        return {
          content: [{ type: 'text', text: result.message }],
        };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );
};
