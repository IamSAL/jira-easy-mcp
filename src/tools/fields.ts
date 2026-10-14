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
import { isCustomFieldId } from '../custom-fields.js';
import { startToolCall, endToolCall, failToolCall } from '../logger.js';
import { toSimplifiedCreateMeta, toSimplifiedEditMeta } from '../transformers.js';
import type {
  JiraField,
  JiraIssueType,
  JiraEditMeta,
  JiraEditMetaField,
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

/** A createmeta field; Jira 8.4+ per-issuetype endpoint rows also carry `fieldId`. */
type CreateMetaField = JiraEditMetaField & { fieldId?: string; key?: string };

interface PagedValues<T> {
  values: T[];
  isLast?: boolean;
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
 * endpoints exist since Jira 8.4. Try them first and fall back to the old one (Jira 7.x - 8.3).
 */
const isNotFound = (err: unknown): boolean => err instanceof JiraApiException && err.status === 404;
// Jira 8.x answers the per-project endpoint with 400 for an unknown project
const shouldUseLegacy = (err: unknown): boolean =>
  err instanceof JiraApiException && (err.status === 404 || err.status === 400);

/**
 * Legacy GET /issue/createmeta (Jira < 8.4). On Jira 9+ it no longer exists,
 * so reaching it there means the per-project endpoint 404'd: unknown project.
 */
const getLegacyCreateMeta = async (projectKey: string, params: URLSearchParams): Promise<JiraCreateMeta> => {
  const notFound = () => new Error(`Project ${projectKey} not found or you cannot create issues in it.`);
  let meta: JiraCreateMeta;
  try {
    meta = await jiraGet<JiraCreateMeta>(`/issue/createmeta?${params}`);
  } catch (err) {
    throw isNotFound(err) ? notFound() : err;
  }
  if (!meta.projects?.length) throw notFound();
  return meta;
};

/**
 * Field catalog for jira_get_fields. customOnly keeps customfield_<digits> entries.
 */
export const listFields = async (customOnly: boolean = false): Promise<JiraField[]> => {
  const fields = await getAllFields();
  return customOnly ? fields.filter(field => isCustomFieldId(field.id)) : fields;
};

/**
 * Editable fields for an issue (GET /issue/{key}/editmeta, every Jira version).
 */
export const getEditMeta = async (
  issueKey: string,
  customOnly: boolean = false
): Promise<SimplifiedEditMeta> => {
  const meta = await jiraGet<JiraEditMeta>(`/issue/${pathSegment(issueKey)}/editmeta`);
  return toSimplifiedEditMeta(issueKey, meta.fields, customOnly);
};

/**
 * Get issue types for a project.
 */
export const getProjectIssueTypes = async (projectKey: string): Promise<JiraIssueType[]> => {
  const project = pathSegment(projectKey);
  try {
    return await getAllPages<JiraIssueType>(`/issue/createmeta/${project}/issuetypes`);
  } catch (err) {
    if (!shouldUseLegacy(err)) throw err;
  }
  const legacy = await getLegacyCreateMeta(projectKey, new URLSearchParams({ projectKeys: projectKey.trim() }));
  return (legacy.projects?.[0]?.issuetypes ?? []) as JiraIssueType[];
};

/**
 * Create-screen fields for a project, as the same field rows as jira_get_edit_meta.
 */
export const getCreateMeta = async (
  projectKey: string,
  issueTypeNames?: string[]
): Promise<SimplifiedCreateMeta> => {
  const project = pathSegment(projectKey);
  const wanted = issueTypeNames?.map(name => name.toLowerCase());
  const matches = (name: string) => !wanted?.length || wanted.includes(name.toLowerCase());

  try {
    const issueTypes = await getAllPages<JiraIssueType>(`/issue/createmeta/${project}/issuetypes`);
    const selected = issueTypes.filter(issueType => matches(issueType.name));
    const issuetypes = await Promise.all(selected.map(async issueType => {
      const rows = await getAllPages<CreateMetaField>(
        `/issue/createmeta/${project}/issuetypes/${issueType.id}`
      );
      const fields = Object.fromEntries(rows.map(row => [row.fieldId ?? row.key ?? row.name, row]));
      return { id: issueType.id, name: issueType.name, subtask: issueType.subtask, fields };
    }));
    return toSimplifiedCreateMeta(projectKey, { projects: [{ key: projectKey.trim(), issuetypes }] });
  } catch (err) {
    if (!shouldUseLegacy(err)) throw err;
  }

  const params = new URLSearchParams({ projectKeys: projectKey.trim(), expand: 'projects.issuetypes.fields' });
  const legacy = await getLegacyCreateMeta(projectKey, params);
  const raw: JiraCreateMeta = {
    projects: legacy.projects?.map(p => ({ ...p, issuetypes: p.issuetypes?.filter(t => matches(t.name)) })),
  };
  return toSimplifiedCreateMeta(projectKey, raw);
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
      customOnly: zBoolean().default(false).describe('Set to true to only return fields whose id is customfield_<digits>'),
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
    'Get which fields can be edited on a specific issue, including schema type, operations, and allowedValues. This is GET /rest/api/2/issue/{key}/editmeta. Call this before writing custom fields so you know the REST value shape (string, number, {value}, {name} for Server users, arrays) and whether the field is on the edit screen. A field listed by jira_get_fields but missing here cannot be updated on that issue.',
    {
      issueKey: z.string().describe('Issue key to get edit metadata for (e.g., KP-123)'),
      customOnly: zBoolean().default(false).describe('Set to true to only return fields whose id is customfield_<digits>'),
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
