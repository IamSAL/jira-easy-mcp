/**
 * Jira MCP Server - Transition Tools
 * 
 * Tools for getting and executing issue transitions.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jiraGet, jiraPost } from '../client.js';
import { toSimplifiedTransition } from '../transformers.js';
import type { JiraTransitionsResult, SimplifiedTransition } from '../types.js';

/**
 * Get available transitions for an issue.
 */
export const getTransitions = async (issueKey: string): Promise<SimplifiedTransition[]> => {
  const result = await jiraGet<JiraTransitionsResult>(`/issue/${issueKey}/transitions?expand=transitions.fields`);
  return result.transitions.map(toSimplifiedTransition);
};

/**
 * Transition an issue to a new status.
 */
export const transitionIssue = async (
  issueKey: string,
  transitionId: string,
  comment?: string,
  fields?: Record<string, unknown>
): Promise<void> => {
  const body: Record<string, unknown> = {
    transition: { id: transitionId },
  };

  if (comment) {
    body.update = {
      comment: [{ add: { body: comment } }],
    };
  }

  if (fields) {
    body.fields = fields;
  }

  await jiraPost(`/issue/${issueKey}/transitions`, body);
};

/**
 * Register transition tools with the MCP server.
 */
export const registerTransitionTools = (server: McpServer): void => {
  // Get available transitions
  server.tool(
    'jira_get_transitions',
    'List the available workflow transitions (status changes) for an issue. Returns transition IDs and names like "Start Progress", "Resolve", "Close". The available transitions depend on the issue\'s current status and your workflow configuration. ALWAYS call this before jira_transition_issue to get valid transition IDs.',
    {
      issueKey: z.string().describe('Issue key to check transitions for (e.g., KP-123)'),
    },
    async ({ issueKey }) => {
      const transitions = await getTransitions(issueKey);
      return {
        content: [{ type: 'text', text: JSON.stringify(transitions, null, 2) }],
      };
    }
  );

  // Transition issue
  server.tool(
    'jira_transition_issue',
    'Move a Jira issue to a different workflow status (e.g., "To Do" → "In Progress" → "Done"). This is how you change an issue\'s status. You MUST first call jira_get_transitions to get the valid transition ID for the desired status change. Optionally include a comment explaining the transition.',
    {
      issueKey: z.string().describe('Issue key to transition (e.g., KP-123)'),
      transitionId: z.string().describe('Transition ID from jira_get_transitions (e.g., "21", "31")'),
      comment: z.string().optional().describe('Optional comment explaining why the status is changing'),
    },
    async ({ issueKey, transitionId, comment }) => {
      await transitionIssue(issueKey, transitionId, comment);
      return {
        content: [{ type: 'text', text: `Issue ${issueKey} transitioned successfully.` }],
      };
    }
  );
};
