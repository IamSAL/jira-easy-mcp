/**
 * Jira MCP Server - Type Definitions
 * 
 * TypeScript interfaces for Jira API responses and internal data structures.
 */

// =============================================================================
// Configuration Types
// =============================================================================

export interface JiraConfig {
  baseUrl: string;
  username: string;
  password: string;
  projectsFilter?: string[];
}

// =============================================================================
// User Types
// =============================================================================

export interface JiraUser {
  self: string;
  key: string;
  name: string;
  emailAddress?: string;
  displayName: string;
  active: boolean;
  avatarUrls?: Record<string, string>;
  timeZone?: string;
}

// =============================================================================
// Issue Types
// =============================================================================

export interface JiraIssueType {
  self: string;
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  subtask: boolean;
}

export interface JiraStatus {
  self: string;
  id: string;
  name: string;
  description?: string;
  statusCategory?: {
    self: string;
    id: number;
    key: string;
    name: string;
    colorName: string;
  };
}

export interface JiraPriority {
  self: string;
  id: string;
  name: string;
  iconUrl?: string;
}

export interface JiraResolution {
  self: string;
  id: string;
  name: string;
  description?: string;
}

export interface JiraComponent {
  self: string;
  id: string;
  name: string;
  description?: string;
}

export interface JiraVersion {
  self: string;
  id: string;
  name: string;
  description?: string;
  archived: boolean;
  released: boolean;
  releaseDate?: string;
  startDate?: string;
}

export interface JiraComment {
  self: string;
  id: string;
  author: JiraUser;
  body: string;
  created: string;
  updated: string;
  updateAuthor?: JiraUser;
}

export interface JiraWorklog {
  self: string;
  id: string;
  author: JiraUser;
  updateAuthor?: JiraUser;
  comment?: string;
  started: string;
  timeSpent: string;
  timeSpentSeconds: number;
  created: string;
  updated: string;
}

export interface JiraAttachment {
  self: string;
  id: string;
  filename: string;
  author: JiraUser;
  created: string;
  size: number;
  mimeType: string;
  content: string;
}

export interface JiraIssueLink {
  id: string;
  self: string;
  type: {
    id: string;
    name: string;
    inward: string;
    outward: string;
  };
  inwardIssue?: {
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      status: JiraStatus;
      issuetype: JiraIssueType;
    };
  };
  outwardIssue?: {
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      status: JiraStatus;
      issuetype: JiraIssueType;
    };
  };
}

export interface JiraIssueFields {
  summary: string;
  description?: string;
  status: JiraStatus;
  priority?: JiraPriority;
  issuetype: JiraIssueType;
  assignee?: JiraUser;
  reporter?: JiraUser;
  creator?: JiraUser;
  labels?: string[];
  components?: JiraComponent[];
  fixVersions?: JiraVersion[];
  versions?: JiraVersion[];
  resolution?: JiraResolution;
  resolutiondate?: string;
  created: string;
  updated: string;
  duedate?: string;
  parent?: {
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      status: JiraStatus;
      issuetype: JiraIssueType;
    };
  };
  subtasks?: Array<{
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      status: JiraStatus;
      issuetype: JiraIssueType;
    };
  }>;
  issuelinks?: JiraIssueLink[];
  comment?: {
    comments: JiraComment[];
    maxResults: number;
    total: number;
    startAt: number;
  };
  worklog?: {
    worklogs: JiraWorklog[];
    maxResults: number;
    total: number;
    startAt: number;
  };
  attachment?: JiraAttachment[];
  timetracking?: {
    originalEstimate?: string;
    remainingEstimate?: string;
    timeSpent?: string;
    originalEstimateSeconds?: number;
    remainingEstimateSeconds?: number;
    timeSpentSeconds?: number;
  };
  [key: string]: unknown;
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  expand?: string;
  fields: JiraIssueFields;
  renderedFields?: Record<string, unknown>;
  changelog?: {
    startAt: number;
    maxResults: number;
    total: number;
    histories: Array<{
      id: string;
      author: JiraUser;
      created: string;
      items: Array<{
        field: string;
        fieldtype: string;
        from: string | null;
        fromString: string | null;
        to: string | null;
        toString: string | null;
      }>;
    }>;
  };
}

// =============================================================================
// Search Types
// =============================================================================

export interface JiraSearchResult {
  expand: string;
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
  names?: Record<string, string>;
  schema?: Record<string, { type: string; system?: string; custom?: string }>;
}

// =============================================================================
// Transition Types
// =============================================================================

