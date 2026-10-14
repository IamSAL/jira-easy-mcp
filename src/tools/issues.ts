/**
 * Jira MCP Server - Issue Tools
 * 
 * Tools for searching, getting, creating, updating, and deleting issues.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { zBoolean } from './schema.js';
import { jiraGet, jiraPost, jiraPut, jiraDelete, pathSegment } from '../client.js';
import { formatResponse, getConfig } from '../config.js';
import { startToolCall, endToolCall, failToolCall } from '../logger.js';
import { mergeCustomFields, customFieldsNeedNameResolve, resolveCustomFieldMap, isCustomFieldId, assertNoSystemWriteKeys } from '../custom-fields.js';
import { getCreateMeta, getEditMeta, listFields } from './fields.js';
import { toSimplifiedIssue, toSimplifiedSearchResult } from '../transformers.js';
import type {
  JiraIssue,
  JiraSearchResult,
  CreateIssueResponse,
  SimplifiedIssue,
  SimplifiedSearchResult,
} from '../types.js';

/**
 * System fields getIssue always requested on master, minus collections that
 * dominate payload size. comment / worklog / attachment are opt-in via include.
 */
export const MASTER_GET_ISSUE_FIELDS = [
  'summary', 'status', 'priority', 'issuetype', 'assignee', 'reporter',
  'description', 'labels', 'components', 'fixVersions', 'resolution',
  'created', 'updated', 'duedate', 'parent', 'subtasks', 'issuelinks',
  'timetracking', 'versions',
] as const;

const INCLUDE_FIELDS = {
  comments: 'comment',
  worklogs: 'worklog',
  attachments: 'attachment',
} as const;

export type GetIssueInclude = keyof typeof INCLUDE_FIELDS;
export type CustomFieldsMode = 'set' | 'all';

export interface GetIssueOptions {
  expand?: string[];
  include?: GetIssueInclude[];
  customFields?: CustomFieldsMode;
  /** Custom field ids (customfield_11205) or unique edit-screen names (Severity). */
  fields?: string[];
}

const SYSTEM_FIELD_IDS = new Set<string>([
  ...MASTER_GET_ISSUE_FIELDS,
  'comment', 'worklog', 'attachment', 'key', '*navigable', '*all',
]);

const customFieldsValueShape =
  'Custom fields keyed by field id (e.g. customfield_10006) or a unique name from that issue type\'s meta. Values are raw Jira REST payloads, not display names.';

export const createCustomFieldsParam = z
  .record(z.unknown())
  .optional()
  .describe(
    `${customFieldsValueShape} Call jira_get_create_meta for schema/allowedValues and unique names. Examples: number 5, string "text", select {"value":"Yes"}, Server user {"name":"username"}, multi-select [{"value":"A"}], null to clear. Do not call jira_get_fields before create.`
  );

export const updateCustomFieldsParam = z
  .record(z.unknown())
  .optional()
  .describe(
    `${customFieldsValueShape} Call jira_get_edit_meta for schema/allowedValues and unique names. Examples: number 5, string "text", select {"value":"Yes"}, Server user {"name":"username"}, multi-select [{"value":"A"}], null to clear. Do not call jira_get_fields before update.`
  );

/**
 * Generate Jira filter URL with JQL and validate by searching first.
 * Detects platform (Cloud vs Server) and generates appropriate URL.
 */
export const generateFilterUrl = async (jql: string): Promise<{
  url: string;
  jql: string;
  total: number;
  issues: SimplifiedIssue[];
  maxResults: number;
}> => {
  const { baseUrl } = getConfig();
  
  // First, validate the JQL by performing a search
  const searchResult = await searchIssues(jql, 50, 0);
  

  const encodedJql = encodeURIComponent(jql);
  
  // Generate appropriate URL based on platform
  const url = `${baseUrl}/issues/?jql=${encodedJql}`;
  
  return {
    url,
    jql,
    total: searchResult.total,
    issues: searchResult.issues,
    maxResults: searchResult.maxResults,
  };
};

const collectionFields = (include?: GetIssueInclude[]): string[] =>
  (include ?? []).map(item => INCLUDE_FIELDS[item]);

const needsCatalogNameResolve = (tokens: string[]): boolean =>
  tokens.some(token => !isCustomFieldId(token) && !SYSTEM_FIELD_IDS.has(token));

