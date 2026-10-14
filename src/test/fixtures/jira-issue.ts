import type { JiraIssue, JiraIssueFields } from '../../types.js';

/** Minimal Jira issue envelope for unit tests. Extra field keys override the defaults. */
export const testIssue = (
  fieldOverrides?: Record<string, unknown>,
  names?: Record<string, string>,
): JiraIssue => ({
  id: '10001',
  key: 'ABC-123',
  self: 'https://jira.example.com/rest/api/2/issue/10001',
  names,
  fields: {
    summary: 'Test',
    status: { self: '', id: '1', name: 'Open' },
    issuetype: { self: '', id: '1', name: 'Bug', subtask: false },
    created: '2026-01-01T00:00:00.000+1100',
    updated: '2026-01-01T00:00:00.000+1100',
    ...fieldOverrides,
  } as JiraIssueFields,
});
