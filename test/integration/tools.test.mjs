/**
 * End-to-end tests for every MCP tool against a real Jira instance.
 *
 * Run against a Docker Jira (see jira-docker.mjs) or any disposable instance:
 *   JIRA_IT_BASE_URL=http://localhost:8091 node --test test/integration/tools.test.mjs
 *
 * Expects: admin user (JIRA_IT_USERNAME/PASSWORD, default admin / Jira-IT-admin-1), a Scrum
 * project "IT" with a board, a second project "OT", and a second user "jdoe". The suite creates and
 * deletes its own issues.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jiraEnv, startServer } from './helpers.mjs';

const env = jiraEnv();
const PROJECT = 'IT';
// 1x1 red PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
);

describe('MCP tools against live Jira', { skip: !env && 'JIRA_IT_BASE_URL not set' }, () => {
  let server;
  const state = {};

  before(async () => {
    server = await startServer(env);
  });

  after(async () => {
    // Best-effort cleanup of issues this run created
    for (const key of [state.subtaskKey, state.storyKey, state.bugKey, state.taskKey, state.epicKey].filter(Boolean)) {
      await server.call('jira_delete_issue', { issueKey: key, deleteSubtasks: true });
    }
    await server?.close();
  });

  describe('discovery', () => {
    it('lists all tools with input schemas', async () => {
      const { tools } = await server.client.listTools();
      assert.ok(tools.length >= 42, `expected >= 42 tools, got ${tools.length}`);
      for (const tool of tools) {
        assert.equal(tool.inputSchema.type, 'object', `${tool.name} schema`);
        assert.ok(tool.description.length > 20, `${tool.name} needs a description`);
      }
    });

    it('jira_get_myself', async () => {
      const { json } = await server.ok('jira_get_myself');
      assert.equal(json.name, env.JIRA_USERNAME);
    });

    it('jira_get_projects / jira_get_project', async () => {
      const projects = (await server.ok('jira_get_projects')).json;
      assert.ok(projects.some(p => p.key === PROJECT));
      const project = (await server.ok('jira_get_project', { projectKey: PROJECT })).json;
      assert.equal(project.key, PROJECT);
    });

    it('jira_get_issue_types', async () => {
      const { json } = await server.ok('jira_get_issue_types', { projectKey: PROJECT });
      const names = json.map(t => t.name);
      for (const name of ['Bug', 'Task', 'Story']) assert.ok(names.includes(name), `missing ${name}: ${names}`);
      state.subtaskType = json.find(t => t.subtask)?.name;
      assert.ok(state.subtaskType, 'project has a sub-task type');
    });

    it('unknown project gives a clear error', async () => {
      for (const tool of ['jira_get_issue_types', 'jira_get_create_meta']) {
        const result = await server.call(tool, { projectKey: 'NOSUCH' });
        assert.equal(result.isError, true);
        assert.match(result.text, /Project NOSUCH not found/, `${tool}: ${result.text}`);
      }
    });

    it('jira_get_create_meta', async () => {
      const { json, text } = await server.ok('jira_get_create_meta', { projectKey: PROJECT, issueTypes: ['Bug'] });
      assert.ok(json, `create meta is JSON: ${text.slice(0, 200)}`);
      assert.match(text, /summary/i);
    });

    it('jira_get_fields', async () => {
      const all = (await server.ok('jira_get_fields')).json;
      assert.ok(all.some(f => f.id === 'summary'));
      const custom = (await server.ok('jira_get_fields', { customOnly: true })).json;
      assert.ok(custom.length > 0 && custom.every(f => f.custom));
      state.epicNameField = custom.find(f => f.name === 'Epic Name')?.id;
    });

    it('jira_get_link_types', async () => {
      const { json } = await server.ok('jira_get_link_types');
      assert.ok(json.some(t => t.name === 'Relates'), JSON.stringify(json));
    });
  });

  describe('issue lifecycle', () => {
    it('jira_create_issue (Task, unicode + multiline)', async () => {
      const { json } = await server.ok('jira_create_issue', {
        projectKey: PROJECT,
        issueType: 'Task',
        summary: 'IT task – ünïcødé 🚀 "quotes" & <tags>',
        description: 'Line 1\nLine 2 with *wiki* markup\n{code}x = 1{code}',
        labels: ['it-test', 'mcp'],
        priority: 'High',
      });
      assert.match(json.key, /^IT-\d+$/);
      state.taskKey = json.key;
    });

    it('jira_create_issue (Bug assigned to another user)', async () => {
      const { json } = await server.ok('jira_create_issue', {
        projectKey: PROJECT, issueType: 'Bug', summary: 'IT bug', assignee: 'jdoe',
      });
      state.bugKey = json.key;
    });

    it('jira_create_issue (Story)', async () => {
      const { json } = await server.ok('jira_create_issue', { projectKey: PROJECT, issueType: 'Story', summary: 'IT story' });
      state.storyKey = json.key;
    });

    it('jira_create_issue (Epic needs customFields: Epic Name)', async (t) => {
      if (!state.epicNameField) return t.skip('no Epic Name field on this version');
      const withoutName = await server.call('jira_create_issue', { projectKey: PROJECT, issueType: 'Epic', summary: 'IT epic' });
      assert.equal(withoutName.isError, true, 'Epic Name is required');
      const { json } = await server.ok('jira_create_issue', {
        projectKey: PROJECT, issueType: 'Epic', summary: 'IT epic', customFields: { [state.epicNameField]: 'IT Epic' },
      });
      state.epicKey = json.key;
      const search = await server.ok('jira_search', { jql: `key = ${json.key}`, fields: ['summary', state.epicNameField] });
      assert.match(search.text, /IT Epic/);
    });

    it('jira_create_issue (sub-task with parentKey)', async () => {
      const { json } = await server.ok('jira_create_issue', {
        projectKey: PROJECT, issueType: state.subtaskType, summary: 'IT subtask', parentKey: state.taskKey,
      });
      state.subtaskKey = json.key;
    });

    it('jira_get_issue round-trips fields', async () => {
      const { json } = await server.ok('jira_get_issue', { issueKey: state.taskKey });
      assert.equal(json.key, state.taskKey);
      assert.equal(json.summary, 'IT task – ünïcødé 🚀 "quotes" & <tags>');
      assert.match(json.description, /Line 2/);
      assert.deepEqual([...json.labels].sort(), ['it-test', 'mcp']);
      assert.equal(json.priority, 'High');
      assert.ok(JSON.stringify(json).includes(state.subtaskKey), 'subtask listed on parent');
    });

    it('jira_update_issue (standard fields + unassign)', async () => {
      await server.ok('jira_update_issue', {
        issueKey: state.bugKey, summary: 'IT bug (updated)', labels: ['updated'], assignee: '',
      });
      const { json } = await server.ok('jira_get_issue', { issueKey: state.bugKey });
      assert.equal(json.summary, 'IT bug (updated)');
      assert.deepEqual(json.labels, ['updated']);
      assert.ok(!json.assignee, `expected unassigned, got ${JSON.stringify(json.assignee)}`);
    });

    it('jira_update_issue (customFields: Epic Name)', async (t) => {
      if (!state.epicKey) return t.skip('no epic');
      await server.ok('jira_update_issue', { issueKey: state.epicKey, customFields: { [state.epicNameField]: 'Renamed Epic' } });
      const search = await server.ok('jira_search', { jql: `key = ${state.epicKey}`, fields: ['summary', state.epicNameField] });
      assert.match(search.text, /Renamed Epic/);
    });

    it('jira_get_edit_meta lists the editable custom fields (from #1)', async (t) => {
      if (!state.epicKey) return t.skip('no epic');
      const { json } = await server.ok('jira_get_edit_meta', { issueKey: state.epicKey, customOnly: true });
      const epicName = json.fields.find(f => f.id === state.epicNameField);
      assert.ok(epicName, `Epic Name editable: ${JSON.stringify(json).slice(0, 400)}`);
      assert.equal(epicName.name, 'Epic Name');
      assert.ok(json.fields.every(f => f.id.startsWith('customfield_')));
    });

    it('custom fields can be written by display name and read back as {id, name, value} (from #1)', async (t) => {
      if (!state.epicKey) return t.skip('no epic');
      await server.ok('jira_update_issue', { issueKey: state.epicKey, customFields: { 'Epic Name': 'Named Epic' } });
      const { json } = await server.ok('jira_get_issue', { issueKey: state.epicKey });
      const row = json.customFields.find(f => f.id === state.epicNameField);
      assert.deepEqual(row, { id: state.epicNameField, name: 'Epic Name', value: 'Named Epic' });
      const unknown = await server.call('jira_update_issue', { issueKey: state.epicKey, customFields: { 'No Such Field': 1 } });
      assert.equal(unknown.isError, true);
      assert.match(unknown.text, /No Such Field/);
    });

    it('jira_get_issue omits comments unless included (from #1)', async () => {
      await server.ok('jira_add_comment', { issueKey: state.bugKey, body: 'visible only with include' });
      const slim = await server.ok('jira_get_issue', { issueKey: state.bugKey });
      assert.equal(slim.json.comments, undefined);
      const full = await server.ok('jira_get_issue', { issueKey: state.bugKey, include: ['comments'] });
      assert.match(JSON.stringify(full.json.comments), /visible only with include/);
    });

    it('field not on screen gives an actionable error', async () => {
      const result = await server.call('jira_update_issue', { issueKey: state.bugKey, customFields: { customfield_99999: 'x' } });
      assert.equal(result.isError, true);
      assert.match(result.text, /customfield_99999/);
    });

    it('jira_search (JQL with quotes, ORDER BY, paging)', async () => {
      const { json } = await server.ok('jira_search', {
        jql: `project = ${PROJECT} AND labels = "it-test" ORDER BY created DESC`, maxResults: 1,
      });
      assert.equal(json.issues.length, 1);
      assert.ok(json.total >= 1);
      assert.equal(json.issues[0].key, state.taskKey);
    });

    it('jira_search is compact by default (fits MCP client output limits)', async () => {
      const { json, text } = await server.ok('jira_search', { jql: `key = ${state.taskKey}` });
      assert.equal(json.issues[0].description, undefined, 'description only via fields/jira_get_issue');
      assert.equal(json.issues[0].comments, undefined);
      assert.ok(text.length < 1500, `one issue took ${text.length} chars`);
      const full = await server.ok('jira_search', { jql: `key = ${state.taskKey}`, fields: ['summary', 'description'] });
      assert.match(full.json.issues[0].description, /Line 2/);
    });

    it('jira_search with invalid JQL returns a readable error', async () => {
      const result = await server.call('jira_search', { jql: 'project = = broken' });
      assert.equal(result.isError, true);
      assert.match(result.text, /jql|query|error/i);
    });

    it('jira_generate_filter_url', async () => {
      const { json } = await server.ok('jira_generate_filter_url', { jql: `project = ${PROJECT}` });
      assert.match(json.url, /issues\/\?jql=project/);
    });

    it('jira_get_changelog', async () => {
      const { json, text } = await server.ok('jira_get_changelog', { issueKey: state.bugKey });
      assert.ok(json, text);
      assert.match(text, /summary|labels/i);
    });
  });

  describe('comments', () => {
    it('add / list / update / delete', async () => {
      const added = await server.ok('jira_add_comment', { issueKey: state.taskKey, body: 'First comment ✅' });
      const commentId = added.text.match(/Comment ID: (\d+)/)?.[1];
      assert.ok(commentId, added.text);

      await server.ok('jira_update_comment', { issueKey: state.taskKey, commentId, body: 'Edited comment' });
      const list = await server.ok('jira_get_comments', { issueKey: state.taskKey });
      assert.match(list.text, /Edited comment/);

      await server.ok('jira_delete_comment', { issueKey: state.taskKey, commentId });
      const after = await server.ok('jira_get_comments', { issueKey: state.taskKey });
      assert.doesNotMatch(after.text, /Edited comment/);
    });
  });

  describe('transitions', () => {
    it('list and apply a transition with a comment', async () => {
      const { json } = await server.ok('jira_get_transitions', { issueKey: state.bugKey });
      assert.ok(json.length > 0, 'has transitions');
      const target = json.find(t => /progress/i.test(t.name)) || json[0];
      await server.ok('jira_transition_issue', {
        issueKey: state.bugKey, transitionId: String(target.id), comment: 'Moving via MCP',
      });
      const issue = (await server.ok('jira_get_issue', { issueKey: state.bugKey })).json;
      assert.notEqual(issue.status, 'To Do');
    });
  });

  describe('worklogs', () => {
    it('add / list / delete', async () => {
      const added = await server.ok('jira_add_worklog', {
        issueKey: state.taskKey, timeSpent: '1h 30m', comment: 'Worked',
        started: '2030-01-10T09:00:00.000+0000',
      });
      const worklogId = added.text.match(/Worklog ID: (\d+)/)?.[1];
      assert.ok(worklogId, added.text);
      const list = await server.ok('jira_get_worklogs', { issueKey: state.taskKey });
      assert.match(list.text, /1h 30m/);
      await server.ok('jira_delete_worklog', { issueKey: state.taskKey, worklogId });
    });

    it('add worklog without started (defaults to now)', async () => {
      const added = await server.ok('jira_add_worklog', { issueKey: state.taskKey, timeSpent: '15m' });
      assert.match(added.text, /Worklog ID/);
    });
  });

  describe('links (issue #2)', () => {
    it('create link succeeds on 201 with empty body, then delete', async () => {
      const created = await server.ok('jira_create_link', {
        inwardIssueKey: state.taskKey, outwardIssueKey: state.bugKey, linkType: 'Relates', comment: 'related',
      });
      assert.match(created.text, /Link created/);

      const issue = (await server.ok('jira_get_issue', { issueKey: state.taskKey })).json;
      const link = issue.issueLinks?.find(l => JSON.stringify(l).includes(state.bugKey))
        ?? issue.links?.find(l => JSON.stringify(l).includes(state.bugKey));
      assert.ok(link, `link visible on issue: ${JSON.stringify(issue).slice(0, 800)}`);
      await server.ok('jira_delete_link', { linkId: String(link.id) });
    });

    it('remote links', async () => {
      const created = await server.ok('jira_create_remote_link', {
        issueKey: state.taskKey, url: 'https://example.com/doc?a=1&b=2', title: 'Spec', summary: 'Design doc',
      });
      assert.match(created.text, /Remote link created/);
      const list = await server.ok('jira_get_remote_links', { issueKey: state.taskKey });
      assert.match(list.text, /example\.com/);
    });
  });

  describe('attachments', () => {
    it('upload a PNG, then read it back as an inline image', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'jira-it-'));
      const file = join(dir, 'screen shot ü.png');
      await writeFile(file, PNG);

      const uploaded = await server.ok('jira_upload_attachment', { issueKey: state.taskKey, filePath: file });
      assert.equal(uploaded.json[0].mimeType, 'image/png');

      const images = await server.ok('jira_get_issue_images', { issueKey: state.taskKey });
      const image = images.content.find(c => c.type === 'image');
      assert.ok(image, `image content returned: ${images.text}`);
      assert.equal(image.mimeType, 'image/png');
      assert.deepEqual(Buffer.from(image.data, 'base64'), PNG);
    });

    it('upload a non-image file and skip it for images', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'jira-it-'));
      const file = join(dir, 'notes.txt');
      await writeFile(file, 'hello');
      const uploaded = await server.ok('jira_upload_attachment', { issueKey: state.bugKey, filePath: file });
      const result = await server.ok('jira_get_issue_images', {
        issueKey: state.bugKey, attachmentId: String(uploaded.json[0].id),
      });
      assert.equal(result.json.imageCount, 0);
      assert.equal(result.json.skipped.length, 1);
    });

    it('relative path is rejected', async () => {
      const result = await server.call('jira_upload_attachment', { issueKey: state.taskKey, filePath: 'x.png' });
      assert.equal(result.isError, true);
      assert.match(result.text, /absolute/);
    });
  });

  describe('agile', () => {
    it('boards, sprints, sprint issues', async () => {
      const boards = (await server.ok('jira_get_boards', { projectKey: PROJECT })).json;
      const board = (boards.values || boards.boards || boards)[0];
      assert.ok(board?.id, `board found: ${JSON.stringify(boards).slice(0, 300)}`);
      state.boardId = board.id;

      const boardIssues = await server.ok('jira_get_board_issues', { boardId: board.id, maxResults: 5 });
      assert.ok(boardIssues.json);

      const sprint = (await server.ok('jira_create_sprint', {
        boardId: board.id, name: 'IT Sprint', goal: 'Ship it',
      })).json;
      assert.ok(sprint.id, JSON.stringify(sprint));
      state.sprintId = sprint.id;

      const updated = (await server.ok('jira_update_sprint', { sprintId: sprint.id, name: 'IT Sprint 2' })).json;
      assert.equal(updated.name, 'IT Sprint 2');

      await server.ok('jira_move_issues_to_sprint', { sprintId: sprint.id, issueKeys: [state.storyKey] });
      const sprintIssues = await server.ok('jira_get_sprint_issues', { sprintId: sprint.id });
      assert.match(sprintIssues.text, new RegExp(state.storyKey));

      const sprints = await server.ok('jira_get_sprints', { boardId: board.id, state: 'future' });
      assert.match(sprints.text, /IT Sprint 2/);
    });
  });

  describe('versions', () => {
    it('create and list project versions', async () => {
      const name = `v-it-${Date.now()}`;
      await server.ok('jira_create_version', {
        projectKey: PROJECT, name, description: 'IT', releaseDate: '2030-12-31',
      });
      const versions = await server.ok('jira_get_project_versions', { projectKey: PROJECT });
      assert.match(versions.text, new RegExp(name));
    });
  });

  describe('users', () => {
    it('get / search / assignable', async () => {
      const user = (await server.ok('jira_get_user', { username: 'jdoe' })).json;
      assert.equal(user.name, 'jdoe');
      const found = await server.ok('jira_search_users', { query: 'jdoe' });
      assert.match(found.text, /jdoe/);
      const assignable = await server.ok('jira_get_assignable_users', { projectKey: PROJECT });
      assert.match(assignable.text, /admin/);
    });
  });

  describe('robustness (agent-style misuse)', () => {
    it('unknown issue returns isError, server keeps running', async () => {
      const result = await server.call('jira_get_issue', { issueKey: 'IT-999999' });
      assert.equal(result.isError, true);
      assert.match(result.text, /not found|does not exist/i);
      await server.ok('jira_get_myself');
    });

    it('lowercase and padded issue keys work', async () => {
      const { json } = await server.ok('jira_get_issue', { issueKey: ` ${state.taskKey.toLowerCase()} ` });
      assert.equal(json.key, state.taskKey);
    });

    it('path-like issue keys cannot reach other endpoints', async () => {
      const result = await server.call('jira_get_issue', { issueKey: '../myself' });
      assert.equal(result.isError, true);
      assert.doesNotMatch(result.text, /admin@example\.com/, 'must not resolve to /myself');
      assert.ok(result.text.length < 600, `error should be concise, got ${result.text.length} chars`);
      assert.doesNotMatch(result.text, /<html|<!doctype/i, 'no raw HTML in errors');
    });

    it('missing required argument is rejected by schema', async () => {
      const result = await server.call('jira_get_issue', {});
      assert.equal(result.isError, true);
    });

    it('numbers and booleans sent as strings are accepted', async () => {
      const boards = await server.ok('jira_get_boards', { projectKey: PROJECT, maxResults: '5' });
      assert.ok(boards.json);
      const fields = await server.ok('jira_get_fields', { customOnly: 'true' });
      assert.ok(fields.json.every(f => f.custom), '"true" means true');
      const sprints = await server.call('jira_get_sprints', { boardId: 'abc' });
      assert.equal(sprints.isError, true, 'non-numeric strings are still rejected');
    });

    it('handles parallel tool calls (agents fan out)', async () => {
      const calls = Array.from({ length: 12 }, (_, i) => i % 2
        ? server.ok('jira_get_issue', { issueKey: state.taskKey })
        : server.ok('jira_search', { jql: `project = ${PROJECT}`, maxResults: 2 }));
      const results = await Promise.all(calls);
      assert.equal(results.length, 12);
    });
  });

  describe('JIRA_PROJECTS_FILTER', () => {
    it('blocks other projects and scopes JQL', async () => {
      const filtered = await startServer({ ...env, JIRA_PROJECTS_FILTER: 'OT' });
      try {
        const issue = await filtered.call('jira_get_issue', { issueKey: state.taskKey });
        assert.equal(issue.isError, true);
        assert.match(issue.text, /outside the allowed projects/);
        const search = await filtered.ok('jira_search', { jql: `key = ${state.taskKey} ORDER BY key` });
        assert.equal(search.json.total, 0, 'JQL is scoped to allowed projects');
        const projects = await filtered.ok('jira_get_projects');
        assert.deepEqual(projects.json.map(p => p.key), ['OT']);
        const create = await filtered.call('jira_create_issue', { projectKey: PROJECT, issueType: 'Task', summary: 'blocked' });
        assert.equal(create.isError, true);
        const escape = await filtered.call('jira_search', { jql: `status != Nope) OR (project = ${PROJECT}` });
        assert.equal(escape.isError, true, 'JQL cannot break out of the project scope');
        const moved = await filtered.call('jira_create_issue', {
          projectKey: 'OT', issueType: 'Task', summary: 'blocked', customFields: { project: { key: PROJECT } },
        });
        assert.equal(moved.isError, true, 'customFields cannot switch the project');
      } finally {
        await filtered.close();
      }
      const allowed = await startServer({ ...env, JIRA_PROJECTS_FILTER: PROJECT.toLowerCase() });
      try {
        await allowed.ok('jira_get_issue', { issueKey: state.taskKey });
        const search = await allowed.ok('jira_search', { jql: `key = ${state.taskKey}` });
        assert.equal(search.json.total, 1);
      } finally {
        await allowed.close();
      }
    });
  });

  describe('TOON response format', () => {
    it('returns TOON text', async () => {
      const toon = await startServer({ ...env, JIRA_RESPONSE_FORMAT: 'TOON' });
      try {
        const { text, json } = await toon.ok('jira_get_issue', { issueKey: state.taskKey });
        assert.equal(json, undefined, 'not JSON');
        assert.match(text, new RegExp(`key: ${state.taskKey}`));
      } finally {
        await toon.close();
      }
    });
  });

  describe('issue deletion', () => {
    it('deleteSubtasks "false" as a string does not delete subtasks', async () => {
      const result = await server.call('jira_delete_issue', { issueKey: state.taskKey, deleteSubtasks: 'false' });
      assert.equal(result.isError, true, 'Jira refuses to delete a parent without deleteSubtasks');
      await server.ok('jira_get_issue', { issueKey: state.subtaskKey });
    });

    it('jira_delete_issue with subtasks', async () => {
      await server.ok('jira_delete_issue', { issueKey: state.taskKey, deleteSubtasks: true });
      const result = await server.call('jira_get_issue', { issueKey: state.subtaskKey });
      assert.equal(result.isError, true);
      state.taskKey = state.subtaskKey = undefined;
    });
  });
});
