/**
 * Jira MCP Server - Board Tools
 * 
 * Tools for Jira Agile boards (Scrum/Kanban).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jiraAgileGet } from '../client.js';
import { formatResponse } from '../config.js';
import { startToolCall, endToolCall, failToolCall } from '../logger.js';
import { toSimplifiedBoard } from '../transformers.js';
import type { JiraBoardsResult, JiraSearchResult, SimplifiedBoard } from '../types.js';
import { toSimplifiedSearchResult } from '../transformers.js';

/**
 * Get all agile boards.
 */
export const getBoards = async (
  projectKeyOrId?: string,
  type?: 'scrum' | 'kanban',
  startAt: number = 0,
  maxResults: number = 50
): Promise<{ boards: SimplifiedBoard[]; total: number; isLast: boolean }> => {
  const params = new URLSearchParams({
    startAt: startAt.toString(),
    maxResults: maxResults.toString(),
  });

  if (projectKeyOrId) params.set('projectKeyOrId', projectKeyOrId);
  if (type) params.set('type', type);

  const result = await jiraAgileGet<JiraBoardsResult>(`/board?${params}`);
  
  return {
    boards: result.values.map(toSimplifiedBoard),
    total: result.total,
    isLast: result.isLast,
  };
};

/**
 * Get issues on a board.
 */
export const getBoardIssues = async (
  boardId: number,
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

  const result = await jiraAgileGet<JiraSearchResult>(`/board/${boardId}/issue?${params}`);
  
  return {
    issues: toSimplifiedSearchResult(result).issues,
    total: result.total,
  };
};

/**
 * Get board configuration.
 */
export const getBoardConfiguration = async (boardId: number): Promise<unknown> => {
  return jiraAgileGet(`/board/${boardId}/configuration`);
};

/**
 * Register board tools with the MCP server.
 */
export const registerBoardTools = (server: McpServer): void => {
  // Get boards
  server.tool(
    'jira_get_boards',
    'List all Jira Agile boards (Scrum and Kanban). Boards organize issues for agile teams. Use this to find board IDs needed for jira_get_sprints or jira_get_board_issues. Can filter by project or board type.',
    {
      projectKey: z.string().optional().describe('Filter boards by project key (e.g., KP)'),
      type: z.enum(['scrum', 'kanban']).optional().describe('Filter by board type: scrum (has sprints) or kanban (continuous flow)'),
      startAt: z.number().min(0).default(0).describe('Starting index for pagination'),
      maxResults: z.number().min(1).max(100).default(50).describe('Maximum number of results'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_boards', args);
      try {
        const result = await getBoards(args.projectKey, args.type, args.startAt, args.maxResults);
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

  // Get board issues
  server.tool(
    'jira_get_board_issues',
    'Get all issues visible on a specific Jira Agile board. Returns issues in the board\'s backlog and active sprints. Can combine with JQL for additional filtering. Use jira_get_boards first to find the board ID.',
    {
      boardId: z.number().describe('Board ID (get from jira_get_boards)'),
      jql: z.string().optional().describe('Additional JQL filter to narrow results (e.g., "assignee = currentUser()")'),
      startAt: z.number().min(0).default(0).describe('Starting index for pagination'),
      maxResults: z.number().min(1).max(100).default(50).describe('Maximum number of results'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_board_issues', args);
      try {
        const result = await getBoardIssues(args.boardId, args.jql, args.startAt, args.maxResults);
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
};
