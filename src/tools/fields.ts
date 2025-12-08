/**
 * Jira MCP Server - Field Tools
 * 
 * Tools for getting field definitions and metadata.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jiraGet } from '../client.js';
import type { JiraField, JiraIssueType } from '../types.js';

/**
 * Get all fields (system + custom).
 */
export const getAllFields = async (): Promise<JiraField[]> => {
  return jiraGet<JiraField[]>('/field');
};

/**
 * Get create meta for a project (fields required/available when creating issues).
 */
export const getCreateMeta = async (
  projectKey: string,
  issueTypeNames?: string[]
): Promise<unknown> => {
  const params = new URLSearchParams({
    projectKeys: projectKey,
    expand: 'projects.issuetypes.fields',
  });

  if (issueTypeNames && issueTypeNames.length > 0) {
    params.set('issuetypeNames', issueTypeNames.join(','));
  }

  return jiraGet(`/issue/createmeta?${params}`);
};

/**
 * Get issue types for a project.
 */
export const getProjectIssueTypes = async (projectKey: string): Promise<JiraIssueType[]> => {
  interface ProjectMeta {
    projects: Array<{
      issuetypes: JiraIssueType[];
    }>;
  }
  
  const meta = await jiraGet<ProjectMeta>(`/issue/createmeta?projectKeys=${projectKey}`);
  return meta.projects[0]?.issuetypes || [];
};

/**
 * Register field tools with the MCP server.
 */
export const registerFieldTools = (server: McpServer): void => {
  // Get all fields
  server.tool(
    'jira_get_fields',
    'List all Jira fields (both system fields like Summary, Status, Priority and custom fields). Returns field IDs, names, and whether they\'re searchable in JQL. Essential for understanding what fields can be used in JQL queries or when updating issues with custom fields.',
    {
      customOnly: z.boolean().default(false).describe('Set to true to only return custom fields, filtering out standard Jira fields'),
    },
    async ({ customOnly }) => {
      const fields = await getAllFields();
      const filtered = customOnly ? fields.filter(f => f.custom) : fields;
      
      // Simplify the response
      const simplified = filtered.map(f => ({
        id: f.id,
        name: f.name,
        custom: f.custom,
        searchable: f.searchable,
        clauseNames: f.clauseNames,
        type: f.schema?.type,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify(simplified, null, 2) }],
      };
    }
  );

  // Get create meta
  server.tool(
    'jira_get_create_meta',
    'Get metadata about fields required and available when creating issues in a project. Shows which fields are mandatory, their allowed values, and field types. Call this before jira_create_issue to understand what data is needed for each issue type.',
    {
      projectKey: z.string().describe('Project key to get create metadata for (e.g., KP)'),
      issueTypes: z.array(z.string()).optional().describe('Optional: limit results to specific issue types (e.g., ["Bug", "Task"])'),
    },
    async ({ projectKey, issueTypes }) => {
      const meta = await getCreateMeta(projectKey, issueTypes);
      return {
        content: [{ type: 'text', text: JSON.stringify(meta, null, 2) }],
      };
    }
  );

  // Get issue types for project
  server.tool(
    'jira_get_issue_types',
    'List all issue types available in a project (e.g., Bug, Task, Story, Epic, Sub-task). Each project may have different issue types configured. Call this before jira_create_issue to see valid issue type names.',
    {
      projectKey: z.string().describe('Project key to list issue types for (e.g., KP)'),
    },
    async ({ projectKey }) => {
      const issueTypes = await getProjectIssueTypes(projectKey);
      
      // Simplify the response
      const simplified = issueTypes.map(it => ({
        id: it.id,
        name: it.name,
        description: it.description,
        subtask: it.subtask,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify(simplified, null, 2) }],
      };
    }
  );
};
