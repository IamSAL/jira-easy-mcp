/**
 * Jira MCP Server - Tools Module Barrel Export
 * 
 * Re-exports all tool registration functions.
 */

export { registerIssueTools } from './issues.js';
export { registerCommentTools } from './comments.js';
export { registerTransitionTools } from './transitions.js';
export { registerProjectTools } from './projects.js';
export { registerBoardTools } from './boards.js';
export { registerSprintTools } from './sprints.js';
export { registerWorklogTools } from './worklogs.js';
export { registerLinkTools } from './links.js';
export { registerUserTools } from './users.js';
export { registerFieldTools } from './fields.js';

// Re-export core functions for direct use
export { searchIssues, getIssue, createIssue, updateIssue, deleteIssue } from './issues.js';
export { addComment, getComments } from './comments.js';
export { getTransitions, transitionIssue } from './transitions.js';
export { getAllProjects, getProject, getProjectVersions, createVersion } from './projects.js';
export { getBoards, getBoardIssues } from './boards.js';
export { getSprintsFromBoard, getSprintIssues, createSprint, updateSprint } from './sprints.js';
export { getWorklogs, addWorklog, deleteWorklog } from './worklogs.js';
export { getIssueLinkTypes, createIssueLink, deleteIssueLink, createRemoteLink } from './links.js';
export { getCurrentUser, getUser, searchUsers, getAssignableUsers } from './users.js';
export { getAllFields, getCreateMeta, getProjectIssueTypes } from './fields.js';
