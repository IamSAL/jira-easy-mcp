/**
 * Jira MCP Server - Issue Link Tools
 * 
 * Tools for managing links between issues.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jiraGet, jiraPost, jiraDelete } from '../client.js';
import { formatResponse } from '../config.js';
import { startToolCall, endToolCall, failToolCall } from '../logger.js';
import type { JiraIssueLinkType } from '../types.js';

interface IssueLinkTypesResult {
  issueLinkTypes: JiraIssueLinkType[];
}

/**
 * Get available issue link types.
 */
export const getIssueLinkTypes = async (): Promise<JiraIssueLinkType[]> => {
  const result = await jiraGet<IssueLinkTypesResult>('/issueLinkType');
  return result.issueLinkTypes;
};

/**
 * Create a link between two issues.
 */
export const createIssueLink = async (
  inwardIssueKey: string,
  outwardIssueKey: string,
  linkTypeName: string,
  comment?: string
): Promise<void> => {
  const body: Record<string, unknown> = {
    type: { name: linkTypeName },
    inwardIssue: { key: inwardIssueKey },
    outwardIssue: { key: outwardIssueKey },
  };

  if (comment) {
    body.comment = { body: comment };
  }

  await jiraPost('/issueLink', body);
};

/**
 * Delete an issue link.
 */
export const deleteIssueLink = async (linkId: string): Promise<void> => {
  await jiraDelete(`/issueLink/${linkId}`);
};

/**
 * Link an issue to an epic.
 */
export const linkToEpic = async (
  issueKey: string,
  epicKey: string
): Promise<void> => {
  // Get epic link type - typically "Epic-Story Link" or similar
  const linkTypes = await getIssueLinkTypes();
  
  // Try to find an epic-related link type
  const epicLinkType = linkTypes.find(lt => 
    lt.name.toLowerCase().includes('epic') ||
    lt.inward.toLowerCase().includes('epic') ||
    lt.outward.toLowerCase().includes('epic')
  );

  if (epicLinkType) {
    await createIssueLink(issueKey, epicKey, epicLinkType.name);
  } else {
    // Fallback: update the issue's epic field directly
    // This requires the Epic Link custom field, which varies by instance
    throw new Error('No epic link type found. Use jira_update_issue with the appropriate epic link custom field instead.');
  }
};

interface RemoteLink {
  id: number;
  self: string;
  globalId: string;
  application: {
    type: string;
    name: string;
  };
  relationship: string;
  object: {
    url: string;
    title: string;
    summary?: string;
    icon?: {
      url16x16: string;
      title: string;
    };
  };
}

/**
 * Create a remote link (link to external resource).
 */
export const createRemoteLink = async (
  issueKey: string,
  url: string,
  title: string,
  options?: {
    summary?: string;
    relationship?: string;
    iconUrl?: string;
    iconTitle?: string;
  }
): Promise<RemoteLink> => {
  const body: Record<string, unknown> = {
    object: {
      url,
      title,
      summary: options?.summary,
    },
  };

  if (options?.relationship) {
    body.relationship = options.relationship;
  }

  if (options?.iconUrl) {
    (body.object as Record<string, unknown>).icon = {
      url16x16: options.iconUrl,
      title: options.iconTitle || title,
    };
  }

  return jiraPost<RemoteLink>(`/issue/${issueKey}/remotelink`, body);
};

/**
 * Get remote links for an issue.
 */
export const getRemoteLinks = async (issueKey: string): Promise<RemoteLink[]> => {
  return jiraGet<RemoteLink[]>(`/issue/${issueKey}/remotelink`);
};

/**
 * Register link tools with the MCP server.
 */
export const registerLinkTools = (server: McpServer): void => {
  // Get link types
  server.tool(
    'jira_get_link_types',
    'List all available issue link types configured in Jira (e.g., "Blocks/Is blocked by", "Clones/Is cloned by", "Relates to"). Call this before jira_create_link to see valid link type names and understand the inward/outward relationship directions.',
    {},
    async (args) => {
      const callLog = startToolCall('jira_get_link_types', args);
      try {
        const linkTypes = await getIssueLinkTypes();
        
        // Simplify the response
        const simplified = linkTypes.map(lt => ({
          id: lt.id,
          name: lt.name,
          inward: lt.inward,
          outward: lt.outward,
        }));

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

  // Create issue link
  server.tool(
    'jira_create_link',
    'Create a relationship link between two Jira issues. Use jira_get_link_types first to see available link types. The inward issue "is affected by" the relationship (e.g., "is blocked by"), and the outward issue "causes" it (e.g., "blocks"). Example: KP-1 blocks KP-2 means inward=KP-2, outward=KP-1, type="Blocks".',
    {
      inwardIssueKey: z.string().describe('Issue that receives the inward relation (e.g., KP-123 "is blocked by" the outward issue)'),
      outwardIssueKey: z.string().describe('Issue that has the outward relation (e.g., KP-456 "blocks" the inward issue)'),
      linkType: z.string().describe('Link type name from jira_get_link_types (e.g., "Blocks", "Clones", "Relates")'),
      comment: z.string().optional().describe('Optional comment explaining why these issues are linked'),
    },
    async (args) => {
      const callLog = startToolCall('jira_create_link', args);
      try {
        await createIssueLink(args.inwardIssueKey, args.outwardIssueKey, args.linkType, args.comment);
        const result = { success: true, message: `Link created: ${args.inwardIssueKey} -> ${args.outwardIssueKey} (${args.linkType})` };
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

  // Delete issue link
  server.tool(
    'jira_delete_link',
    'Remove a link between two Jira issues. The link ID can be found in the issue details from jira_get_issue (in the issueLinks array). This only removes the relationship, not the issues themselves.',
    {
      linkId: z.string().describe('Link ID to delete (found in issueLinks when calling jira_get_issue)'),
    },
    async (args) => {
      const callLog = startToolCall('jira_delete_link', args);
      try {
        await deleteIssueLink(args.linkId);
        const result = { success: true, message: `Link ${args.linkId} deleted successfully.` };
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

  // Create remote link
  server.tool(
    'jira_create_remote_link',
    'Add a link from a Jira issue to an external URL (web page, documentation, GitHub PR, Confluence page, etc.). Unlike issue links, remote links point to resources outside Jira.',
    {
      issueKey: z.string().describe('Issue key to add the link to (e.g., KP-123)'),
      url: z.string().url().describe('Full URL to link to (e.g., https://github.com/org/repo/pull/123)'),
      title: z.string().describe('Display title for the link'),
      summary: z.string().optional().describe('Brief description of the linked resource'),
    },
    async (args) => {
      const callLog = startToolCall('jira_create_remote_link', args);
      try {
        const link = await createRemoteLink(args.issueKey, args.url, args.title, { summary: args.summary });
        endToolCall(callLog, link);
        return {
          content: [{ type: 'text', text: `Remote link created. Link ID: ${link.id}` }],
        };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Get remote links
  server.tool(
    'jira_get_remote_links',
    'Get all external URL links attached to a Jira issue. These are links to resources outside Jira like GitHub PRs, documentation pages, or related websites. Different from issue links which connect Jira issues to each other.',
    {
      issueKey: z.string().describe('Issue key to get external links for (e.g., KP-123)'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_remote_links', args);
      try {
        const links = await getRemoteLinks(args.issueKey);
        
        // Simplify the response
        const simplified = links.map(l => ({
          id: l.id,
          url: l.object.url,
          title: l.object.title,
          summary: l.object.summary,
          relationship: l.relationship,
        }));

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
};
