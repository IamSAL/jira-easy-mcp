/**
 * Jira MCP Server - Field Tools
 * 
 * Tools for getting field definitions and metadata.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { zBoolean } from './schema.js';
import { jiraGet, JiraApiException, pathSegment } from '../client.js';
import { formatResponse } from '../config.js';
import { startToolCall, endToolCall, failToolCall } from '../logger.js';
import type { JiraField, JiraIssueType } from '../types.js';

/**
 * Get all fields (system + custom).
 */
export const getAllFields = async (): Promise<JiraField[]> => {
  return jiraGet<JiraField[]>('/field');
};

interface CreateMetaField {
  fieldId?: string;
  key?: string;
  name: string;
  required: boolean;
  schema?: { type?: string; items?: string; custom?: string };
  allowedValues?: Array<{ id?: string; name?: string; value?: string; key?: string }>;
}

interface LegacyCreateMeta {
  projects: Array<{
    issuetypes: Array<JiraIssueType & { fields?: Record<string, CreateMetaField> }>;
  }>;
}

interface PagedValues<T> {
  values: T[];
  isLast?: boolean;
  total?: number;
}

export interface SimplifiedCreateMeta {
  issueType: string;
  issueTypeId: string;
  subtask: boolean;
  fields: Array<{
    id: string;
    name: string;
    required: boolean;
    type?: string;
    customType?: string;
    allowedValues?: string[];
  }>;
}

/**
 * Fetch every page of a createmeta endpoint (Jira 8.4+ pages at 50 items).
 */
const getAllPages = async <T>(endpoint: string): Promise<T[]> => {
  const values: T[] = [];
  for (let startAt = 0; ; ) {
    const page = await jiraGet<PagedValues<T>>(`${endpoint}?startAt=${startAt}&maxResults=100`);
    values.push(...page.values);
    startAt += page.values.length;
    if (page.isLast !== false || page.values.length === 0) return values;
  }
};

/**
 * Jira 9+ removed GET /issue/createmeta?projectKeys=...; the per-project
 * endpoints exist since Jira 8.4. Try them first and fall back on 404 (Jira 7.x - 8.3).
 */
const isNotFound = (err: unknown): boolean => err instanceof JiraApiException && err.status === 404;

const simplifyField = (id: string, field: CreateMetaField): SimplifiedCreateMeta['fields'][number] => ({
  id,
  name: field.name,
  required: field.required,
  type: field.schema?.type === 'array' ? `array<${field.schema.items}>` : field.schema?.type,
  customType: field.schema?.custom?.split(':').pop(),
  allowedValues: field.allowedValues
    ?.map(v => v.name ?? v.value ?? v.key ?? v.id)
    .filter((v): v is string => v !== undefined)
    .slice(0, 50),
});

/**
 * Get issue types for a project.
 */
export const getProjectIssueTypes = async (projectKey: string): Promise<JiraIssueType[]> => {
  const project = pathSegment(projectKey);
  try {
    return await getAllPages<JiraIssueType>(`/issue/createmeta/${project}/issuetypes`);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  const meta = await jiraGet<LegacyCreateMeta>(`/issue/createmeta?projectKeys=${project}`);
  if (meta.projects.length === 0) {
    throw new Error(`Project ${projectKey} not found or you cannot create issues in it.`);
  }
  return meta.projects[0].issuetypes;
};

/**
 * Get create meta for a project (fields required/available when creating issues).
 */
export const getCreateMeta = async (
  projectKey: string,
  issueTypeNames?: string[]
): Promise<SimplifiedCreateMeta[]> => {
  const project = pathSegment(projectKey);
  const wanted = issueTypeNames?.map(name => name.toLowerCase());
  const matches = (name: string) => !wanted?.length || wanted.includes(name.toLowerCase());

  try {
    const issueTypes = await getAllPages<JiraIssueType>(`/issue/createmeta/${project}/issuetypes`);
    const selected = issueTypes.filter(issueType => matches(issueType.name));
    return Promise.all(selected.map(async issueType => {
      const fields = await getAllPages<CreateMetaField>(
        `/issue/createmeta/${project}/issuetypes/${issueType.id}`
      );
      return {
        issueType: issueType.name,
        issueTypeId: issueType.id,
        subtask: issueType.subtask,
        fields: fields.map(field => simplifyField(field.fieldId ?? field.key ?? field.name, field)),
      };
    }));
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  const params = new URLSearchParams({ projectKeys: projectKey.trim(), expand: 'projects.issuetypes.fields' });
  const meta = await jiraGet<LegacyCreateMeta>(`/issue/createmeta?${params}`);
  if (meta.projects.length === 0) {
    throw new Error(`Project ${projectKey} not found or you cannot create issues in it.`);
  }
  return meta.projects[0].issuetypes
    .filter(issueType => matches(issueType.name))
    .map(issueType => ({
      issueType: issueType.name,
      issueTypeId: issueType.id,
      subtask: issueType.subtask,
      fields: Object.entries(issueType.fields || {}).map(([id, field]) => simplifyField(id, field)),
    }));
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
      customOnly: zBoolean().default(false).describe('Set to true to only return custom fields, filtering out standard Jira fields'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_fields', args);
      try {
        const fields = await getAllFields();
        const filtered = args.customOnly ? fields.filter(f => f.custom) : fields;
        
        // Simplify the response
        const simplified = filtered.map(f => ({
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
    'Get metadata about fields required and available when creating issues in a project. Shows which fields are mandatory, their allowed values, and field types. Call this before jira_create_issue to understand what data is needed for each issue type.',
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
};
