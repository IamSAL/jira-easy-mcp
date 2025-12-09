/**
 * Jira MCP Server - Issue Tools
 * 
 * Tools for searching, getting, creating, updating, and deleting issues.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jiraGet, jiraPost, jiraPut, jiraDelete } from '../client.js';
import { formatResponse, getConfig } from '../config.js';
import { startToolCall, endToolCall, failToolCall } from '../logger.js';
import { toSimplifiedIssue, toSimplifiedSearchResult } from '../transformers.js';
import type {
  JiraIssue,
  JiraSearchResult,
  CreateIssueResponse,
  SimplifiedIssue,
  SimplifiedSearchResult,
} from '../types.js';

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

/**
 * Search issues by JQL.
 */
export const searchIssues = async (
  jql: string,
  maxResults: number = 50,
  startAt: number = 0,
  fields?: string[]
): Promise<SimplifiedSearchResult> => {
  const defaultFields = [
    'summary', 'status', 'priority', 'issuetype', 'assignee', 'reporter',
    'description', 'labels', 'components', 'fixVersions', 'resolution',
    'created', 'updated', 'duedate', 'parent', 'subtasks', 'issuelinks',
    'comment', 'worklog', 'attachment', 'timetracking'
  ];

  const params = new URLSearchParams({
    jql,
    maxResults: maxResults.toString(),
    startAt: startAt.toString(),
    fields: (fields || defaultFields).join(','),
  });

  const result = await jiraGet<JiraSearchResult>(`/search?${params}`);
  return toSimplifiedSearchResult(result);
};

/**
 * Get a single issue by key or ID.
 */
export const getIssue = async (
  issueKey: string,
  expand?: string[]
): Promise<SimplifiedIssue> => {
  const fields = [
    'summary', 'status', 'priority', 'issuetype', 'assignee', 'reporter',
    'description', 'labels', 'components', 'fixVersions', 'resolution',
    'created', 'updated', 'duedate', 'parent', 'subtasks', 'issuelinks',
    'comment', 'worklog', 'attachment', 'timetracking', 'versions'
  ];

  const params = new URLSearchParams({
    fields: fields.join(','),
  });

  if (expand && expand.length > 0) {
    params.set('expand', expand.join(','));
  }

  const issue = await jiraGet<JiraIssue>(`/issue/${issueKey}?${params}`);
  return toSimplifiedIssue(issue);
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
  if (options?.customFields) {
    Object.assign(fields, options.customFields);
  }

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
  if (updates.customFields) {
    Object.assign(fields, updates.customFields);
  }

  await jiraPut(`/issue/${issueKey}`, { fields });
};

/**
 * Delete an issue.
 */
export const deleteIssue = async (
  issueKey: string,
  deleteSubtasks: boolean = false
): Promise<void> => {
  const params = deleteSubtasks ? '?deleteSubtasks=true' : '';
  await jiraDelete(`/issue/${issueKey}${params}`);
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

  const issue = await jiraGet<JiraIssue>(`/issue/${issueKey}?${params}`);
  return issue.changelog;
};

/**
 * Register issue tools with the MCP server.
 */
export const registerIssueTools = (server: McpServer): void => {
  // Search issues by JQL
  server.tool(
    "jira_search",
    'Search for Jira issues using JQL (Jira Query Language). Use this to find issues by project, status, assignee, labels, sprint, or any combination of criteria. Returns issue key, summary, status, assignee, and other fields. Common JQL examples: "project = KP", "assignee = currentUser()", "status = "In Progress"", "sprint in openSprints()", "labels = bug AND priority = High". if its relevant for user to get a shareable link for the current search, user can get a link like https://konaway.konai.com/issues/?jql=project%20%3D%20KP%20AND%20issuetype%20%3D%20%22Portal%20Bug%22%20AND%20resolution%20%3D%20Unresolved%20ORDER%20BY%20priority%20DESC%2C%20updated%20DESC with the filters applied for current search.',
    {
      jql: z
        .string()
        .describe(
          'JQL query string. Examples: "project = KP AND status = Open", "assignee = currentUser() ORDER BY updated DESC", "sprint in openSprints() AND status != Done"'
        ),
      maxResults: z
        .number()
        .min(1)
        .max(100)
        .default(50)
        .describe("Maximum number of results to return (1-100)"),
      startAt: z
        .number()
        .min(0)
        .default(0)
        .describe("Starting index for pagination"),
      fields: z
        .array(z.string())
        .optional()
        .describe("Specific fields to return (optional)"),
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
    'Get full details of a specific Jira issue including summary, description, status, assignee, reporter, priority, comments, worklogs, attachments, subtasks, and linked issues. Use this when you need comprehensive information about a single issue or want to see its current state, history, or relationships.',
    {
      issueKey: z.string().describe('Issue key (e.g., KP-123) or numeric issue ID'),
      expand: z.array(z.string()).optional().describe('Fields to expand (e.g., changelog, renderedFields)'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_issue', args);
      try {
        const issue = await getIssue(args.issueKey, args.expand);
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
    'Create a new Jira issue (bug, task, story, epic, subtask, etc.) in a project. Use jira_get_issue_types first if unsure which issue types are available. For subtasks, provide the parentKey. Returns the new issue key and URL.',
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
    'Modify an existing Jira issue\'s fields (summary, description, assignee, priority, labels, components, fix versions, due date). Only the fields you specify will be changed - others remain unchanged. To change status/workflow state, use jira_transition_issue instead. To add comments, use jira_add_comment.',
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
      deleteSubtasks: z.boolean().default(false).describe('Set to true to also delete all subtasks. Required if the issue has subtasks.'),
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
      startAt: z.number().min(0).default(0).describe('Starting index for pagination'),
      maxResults: z.number().min(1).max(100).default(100).describe('Maximum number of results'),
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
