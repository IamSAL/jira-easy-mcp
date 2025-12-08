/**
 * Jira MCP Server - Worklog Tools
 * 
 * Tools for managing worklogs (time tracking).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jiraGet, jiraPost, jiraDelete } from '../client.js';
import { formatResponse } from '../config.js';
import { startToolCall, endToolCall, failToolCall } from '../logger.js';
import type { JiraWorklog, CreateWorklogResponse } from '../types.js';

interface WorklogsResult {
  startAt: number;
  maxResults: number;
  total: number;
  worklogs: JiraWorklog[];
}

/**
 * Get worklogs for an issue.
 */
export const getWorklogs = async (
  issueKey: string,
  startAt: number = 0,
  maxResults: number = 50
): Promise<WorklogsResult> => {
  const params = new URLSearchParams({
    startAt: startAt.toString(),
    maxResults: maxResults.toString(),
  });

  return jiraGet<WorklogsResult>(`/issue/${issueKey}/worklog?${params}`);
};

/**
 * Add a worklog to an issue.
 */
export const addWorklog = async (
  issueKey: string,
  timeSpent: string,
  options?: {
    comment?: string;
    started?: string;
    adjustEstimate?: 'auto' | 'leave' | 'new' | 'manual';
    newEstimate?: string;
    reduceBy?: string;
  }
): Promise<CreateWorklogResponse> => {
  const body: Record<string, unknown> = {
    timeSpent,
  };

  if (options?.comment) body.comment = options.comment;
  if (options?.started) body.started = options.started;

  // Build query params for estimate adjustment
  const params = new URLSearchParams();
  if (options?.adjustEstimate) {
    params.set('adjustEstimate', options.adjustEstimate);
    if (options.adjustEstimate === 'new' && options.newEstimate) {
      params.set('newEstimate', options.newEstimate);
    }
    if (options.adjustEstimate === 'manual' && options.reduceBy) {
      params.set('reduceBy', options.reduceBy);
    }
  }

  const queryString = params.toString();
  const endpoint = `/issue/${issueKey}/worklog${queryString ? `?${queryString}` : ''}`;

  return jiraPost<CreateWorklogResponse>(endpoint, body);
};

/**
 * Delete a worklog.
 */
export const deleteWorklog = async (
  issueKey: string,
  worklogId: string,
  adjustEstimate?: 'auto' | 'leave' | 'new' | 'manual',
  newEstimate?: string,
  increaseBy?: string
): Promise<void> => {
  const params = new URLSearchParams();
  if (adjustEstimate) {
    params.set('adjustEstimate', adjustEstimate);
    if (adjustEstimate === 'new' && newEstimate) {
      params.set('newEstimate', newEstimate);
    }
    if (adjustEstimate === 'manual' && increaseBy) {
      params.set('increaseBy', increaseBy);
    }
  }

  const queryString = params.toString();
  const endpoint = `/issue/${issueKey}/worklog/${worklogId}${queryString ? `?${queryString}` : ''}`;

  await jiraDelete(endpoint);
};

/**
 * Register worklog tools with the MCP server.
 */
export const registerWorklogTools = (server: McpServer): void => {
  // Get worklogs
  server.tool(
    'jira_get_worklogs',
    'Retrieve all time tracking entries (worklogs) for a Jira issue. Shows who logged time, how much, when, and optional work descriptions. Useful for time reporting, billing, or understanding effort spent on an issue.',
    {
      issueKey: z.string().describe('Issue key to get time entries for (e.g., KP-123)'),
      startAt: z.number().min(0).default(0).describe('Starting index for pagination'),
      maxResults: z.number().min(1).max(100).default(50).describe('Maximum number of worklogs to return'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_worklogs', args);
      try {
        const result = await getWorklogs(args.issueKey, args.startAt, args.maxResults);
        
        // Simplify the response
        const simplified = {
          total: result.total,
          startAt: result.startAt,
          maxResults: result.maxResults,
          worklogs: result.worklogs.map(w => ({
            id: w.id,
            author: w.author.displayName,
            started: w.started,
            timeSpent: w.timeSpent,
            timeSpentSeconds: w.timeSpentSeconds,
            comment: w.comment,
            created: w.created,
            updated: w.updated,
          })),
        };

        endToolCall(callLog, simplified);
        return {
          content: [{ type: 'text', text: formatResponse(simplified) }],
        };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Add worklog
  server.tool(
    'jira_add_worklog',
    'Log time spent working on a Jira issue. Time format examples: "2h" (2 hours), "30m" (30 minutes), "1d" (1 day), "2h 30m" (2.5 hours). Optionally adjust the remaining estimate automatically or manually.',
    {
      issueKey: z.string().describe('Issue key to log time on (e.g., KP-123)'),
      timeSpent: z.string().describe('Time spent in Jira format: "2h" (hours), "30m" (minutes), "1d" (day), "1w" (week), or combined "2h 30m"'),
      comment: z.string().optional().describe('Description of work performed'),
      started: z.string().optional().describe('When the work was done (ISO format). Defaults to current time if not specified.'),
      adjustEstimate: z.enum(['auto', 'leave', 'new', 'manual']).optional().describe('How to adjust remaining estimate: auto (reduce by timeSpent), leave (don\'t change), new (set specific value), manual (reduce by specific amount)'),
    },
    async (args) => {
      const callLog = startToolCall('jira_add_worklog', args);
      try {
        const result = await addWorklog(args.issueKey, args.timeSpent, {
          comment: args.comment,
          started: args.started,
          adjustEstimate: args.adjustEstimate,
        });
        endToolCall(callLog, result);
        return {
          content: [{ type: 'text', text: `Worklog added successfully. Worklog ID: ${result.id}, Time logged: ${result.timeSpent}` }],
        };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Delete worklog
  server.tool(
    'jira_delete_worklog',
    'Remove a time entry (worklog) from a Jira issue. Get the worklog ID from jira_get_worklogs. Can optionally adjust the remaining estimate when removing the logged time.',
    {
      issueKey: z.string().describe('Issue key containing the worklog (e.g., KP-123)'),
      worklogId: z.string().describe('Worklog ID to delete (get from jira_get_worklogs)'),
      adjustEstimate: z.enum(['auto', 'leave', 'new', 'manual']).optional().describe('How to adjust remaining estimate after deletion: auto (increase by deleted time), leave (don\'t change)'),
    },
    async (args) => {
      const callLog = startToolCall('jira_delete_worklog', args);
      try {
        await deleteWorklog(args.issueKey, args.worklogId, args.adjustEstimate);
        const result = { success: true, message: `Worklog ${args.worklogId} deleted successfully.` };
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
