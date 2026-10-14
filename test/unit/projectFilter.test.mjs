import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JIRA_BASE_URL = 'http://127.0.0.1:1';
process.env.JIRA_USERNAME = 'u';
process.env.JIRA_PASSWORD = 'p';
process.env.JIRA_PROJECTS_FILTER = 'ab, cd';

const { scopeJql, applyProjectFilter } = await import('../../dist/projectFilter.js');
const allowed = ['AB', 'CD'];

test('scopeJql wraps the query and keeps ORDER BY outside', () => {
  assert.equal(scopeJql('status = Open OR assignee = me ORDER BY created DESC', allowed),
    'project in ("AB", "CD") AND (status = Open OR assignee = me) ORDER BY created DESC');
  assert.equal(scopeJql('order by rank', allowed), 'project in ("AB", "CD") order by rank');
  assert.equal(scopeJql(undefined, allowed), 'project in ("AB", "CD")');
  assert.equal(scopeJql('summary ~ "sort order"', allowed), 'project in ("AB", "CD") AND (summary ~ "sort order")');
});

test('issue keys must belong to an allowed project', () => {
  assert.deepEqual(applyProjectFilter('jira_get_issue', { issueKey: 'ab-1' }), { issueKey: 'ab-1' });
  assert.throws(() => applyProjectFilter('jira_get_issue', { issueKey: 'ZZ-1' }), /outside the allowed projects/);
  assert.throws(() => applyProjectFilter('jira_get_issue', { issueKey: '10001' }), /not an issue key/);
  assert.throws(() => applyProjectFilter('jira_create_link', { inwardIssueKey: 'AB-1', outwardIssueKey: 'ZZ-2' }), /ZZ-2/);
  assert.throws(() => applyProjectFilter('jira_move_issues_to_sprint', { sprintId: 1, issueKeys: ['AB-1', 'XY-9'] }), /XY-9/);
});

test('project keys are checked and JQL tools are scoped', () => {
  assert.throws(() => applyProjectFilter('jira_create_issue', { projectKey: 'ZZ' }), /Project ZZ/);
  assert.equal(applyProjectFilter('jira_search', { jql: 'text ~ x' }).jql, 'project in ("AB", "CD") AND (text ~ x)');
  assert.equal(applyProjectFilter('jira_get_board_issues', { boardId: 1 }).jql, 'project in ("AB", "CD")');
});

test('JQL that closes the scope parenthesis is rejected', () => {
  assert.throws(() => scopeJql('a = 1) OR (project = SECRET', allowed), /unbalanced|parenthes/i);
  assert.throws(() => scopeJql('summary ~ "unterminated', allowed), /quote/i);
  assert.throws(() => scopeJql('(status = Open', allowed), /unbalanced|parenthes/i);
});

test('ORDER BY inside quotes is not treated as a clause', () => {
  assert.equal(scopeJql('summary ~ "sort order by date"', allowed),
    'project in ("AB", "CD") AND (summary ~ "sort order by date")');
  assert.equal(scopeJql("summary ~ 'a ) b' ORDER BY key", allowed),
    'project in ("AB", "CD") AND (summary ~ \'a ) b\') ORDER BY key');
  assert.equal(scopeJql('summary ~ "say \\"hi\\" (x"', allowed),
    'project in ("AB", "CD") AND (summary ~ "say \\"hi\\" (x")');
});

test('customFields cannot move an issue to another project', () => {
  assert.throws(() => applyProjectFilter('jira_create_issue', {
    projectKey: 'AB', customFields: { project: { key: 'ZZ' } },
  }), /customFields/);
  assert.throws(() => applyProjectFilter('jira_create_issue', {
    projectKey: 'AB', customFields: { parent: { key: 'ZZ-1' } },
  }), /customFields/);
});
