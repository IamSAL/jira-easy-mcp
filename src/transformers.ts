/**
 * Jira MCP Server - Data Transformers
 * 
 * Functions to transform Jira API responses to simplified formats.
 */

import { isCustomFieldId } from './custom-fields.js';
import type {
  JiraIssue,
  JiraIssueFields,
  JiraSearchResult,
  JiraTransition,
  JiraProject,
  JiraBoard,
  JiraSprint,
  JiraEditMetaField,
  JiraCreateMeta,
  SimplifiedCustomField,
  SimplifiedIssue,
  SimplifiedSearchResult,
  SimplifiedTransition,
  SimplifiedProject,
  SimplifiedBoard,
  SimplifiedSprint,
  SimplifiedAllowedValue,
  SimplifiedEditMetaField,
  SimplifiedEditMeta,
  SimplifiedCreateMeta,
} from './types.js';

export interface SimplifyIssueOptions {
  /** When true, keep custom fields whose value is null (cleared / empty). Default omits them. */
  includeNullCustomFields?: boolean;
  /** Field-id → display name. Issue `expand=names` or search-result names. */
  names?: Record<string, string>;
  /** When set, only these custom field ids are returned (narrow get/search). */
  customFieldIds?: string[];
}

export const toSimplifiedCustomFields = (
  fields: JiraIssueFields,
  options: SimplifyIssueOptions = {}
): SimplifiedCustomField[] => {
  const names = options.names;
  const includeNulls = options.includeNullCustomFields === true;
  const onlyIds = options.customFieldIds ? new Set(options.customFieldIds) : undefined;

  const rows: SimplifiedCustomField[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!isCustomFieldId(key) || value === undefined) {
      continue;
    }
    if (onlyIds && !onlyIds.has(key)) {
      continue;
    }
    if (value === null && !includeNulls) {
      continue;
    }
    const name = names?.[key];
    rows.push(name !== undefined ? { id: key, name, value } : { id: key, value });
  }
  return rows;
};

/**
 * Transform a Jira issue to simplified format.
 */
export const toSimplifiedIssue = (
  issue: JiraIssue,
  options: SimplifyIssueOptions = {}
): SimplifiedIssue => {
  const { fields } = issue;
  const customFields = toSimplifiedCustomFields(fields, {
    includeNullCustomFields: options.includeNullCustomFields,
    names: options.names ?? issue.names,
    customFieldIds: options.customFieldIds,
  });

  // Transform links
  const links = fields.issuelinks?.map(link => {
    const isInward = !!link.inwardIssue;
    const linkedIssue = isInward ? link.inwardIssue! : link.outwardIssue!;
    return {
      id: link.id,
      type: isInward ? link.type.inward : link.type.outward,
      direction: (isInward ? 'inward' : 'outward') as 'inward' | 'outward',
      linkedIssue: {
        key: linkedIssue.key,
        summary: linkedIssue.fields.summary,
        status: linkedIssue.fields.status.name,
        type: linkedIssue.fields.issuetype.name,
      },
    };
  });

  // Transform subtasks
  const subtasks = fields.subtasks?.map(subtask => ({
    key: subtask.key,
    summary: subtask.fields.summary,
    status: subtask.fields.status.name,
    type: subtask.fields.issuetype.name,
  }));

  // Transform parent
  const parent = fields.parent ? {
    key: fields.parent.key,
    summary: fields.parent.fields.summary,
    type: fields.parent.fields.issuetype.name,
  } : undefined;

  // Transform comments
  const comments = fields.comment?.comments.map(comment => ({
    id: comment.id,
    author: comment.author.displayName,
    body: comment.body,
    created: comment.created,
    updated: comment.updated,
  }));

  // Transform worklogs
  const worklogs = fields.worklog?.worklogs.map(worklog => ({
    id: worklog.id,
    author: worklog.author.displayName,
    timeSpent: worklog.timeSpent,
    started: worklog.started,
    comment: worklog.comment,
  }));

  // Transform attachments
  const attachments = fields.attachment?.map(att => ({
    id: att.id,
    filename: att.filename,
    author: att.author.displayName,
    size: att.size,
    mimeType: att.mimeType,
    created: att.created,
  }));

  return {
    key: issue.key,
    id: issue.id,
    self: issue.self,
    summary: fields.summary,
    status: fields.status.name,
    statusCategory: fields.status.statusCategory?.name,
    priority: fields.priority?.name,
    type: fields.issuetype.name,
    assignee: fields.assignee?.displayName,
    assigneeEmail: fields.assignee?.emailAddress,
    reporter: fields.reporter?.displayName,
    reporterEmail: fields.reporter?.emailAddress,
    description: fields.description,
    labels: fields.labels || [],
    components: fields.components?.map(c => c.name) || [],
    fixVersions: fields.fixVersions?.map(v => v.name) || [],
    resolution: fields.resolution?.name,
    created: fields.created,
    updated: fields.updated,
    dueDate: fields.duedate,
    parent,
    subtasks,
    links,
    comments,
    worklogs,
    attachments,
    timeTracking: fields.timetracking ? {
      originalEstimate: fields.timetracking.originalEstimate,
      remainingEstimate: fields.timetracking.remainingEstimate,
      timeSpent: fields.timetracking.timeSpent,
    } : undefined,
    customFields,
  };
};