const resolveTokensAgainstCatalog = async (tokens: string[]): Promise<string[]> => {
  if (!needsCatalogNameResolve(tokens)) {
    return tokens;
  }

  const catalog = await listFields();
  return tokens.map(token => {
    if (isCustomFieldId(token) || SYSTEM_FIELD_IDS.has(token) || catalog.some(field => field.id === token)) {
      return token;
    }
    const matches = catalog.filter(field => field.name === token);
    if (matches.length === 1) {
      return matches[0].id;
    }
    if (matches.length > 1) {
      throw new Error(
        `Field name "${token}" matches multiple fields: ${matches.map(field => field.id).join(', ')}. Use a field id.`
      );
    }
    throw new Error(
      `Unknown field "${token}". Use a customfield_ id or a unique name from jira_get_fields.`
    );
  });
};

const resolveTokensAgainstNamedFields = (
  tokens: string[],
  namedFields: Array<{ id: string; name: string }>
): string[] =>
  tokens.map(token => {
    if (isCustomFieldId(token) || SYSTEM_FIELD_IDS.has(token)) {
      return token;
    }
    const matches = namedFields.filter(field => field.name === token);
    if (matches.length === 1) {
      return matches[0].id;
    }
    if (matches.length > 1) {
      throw new Error(
        `Field name "${token}" matches multiple fields: ${matches.map(field => field.id).join(', ')}. Use a field id.`
      );
    }
    throw new Error(
      `Unknown field "${token}". Use a customfield_ id or a unique name from jira_get_edit_meta.`
    );
  });

/**
 * Search issues by JQL.
 */
export const searchIssues = async (
  jql: string,
  maxResults: number = 50,
  startAt: number = 0,
  fields?: string[]
): Promise<SimplifiedSearchResult> => {
  // Compact by default: with descriptions, comments and worklogs, 50 issues
  // can exceed 50k tokens, past what MCP clients accept from one tool call
  // (Claude Code truncates at 25k). jira_get_issue returns the full detail.
  const defaultFields = [
    'summary', 'status', 'priority', 'issuetype', 'assignee', 'reporter',
    'labels', 'components', 'fixVersions', 'resolution',
    'created', 'updated', 'duedate', 'parent',
  ];

  const extras = fields && fields.length > 0
    ? await resolveTokensAgainstCatalog(fields)
    : [];
  const requested = extras.length > 0
    ? [...defaultFields, ...extras.filter(token => !defaultFields.includes(token))]
    : defaultFields;
  const customFieldIds = requested.filter(isCustomFieldId);

  const params = new URLSearchParams({
    jql,
    maxResults: maxResults.toString(),
    startAt: startAt.toString(),
    fields: requested.join(','),
  });
  if (customFieldIds.length > 0) {
    params.set('expand', 'names');
  }

  const result = await jiraGet<JiraSearchResult>(`/search?${params}`);
  return toSimplifiedSearchResult(result, {
    includeNullCustomFields: customFieldIds.length > 0,
    customFieldIds: customFieldIds.length > 0 ? customFieldIds : undefined,
  });
};

const mergeExpand = (expand?: string[]): string =>
  ['names', ...(expand ?? []).filter(item => item !== 'names')].join(',');

/**
 * Get a single issue by key or ID.
 */
export const getIssue = async (
  issueKey: string,
  options: GetIssueOptions = {}
): Promise<SimplifiedIssue> => {
  const extra = collectionFields(options.include);
  const requested = options.fields;
  let fieldList: string[];
  let includeNullCustomFields = options.customFields === 'all';
  let customFieldIds: string[] | undefined;

  if (requested && requested.length > 0) {
    const named = requested.some(token => !isCustomFieldId(token) && !SYSTEM_FIELD_IDS.has(token));
    const resolved = named
      ? resolveTokensAgainstNamedFields(requested, (await getEditMeta(issueKey)).fields)
      : requested;
    customFieldIds = resolved.filter(isCustomFieldId);
    fieldList = [...MASTER_GET_ISSUE_FIELDS, ...extra, ...customFieldIds];
    includeNullCustomFields = true;
  } else {
    fieldList = ['*navigable', ...MASTER_GET_ISSUE_FIELDS, ...extra];
  }

  const params = new URLSearchParams({
    fields: fieldList.join(','),
    expand: mergeExpand(options.expand),
  });

  const issue = await jiraGet<JiraIssue>(`/issue/${pathSegment(issueKey)}?${params}`);
  return toSimplifiedIssue(issue, { includeNullCustomFields, customFieldIds });
};

/**
 * Create a new issue.
 */
