/**
 * Jira MCP Server - Data Transformers
 * 
 * Functions to transform Jira API responses to simplified formats.
 */

import type {
  JiraIssue,
  JiraSearchResult,
  JiraTransition,
  JiraProject,
  JiraBoard,
  JiraSprint,
  SimplifiedIssue,
  SimplifiedSearchResult,
  SimplifiedTransition,
  SimplifiedProject,
  SimplifiedBoard,
  SimplifiedSprint,
} from './types.js';

/**
 * Transform a Jira issue to simplified format.
 */
export const toSimplifiedIssue = (issue: JiraIssue): SimplifiedIssue => {
  const { fields } = issue;

  // Extract custom fields (fields starting with customfield_)
  const customFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('customfield_') && value !== null && value !== undefined) {
      customFields[key] = value;
    }
  }

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
export const toSimplifiedSearchResult = (result: JiraSearchResult): SimplifiedSearchResult => {
  return {
    total: result.total,
    startAt: result.startAt,
    maxResults: result.maxResults,
    issues: result.issues.map(toSimplifiedIssue),
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
