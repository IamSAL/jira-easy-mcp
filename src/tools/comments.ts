/**
 * Jira MCP Server - Comment Tools
 * 
 * Tools for adding and managing comments on issues.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jiraGet, jiraPost, jiraPut, jiraDelete } from '../client.js';
import type { JiraComment, CreateCommentResponse } from '../types.js';

interface CommentsResult {
  startAt: number;
  maxResults: number;
  total: number;
  comments: JiraComment[];
}

/**
 * Get comments for an issue.
 */
export const getComments = async (
  issueKey: string,
  startAt: number = 0,
  maxResults: number = 50
): Promise<CommentsResult> => {
  const params = new URLSearchParams({
    startAt: startAt.toString(),
    maxResults: maxResults.toString(),
  });

  return jiraGet<CommentsResult>(`/issue/${issueKey}/comment?${params}`);
};

/**
 * Add a comment to an issue.
 */
export const addComment = async (
  issueKey: string,
  body: string
): Promise<CreateCommentResponse> => {
  return jiraPost<CreateCommentResponse>(`/issue/${issueKey}/comment`, { body });
};

/**
 * Update an existing comment.
 */
export const updateComment = async (
  issueKey: string,
  commentId: string,
  body: string
): Promise<JiraComment> => {
  return jiraPut<JiraComment>(`/issue/${issueKey}/comment/${commentId}`, { body });
};

/**
 * Delete a comment.
 */
export const deleteComment = async (
  issueKey: string,
  commentId: string
): Promise<void> => {
  await jiraDelete(`/issue/${issueKey}/comment/${commentId}`);
};

/**
 * Register comment tools with the MCP server.
 */
export const registerCommentTools = (server: McpServer): void => {
  // Get comments
  server.tool(
    'jira_get_comments',
    'Retrieve all comments on a Jira issue. Returns comment text, author, and timestamps. Use this to see discussion history, feedback, or notes left by team members on an issue.',
    {
      issueKey: z.string().describe('Issue key to get comments for (e.g., KP-123)'),
      startAt: z.number().min(0).default(0).describe('Starting index for pagination'),
      maxResults: z.number().min(1).max(100).default(50).describe('Maximum number of comments to return'),
    },
    async ({ issueKey, startAt, maxResults }) => {
      const result = await getComments(issueKey, startAt, maxResults);
      
      // Simplify the response
      const simplified = {
        total: result.total,
        startAt: result.startAt,
        maxResults: result.maxResults,
        comments: result.comments.map(c => ({
          id: c.id,
          author: c.author.displayName,
          body: c.body,
          created: c.created,
          updated: c.updated,
        })),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(simplified, null, 2) }],
      };
    }
  );

  // Add comment
  server.tool(
    'jira_add_comment',
    'Add a new comment to a Jira issue. Use this to leave notes, ask questions, provide updates, or communicate with team members about the issue. Supports Jira text formatting (wiki markup): *bold*, _italic_, {code}...{code} for code blocks, [link text|url] for links.',
    {
      issueKey: z.string().describe('Issue key to comment on (e.g., KP-123)'),
      body: z.string().describe('Comment text. Supports Jira wiki markup: *bold*, _italic_, {code}code{code}, [link|url]'),
    },
    async ({ issueKey, body }) => {
      const result = await addComment(issueKey, body);
      return {
        content: [{ type: 'text', text: `Comment added successfully. Comment ID: ${result.id}` }],
      };
    }
  );

  // Update comment
  server.tool(
    'jira_update_comment',
    'Edit/modify an existing comment on a Jira issue. You need the comment ID which can be obtained from jira_get_comments or jira_get_issue. Replaces the entire comment text.',
    {
      issueKey: z.string().describe('Issue key containing the comment (e.g., KP-123)'),
      commentId: z.string().describe('ID of the comment to update (get from jira_get_comments)'),
      body: z.string().describe('New comment text (replaces existing text entirely)'),
    },
    async ({ issueKey, commentId, body }) => {
      await updateComment(issueKey, commentId, body);
      return {
        content: [{ type: 'text', text: `Comment ${commentId} updated successfully.` }],
      };
    }
  );

  // Delete comment
  server.tool(
    'jira_delete_comment',
    'Permanently delete a comment from a Jira issue. This cannot be undone. You need the comment ID from jira_get_comments.',
    {
      issueKey: z.string().describe('Issue key containing the comment (e.g., KP-123)'),
      commentId: z.string().describe('ID of the comment to delete (get from jira_get_comments)'),
    },
    async ({ issueKey, commentId }) => {
      await deleteComment(issueKey, commentId);
      return {
        content: [{ type: 'text', text: `Comment ${commentId} deleted successfully.` }],
      };
    }
  );
};