export const createIssue = async (
  projectKey: string,
  issueType: string,
  summary: string,
  options?: {
    description?: string;
    assignee?: string;
    priority?: string;
    labels?: string[];
    components?: string[];
    fixVersions?: string[];
    dueDate?: string;
    parentKey?: string;
    customFields?: Record<string, unknown>;
  }
): Promise<CreateIssueResponse> => {
  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    issuetype: { name: issueType },
    summary,
  };

  if (options?.description) {
    fields.description = options.description;
  }
  if (options?.assignee) {
    fields.assignee = { name: options.assignee };
  }
  if (options?.priority) {
    fields.priority = { name: options.priority };
  }
  if (options?.labels) {
    fields.labels = options.labels;
  }
  if (options?.components) {
    fields.components = options.components.map(name => ({ name }));
  }
  if (options?.fixVersions) {
    fields.fixVersions = options.fixVersions.map(name => ({ name }));
  }
  if (options?.dueDate) {
    fields.duedate = options.dueDate;
  }
  if (options?.parentKey) {
    fields.parent = { key: options.parentKey };
  }
  assertNoSystemWriteKeys(options?.customFields);
  mergeCustomFields(
    fields,
    customFieldsNeedNameResolve(options?.customFields)
      ? resolveCustomFieldMap(
        options?.customFields,
        (await getCreateMeta(projectKey, [issueType])).issueTypes.find(
          type => type.name.toLowerCase() === issueType.toLowerCase()
        )?.fields ?? []
      )
      : options?.customFields
  );

  return jiraPost<CreateIssueResponse>('/issue', { fields });
};

/**
 * Update an existing issue.
 */
export const updateIssue = async (
  issueKey: string,
  updates: {
    summary?: string;
    description?: string;
    assignee?: string;
    priority?: string;
    labels?: string[];
    components?: string[];
    fixVersions?: string[];
    dueDate?: string;
    customFields?: Record<string, unknown>;
  }
): Promise<void> => {
  const fields: Record<string, unknown> = {};

  if (updates.summary !== undefined) {
    fields.summary = updates.summary;
  }
  if (updates.description !== undefined) {
    fields.description = updates.description;
  }
  if (updates.assignee !== undefined) {
    fields.assignee = updates.assignee ? { name: updates.assignee } : null;
  }
  if (updates.priority !== undefined) {
    fields.priority = { name: updates.priority };
  }
  if (updates.labels !== undefined) {
    fields.labels = updates.labels;
  }
  if (updates.components !== undefined) {
    fields.components = updates.components.map(name => ({ name }));
  }
  if (updates.fixVersions !== undefined) {
    fields.fixVersions = updates.fixVersions.map(name => ({ name }));
  }
  if (updates.dueDate !== undefined) {
    fields.duedate = updates.dueDate;
  }
  let customFields = updates.customFields;
  assertNoSystemWriteKeys(customFields);
  if (customFieldsNeedNameResolve(customFields)) {
    customFields = resolveCustomFieldMap(
      customFields,
      (await getEditMeta(issueKey)).fields
    );
  }
  mergeCustomFields(fields, customFields);

  await jiraPut(`/issue/${pathSegment(issueKey)}`, { fields });
};

/**
 * Delete an issue.
 */
export const deleteIssue = async (
  issueKey: string,
  deleteSubtasks: boolean = false
): Promise<void> => {
  const params = deleteSubtasks ? '?deleteSubtasks=true' : '';
  await jiraDelete(`/issue/${pathSegment(issueKey)}${params}`);
};

/**
 * Get issue changelog.
 */
export const getIssueChangelog = async (
  issueKey: string,
  startAt: number = 0,
  maxResults: number = 100
): Promise<JiraIssue['changelog']> => {
  const params = new URLSearchParams({
    expand: 'changelog',
    fields: 'key', // Minimal fields, we just want changelog
    startAt: startAt.toString(),
    maxResults: maxResults.toString(),
  });

  const issue = await jiraGet<JiraIssue>(`/issue/${pathSegment(issueKey)}?${params}`);
  return issue.changelog;
};

/**
 * Register issue tools with the MCP server.
 */