/**
 * Transform Jira search result to simplified format.
 */
export const toSimplifiedSearchResult = (
  result: JiraSearchResult,
  options: SimplifyIssueOptions = {}
): SimplifiedSearchResult => {
  return {
    total: result.total,
    startAt: result.startAt,
    maxResults: result.maxResults,
    issues: result.issues.map(issue => toSimplifiedIssue(issue, {
      ...options,
      names: options.names ?? issue.names ?? result.names,
    })),
  };
};

/**
 * Transform Jira transition to simplified format.
 */
export const toSimplifiedTransition = (transition: JiraTransition): SimplifiedTransition => {
  const requiredFields = transition.fields
    ? Object.entries(transition.fields)
        .filter(([_, field]) => field.required)
        .map(([key, _]) => key)
    : undefined;

  return {
    id: transition.id,
    name: transition.name,
    toStatus: transition.to.name,
    toStatusCategory: transition.to.statusCategory?.name,
    hasScreen: transition.hasScreen || false,
    requiredFields: requiredFields && requiredFields.length > 0 ? requiredFields : undefined,
  };
};

/**
 * Transform Jira project to simplified format.
 */
export const toSimplifiedProject = (project: JiraProject): SimplifiedProject => {
  return {
    id: project.id,
    key: project.key.toUpperCase(),
    name: project.name,
    description: project.description,
    lead: project.lead?.displayName,
    projectType: project.projectTypeKey,
  };
};

/**
 * Transform Jira board to simplified format.
 */
export const toSimplifiedBoard = (board: JiraBoard): SimplifiedBoard => {
  return {
    id: board.id,
    name: board.name,
    type: board.type,
    projectKey: board.location?.projectKey,
    projectName: board.location?.projectName,
  };
};

/**
 * Transform Jira sprint to simplified format.
 */
export const toSimplifiedSprint = (sprint: JiraSprint): SimplifiedSprint => {
  return {
    id: sprint.id,
    name: sprint.name,
    state: sprint.state,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    completeDate: sprint.completeDate,
    goal: sprint.goal,
  };
};

const simplifyAllowedValue = (value: unknown): SimplifiedAllowedValue | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return typeof value === 'string' || typeof value === 'number'
      ? { value: String(value) }
      : undefined;
  }

  const raw = value as Record<string, unknown>;
  const simplified: SimplifiedAllowedValue = {};

  if (typeof raw.id === 'string' || typeof raw.id === 'number') {
    simplified.id = String(raw.id);
  }
  if (typeof raw.value === 'string') {
    simplified.value = raw.value;
  }
  if (typeof raw.name === 'string') {
    simplified.name = raw.name;
  }
  if (typeof raw.disabled === 'boolean') {
    simplified.disabled = raw.disabled;
  }
  if (Array.isArray(raw.children)) {
    const children = raw.children
      .map(simplifyAllowedValue)
      .filter((child): child is SimplifiedAllowedValue => child !== undefined);
    if (children.length > 0) {
      simplified.children = children;
    }
  }

  return Object.keys(simplified).length > 0 ? simplified : undefined;
};

/**
 * One field row from editmeta or createmeta.
 */
export const toSimplifiedMetaField = (
  id: string,
  field: JiraEditMetaField
): SimplifiedEditMetaField => {
  const allowedValues = field.allowedValues
    ?.map(simplifyAllowedValue)
    .filter((v): v is SimplifiedAllowedValue => v !== undefined);

  const simplified: SimplifiedEditMetaField = {
    id,
    name: field.name,
    required: field.required,
    type: field.schema?.type,
    customType: field.schema?.custom,
    operations: field.operations || [],
  };

  if (field.schema?.items) {
    simplified.itemsType = field.schema.items;
  }

  if (allowedValues && allowedValues.length > 0) {
    simplified.allowedValues = allowedValues;
  }

  return simplified;
};

const toSimplifiedMetaFields = (
  fields: Record<string, JiraEditMetaField> | undefined,
  customOnly: boolean = false
): SimplifiedEditMetaField[] =>
  Object.entries(fields || {})
    .filter(([id]) => !customOnly || isCustomFieldId(id))
    .map(([id, field]) => toSimplifiedMetaField(id, field));

export const toSimplifiedEditMeta = (
  issueKey: string,
  fields: Record<string, JiraEditMetaField> | undefined,
  customOnly: boolean = false
): SimplifiedEditMeta => ({
  issueKey,
  fields: toSimplifiedMetaFields(fields, customOnly),
});

/**
 * Flatten GET /issue/createmeta (projects.issuetypes.fields) to the same field rows as editmeta.
 */
export const toSimplifiedCreateMeta = (
  projectKey: string,
  raw: JiraCreateMeta
): SimplifiedCreateMeta => {
  const projectKeyUpper = projectKey.toUpperCase();
  const project = raw.projects?.find(p => p.key?.toUpperCase() === projectKeyUpper)
    ?? raw.projects?.[0];

  return {
    projectKey,
    issueTypes: (project?.issuetypes || []).map(issueType => ({
      id: issueType.id,
      name: issueType.name,
      subtask: Boolean(issueType.subtask),
      fields: toSimplifiedMetaFields(issueType.fields),
    })),
  };
};
