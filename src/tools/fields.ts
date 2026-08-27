/**
 * Jira MCP Server - Field Tools
 * 
 * Tools for getting field definitions and metadata.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jiraGet } from '../client.js';
import { formatResponse } from '../config.js';
import { isCustomFieldId } from '../custom-fields.js';
import { startToolCall, endToolCall, failToolCall } from '../logger.js';
import { toSimplifiedCreateMeta, toSimplifiedEditMeta } from '../transformers.js';
import type {
  JiraField,
  JiraIssueType,
  JiraEditMeta,
  JiraCreateMeta,
  SimplifiedEditMeta,
  SimplifiedCreateMeta,
} from '../types.js';

/**
 * Get all fields (system + custom).
 */
export const getAllFields = async (): Promise<JiraField[]> => {
  return jiraGet<JiraField[]>('/field');
};

/**
 * Field catalog for jira_get_fields. customOnly keeps customfield_<digits> entries.
 */
export const listFields = async (customOnly: boolean = false): Promise<JiraField[]> => {
  const fields = await getAllFields();
  return customOnly ? fields.filter(field => isCustomFieldId(field.id)) : fields;
};

/**
 * Editable fields for an issue (GET /issue/{key}/editmeta). Jira Server 7.12.
 */
export const getEditMeta = async (
  issueKey: string,
  customOnly: boolean = false
): Promise<SimplifiedEditMeta> => {
  const meta = await jiraGet<JiraEditMeta>(`/issue/${issueKey}/editmeta`);
  return toSimplifiedEditMeta(issueKey, meta.fields, customOnly);
};

/**
 * Create-screen fields for a project (GET /issue/createmeta). Jira Server 7.12.
 */
export const getCreateMeta = async (
  projectKey: string,
  issueTypeNames?: string[]
): Promise<SimplifiedCreateMeta> => {
  const params = new URLSearchParams({
    projectKeys: projectKey,
    expand: 'projects.issuetypes.fields',
  });

  if (issueTypeNames && issueTypeNames.length > 0) {
    params.set('issuetypeNames', issueTypeNames.join(','));
  }

  const raw = await jiraGet<JiraCreateMeta>(`/issue/createmeta?${params}`);
  return toSimplifiedCreateMeta(projectKey, raw);
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
    'List the Jira instance field catalog (system fields like Summary plus every custom field). Returns field IDs, names, clauseNames for JQL, and whether they\'re searchable. Use this to look up a JQL clause name. For fields on an issue type, use jira_get_edit_meta or jira_get_create_meta instead — do not call this before every create/update.',
    {
      customOnly: z.boolean().default(false).describe('Set to true to only return fields whose id is customfield_<digits>'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_fields', args);
      try {
        const fields = await listFields(args.customOnly);
        const simplified = fields.map(f => ({
          id: f.id,
          name: f.name,
          custom: f.custom,
          searchable: f.searchable,
          clauseNames: f.clauseNames,
          type: f.schema?.type,
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

  // Get create meta
  server.tool(
    'jira_get_create_meta',
    'Get metadata about fields required and available when creating issues in a project. Returns simplified field rows (id, type, operations, allowedValues) per issue type — the same shape as jira_get_edit_meta. Call this before jira_create_issue to understand what data is needed for each issue type.',
    {
      projectKey: z.string().describe('Project key to get create metadata for (e.g., KP)'),
      issueTypes: z.array(z.string()).optional().describe('Optional: limit results to specific issue types (e.g., ["Bug", "Task"])'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_create_meta', args);
      try {
        const meta = await getCreateMeta(args.projectKey, args.issueTypes);
        endToolCall(callLog, meta);
        return {
          content: [{ type: 'text', text: formatResponse(meta) }],
        };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Get issue types for project
  server.tool(
    'jira_get_issue_types',
    'List all issue types available in a project (e.g., Bug, Task, Story, Epic, Sub-task). Each project may have different issue types configured. Call this before jira_create_issue to see valid issue type names.',
    {
      projectKey: z.string().describe('Project key to list issue types for (e.g., KP)'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_issue_types', args);
      try {
        const issueTypes = await getProjectIssueTypes(args.projectKey);
        
        // Simplify the response
        const simplified = issueTypes.map(it => ({
          id: it.id,
          name: it.name,
          description: it.description,
          subtask: it.subtask,
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

  // Get edit meta for an issue
  server.tool(
    'jira_get_edit_meta',
    'Get which fields can be edited on a specific issue, including schema type, operations, and allowedValues. This is GET /rest/api/2/issue/{key}/editmeta (Jira Server 7.12). Call this before writing custom fields so you know the REST value shape (string, number, {value}, {name} for Server users, arrays) and whether the field is on the edit screen. A field listed by jira_get_fields but missing here cannot be updated on that issue.',
    {
      issueKey: z.string().describe('Issue key to get edit metadata for (e.g., KP-123)'),
      customOnly: z.boolean().default(false).describe('Set to true to only return fields whose id is customfield_<digits>'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_edit_meta', args);
      try {
        const meta = await getEditMeta(args.issueKey, args.customOnly);
        endToolCall(callLog, meta);
        return {
          content: [{ type: 'text', text: formatResponse(meta) }],
        };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );
};