export const registerIssueTools = (server: McpServer): void => {
  // Search issues by JQL
  server.tool(
    "jira_search",
    'Search for Jira issues using JQL (Jira Query Language). Use this to find issues by project, status, assignee, labels, sprint, or any combination of criteria. Returns a compact summary per issue (key, summary, status, type, priority, assignee, reporter, labels, dates); use jira_get_issue for the description, comments and worklogs, or pass `fields` to include specific fields. Common JQL examples: "project = KP", "assignee = currentUser()", "status = \'In Progress\'", "sprint in openSprints()", "labels = bug AND priority = High". For a shareable browser link to the same search, use jira_generate_filter_url.',

    {
      jql: z
        .string()
        .describe(
          'JQL query string. Examples: "project = KP AND status = Open", "assignee = currentUser() ORDER BY updated DESC", "sprint in openSprints() AND status != Done"'
        ),
      maxResults: z
        .coerce.number()
        .min(1)
        .max(100)
        .default(50)
        .describe("Maximum number of results to return (1-100)"),
      startAt: z
        .coerce.number()
        .min(0)
        .default(0)
        .describe("Starting index for pagination"),
      fields: z
        .array(z.string())
        .optional()
        .describe('Extra fields to add to the compact default, e.g. ["description", "comment", "customfield_10010"]. System keys and customfield_ ids pass through; display names (Severity) are resolved with a live GET /field, so prefer ids.'),
    },
    async (args) => {
      const callLog = startToolCall("jira_search", args);
      try {
        const result = await searchIssues(
          args.jql,
          args.maxResults,
          args.startAt,
          args.fields
        );
        endToolCall(callLog, result);
        return { content: [{ type: "text", text: formatResponse(result) }] };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Get issue details
  server.tool(
    'jira_get_issue',
    'Get an issue: system fields plus custom fields that currently have a value, each as {id, name, value}. Comments, worklogs, and attachments are omitted unless include lists them. Null custom fields are omitted unless customFields is "all". To fetch specific custom fields (including empty ones), pass fields as customfield_ ids or unique edit-screen names (Severity). Call jira_get_edit_meta to see writable fields; do not call jira_get_fields for an update.',
    {
      issueKey: z.string().describe('Issue key (e.g., KP-123) or numeric issue ID'),
      expand: z.array(z.string()).optional().describe('Jira expand values in addition to names (e.g., changelog, renderedFields)'),
      include: z.array(z.enum(['comments', 'worklogs', 'attachments'])).optional()
        .describe('Collections to include. Default omits comments, worklogs, and attachments.'),
      customFields: z.enum(['set', 'all']).optional()
        .describe('set (default): only custom fields with values. all: include navigable custom fields that are null.'),
      fields: z.array(z.string()).optional()
        .describe('Narrow custom-field GET. Ids (customfield_11205) or unique editmeta names (Severity). Replaces *navigable for custom fields; requested fields are returned even if null.'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_issue', args);
      try {
        const issue = await getIssue(args.issueKey, {
          expand: args.expand,
          include: args.include,
          customFields: args.customFields,
          fields: args.fields,
        });
        endToolCall(callLog, issue);
        return { content: [{ type: 'text', text: formatResponse(issue) }] };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Create issue
  server.tool(
    'jira_create_issue',
    'Create a new Jira issue (bug, task, story, epic, subtask, etc.) in a project. Use jira_get_issue_types first if unsure which issue types are available. For subtasks, provide the parentKey. For custom fields, pass customFields keyed by field id or a unique name from jira_get_create_meta (not jira_get_fields). Returns the new issue key and URL.',
    {
      projectKey: z.string().describe('Project key (e.g., KP). Use jira_get_projects to list available projects'),
      issueType: z.string().describe('Issue type name (e.g., Bug, Task, Story, Epic, Sub-task). Use jira_get_issue_types to see available types'),
      summary: z.string().describe('Issue title/summary - a brief description of the issue'),
      description: z.string().optional().describe('Issue description'),
      assignee: z.string().optional().describe('Username to assign the issue to'),
      priority: z.string().optional().describe('Priority name (e.g., High, Medium, Low)'),
      labels: z.array(z.string()).optional().describe('Labels to add'),
      components: z.array(z.string()).optional().describe('Component names'),
      fixVersions: z.array(z.string()).optional().describe('Fix version names'),
      dueDate: z.string().optional().describe('Due date in YYYY-MM-DD format'),
      parentKey: z.string().optional().describe('Parent issue key for subtasks'),
      customFields: createCustomFieldsParam,
    },
    async (args) => {
      const callLog = startToolCall('jira_create_issue', args);
      try {
        const result = await createIssue(args.projectKey, args.issueType, args.summary, {
          description: args.description,
          assignee: args.assignee,
          priority: args.priority,
          labels: args.labels,
          components: args.components,
          fixVersions: args.fixVersions,
          dueDate: args.dueDate,
          parentKey: args.parentKey,
          customFields: args.customFields,
        });
        endToolCall(callLog, result);
        return { content: [{ type: 'text', text: formatResponse(result) }] };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Update issue
  server.tool(
    'jira_update_issue',
    'Modify an existing Jira issue\'s fields (summary, description, assignee, priority, labels, components, fix versions, due date, custom fields). Only the fields you specify will be changed - others remain unchanged. Custom fields use field ids (customfield_10006) or a unique name from jira_get_edit_meta, with raw REST values. Do not call jira_get_fields before writing. To change status/workflow state, use jira_transition_issue instead. To add comments, use jira_add_comment.',
    {
      issueKey: z.string().describe('Issue key to update (e.g., KP-123)'),
      summary: z.string().optional().describe('New issue title/summary'),
      description: z.string().optional().describe('New description text'),
      assignee: z.string().optional().describe('Username to assign to (use empty string "" to unassign, use jira_get_assignable_users to find valid usernames)'),
      priority: z.string().optional().describe('Priority name (e.g., Highest, High, Medium, Low, Lowest)'),
      labels: z.array(z.string()).optional().describe('New labels (replaces existing)'),
      components: z.array(z.string()).optional().describe('New components (replaces existing)'),
      fixVersions: z.array(z.string()).optional().describe('New fix versions (replaces existing)'),
      dueDate: z.string().optional().describe('New due date in YYYY-MM-DD format'),
      customFields: updateCustomFieldsParam,
    },
    async (args) => {
      const callLog = startToolCall('jira_update_issue', args);
      try {
        await updateIssue(args.issueKey, {
          summary: args.summary,
          description: args.description,
          assignee: args.assignee,
          priority: args.priority,
          labels: args.labels,
          components: args.components,
          fixVersions: args.fixVersions,
          dueDate: args.dueDate,
          customFields: args.customFields,
        });
        const result = { success: true, message: `Issue ${args.issueKey} updated successfully.` };
        endToolCall(callLog, result);
        return { content: [{ type: 'text', text: result.message }] };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Delete issue
  server.tool(
    'jira_delete_issue',
    'Permanently delete a Jira issue. WARNING: This action cannot be undone. If the issue has subtasks, you must set deleteSubtasks=true or the deletion will fail. Consider transitioning to a "Cancelled" or "Won\'t Do" status instead of deleting.',
    {
      issueKey: z.string().describe('Issue key to delete (e.g., KP-123)'),
      deleteSubtasks: zBoolean().default(false).describe('Set to true to also delete all subtasks. Required if the issue has subtasks.'),
    },
    async (args) => {
      const callLog = startToolCall('jira_delete_issue', args);
      try {
        await deleteIssue(args.issueKey, args.deleteSubtasks);
        const result = { success: true, message: `Issue ${args.issueKey} deleted successfully.` };
        endToolCall(callLog, result);
        return { content: [{ type: 'text', text: result.message }] };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Get issue changelog
  server.tool(
    'jira_get_changelog',
    'Get the complete change history of a Jira issue - shows who changed what field, when, and from/to values. Useful for auditing, understanding how an issue evolved, or finding when a specific change was made.',
    {
      issueKey: z.string().describe('Issue key to get history for (e.g., KP-123)'),
      startAt: z.coerce.number().min(0).default(0).describe('Starting index for pagination'),
      maxResults: z.coerce.number().min(1).max(100).default(100).describe('Maximum number of results'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_changelog', args);
      try {
        const changelog = await getIssueChangelog(args.issueKey, args.startAt, args.maxResults);
        endToolCall(callLog, changelog);
        return { content: [{ type: 'text', text: formatResponse(changelog) }] };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Generate filter URL with validation
  server.tool(
    'jira_generate_filter_url',
    'Generate a validated Jira filter URL with a JQL query. This tool first validates the JQL by searching Jira, then returns both the search results (first 50 issues) and a shareable URL. The URL format adapts automatically based on your Jira platform (Cloud vs Server). Use this to create shareable links and preview results. Common JQL examples: "updated >= -7d" (last 7 days), "created >= -1w" (last week), "assignee = currentUser() AND status = Open", "project = KP AND priority = High".',
    {
      jql: z.string().describe('JQL (Jira Query Language) query string. Examples: "updated >= -7d", "project = KP AND status = Open", "assignee = currentUser()"'),
    },
    async (args) => {
      const callLog = startToolCall('jira_generate_filter_url', args);
      try {
        const result = await generateFilterUrl(args.jql);
        endToolCall(callLog, result);
        
        // Format the response to show both the results and the URL
        const summary = {
          url: result.url,
          jql: result.jql,
          summary: {
            total: result.total,
            returned: result.issues.length,
            maxResults: result.maxResults,
          },
          issues: result.issues,
        };
        
        return { content: [{ type: 'text', text: formatResponse(summary) }] };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );
};