export interface JiraTransition {
  id: string;
  name: string;
  to: JiraStatus;
  hasScreen?: boolean;
  isGlobal?: boolean;
  isInitial?: boolean;
  isConditional?: boolean;
  fields?: Record<string, {
    required: boolean;
    schema: { type: string; system?: string };
    name: string;
    operations: string[];
    allowedValues?: unknown[];
  }>;
}

export interface JiraTransitionsResult {
  expand: string;
  transitions: JiraTransition[];
}

// =============================================================================
// Project Types
// =============================================================================

export interface JiraProject {
  self: string;
  id: string;
  key: string;
  name: string;
  description?: string;
  lead?: JiraUser;
  projectTypeKey?: string;
  avatarUrls?: Record<string, string>;
  projectCategory?: {
    self: string;
    id: string;
    name: string;
    description?: string;
  };
  archived?: boolean;
}

// =============================================================================
// Agile Types (Boards, Sprints)
// =============================================================================

export interface JiraBoard {
  id: number;
  self: string;
  name: string;
  type: 'scrum' | 'kanban' | 'simple';
  location?: {
    projectId: number;
    projectKey: string;
    projectName: string;
  };
}

export interface JiraBoardsResult {
  maxResults: number;
  startAt: number;
  total: number;
  isLast: boolean;
  values: JiraBoard[];
}

export interface JiraSprint {
  id: number;
  self: string;
  state: 'active' | 'future' | 'closed';
  name: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  originBoardId?: number;
  goal?: string;
}

export interface JiraSprintsResult {
  maxResults: number;
  startAt: number;
  total: number;
  isLast: boolean;
  values: JiraSprint[];
}

// =============================================================================
// Field Types
// =============================================================================

export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
  orderable: boolean;
  navigable: boolean;
  searchable: boolean;
  clauseNames?: string[];
  schema?: {
    type: string;
    system?: string;
    custom?: string;
    customId?: number;
  };
}

// =============================================================================
// Issue Link Types
// =============================================================================

export interface JiraIssueLinkType {
  id: string;
  name: string;
  inward: string;
  outward: string;
  self: string;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface JiraApiError {
  errorMessages: string[];
  errors: Record<string, string>;
  status?: number;
}

export interface CreateIssueResponse {
  id: string;
  key: string;
  self: string;
}

export interface CreateCommentResponse {
  self: string;
  id: string;
  author: JiraUser;
  body: string;
  created: string;
  updated: string;
}

export interface CreateWorklogResponse {
  self: string;
  id: string;
  author: JiraUser;
  timeSpent: string;
  timeSpentSeconds: number;
  started: string;
  created: string;
  updated: string;
}

// =============================================================================
// Simplified Types (for tool responses)
// =============================================================================

export interface SimplifiedIssue {
  key: string;
  id: string;
  self: string;
  summary: string;
  status: string;
  statusCategory?: string;
  priority?: string;
  type: string;
  assignee?: string;
  assigneeEmail?: string;
  reporter?: string;
  reporterEmail?: string;
  description?: string;
  labels: string[];
  components: string[];
  fixVersions: string[];
  resolution?: string;
  created: string;
  updated: string;
  dueDate?: string;
  parent?: {
    key: string;
    summary: string;
    type: string;
  };
  subtasks?: Array<{
    key: string;
    summary: string;
    status: string;
    type: string;
  }>;
  links?: Array<{
    id: string;
    type: string;
    direction: 'inward' | 'outward';
    linkedIssue: {
      key: string;
      summary: string;
      status: string;
      type: string;
    };
  }>;
  comments?: Array<{
    id: string;
    author: string;
    body: string;
    created: string;
    updated: string;
  }>;
  worklogs?: Array<{
    id: string;
    author: string;
    timeSpent: string;
    started: string;
    comment?: string;
  }>;
  attachments?: Array<{
    id: string;
    filename: string;
    author: string;
    size: number;
    mimeType: string;
    created: string;
  }>;
  timeTracking?: {
    originalEstimate?: string;
    remainingEstimate?: string;
    timeSpent?: string;
  };
  customFields: Record<string, unknown>;
}

export interface SimplifiedSearchResult {
  total: number;
  startAt: number;
  maxResults: number;
  issues: SimplifiedIssue[];
}

export interface SimplifiedTransition {
  id: string;
  name: string;
  toStatus: string;
  toStatusCategory?: string;
  hasScreen: boolean;
  requiredFields?: string[];
}

export interface SimplifiedProject {
  id: string;
  key: string;
  name: string;
  description?: string;
  lead?: string;
  projectType?: string;
}

export interface SimplifiedBoard {
  id: number;
  name: string;
  type: string;
  projectKey?: string;
  projectName?: string;
}

export interface SimplifiedSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
}
