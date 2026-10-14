import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testIssue } from './fixtures/jira-issue.js';

vi.mock('../client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client.js')>();
  return {
    ...actual,
    jiraGet: vi.fn(),
    jiraPost: vi.fn(),
    jiraPut: vi.fn(),
    jiraDelete: vi.fn(),
  };
});

import { JiraApiException, jiraGet, jiraPost, jiraPut } from '../client.js';
import { createCustomFieldsParam, createIssue, getIssue, searchIssues, updateCustomFieldsParam, updateIssue } from '../tools/issues.js';

const mockedGet = vi.mocked(jiraGet);
const mockedPost = vi.mocked(jiraPost);
const mockedPut = vi.mocked(jiraPut);

const defaultCustomFields = {
  customfield_10006: 5,
  customfield_10107: { value: 'Yes' },
  customfield_10106: null,
};

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedPut.mockReset();
});

describe('customFields tool params', () => {
  it('tells create to discover schema from create meta, not edit meta or the catalog', () => {
    expect(createCustomFieldsParam.description).toContain('jira_get_create_meta');
    expect(createCustomFieldsParam.description).not.toContain('jira_get_edit_meta');
    expect(createCustomFieldsParam.description).toContain('Do not call jira_get_fields');
  });

  it('tells update to discover schema from edit meta, not create meta or the catalog', () => {
    expect(updateCustomFieldsParam.description).toContain('jira_get_edit_meta');
    expect(updateCustomFieldsParam.description).not.toContain('jira_get_create_meta');
    expect(updateCustomFieldsParam.description).toContain('Do not call jira_get_fields');
  });
});

describe('createIssue customFields', () => {
  it('merges pass-through custom field values into the POST body', async () => {
    mockedPost.mockResolvedValue({
      id: '10001',
      key: 'ABC-123',
      self: 'https://jira.example.com/rest/api/2/issue/10001',
    });

    await createIssue('ABC', 'Bug', 'A bug', {
      customFields: {
        customfield_10006: 5,
        customfield_10107: { value: 'Yes' },
        customfield_11203: { name: 'jane.doe' },
      },
    });

    expect(mockedPost).toHaveBeenCalledWith('/issue', {
      fields: {
        project: { key: 'ABC' },
        issuetype: { name: 'Bug' },
        summary: 'A bug',
        customfield_10006: 5,
        customfield_10107: { value: 'Yes' },
        customfield_11203: { name: 'jane.doe' },
      },
    });
  });

  const mockCreateMeta = (fields: Array<Record<string, unknown>>) =>
    mockedGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/issue/createmeta/ABC/issuetypes/1?')) return { values: fields, isLast: true };
      if (url.startsWith('/issue/createmeta/ABC/issuetypes?')) {
        return { values: [{ id: '1', name: 'Bug', subtask: false }], isLast: true };
      }
      throw new Error(`unexpected GET ${url}`);
    });

  it('resolves a unique create-meta name before POST', async () => {
    mockCreateMeta([{
      fieldId: 'customfield_10006',
      required: false,
      name: 'Story Points',
      operations: ['set'],
      schema: { type: 'number' },
    }]);
    mockedPost.mockResolvedValue({
      id: '10001',
      key: 'ABC-123',
      self: 'https://jira.example.com/rest/api/2/issue/10001',
    });

    await createIssue('ABC', 'Bug', 'A bug', {
      customFields: { 'Story Points': 5 },
    });

    expect(mockedGet).toHaveBeenCalledWith(expect.stringMatching(/^\/issue\/createmeta\/ABC\/issuetypes\/1\?/));
    expect(mockedPost).toHaveBeenCalledWith('/issue', {
      fields: {
        project: { key: 'ABC' },
        issuetype: { name: 'Bug' },
        summary: 'A bug',
        customfield_10006: 5,
      },
    });
  });

  it('does not POST when a name is unknown on create meta', async () => {
    mockCreateMeta([]);

    await expect(
      createIssue('ABC', 'Bug', 'A bug', {
        customFields: { 'Story Points': 5 },
      })
    ).rejects.toThrow(/Invalid: Story Points/);

    expect(mockedPost).not.toHaveBeenCalled();
  });
});

describe('updateIssue customFields', () => {
  it('PUTs only the custom fields map, including null to clear', async () => {
    mockedPut.mockResolvedValue(undefined);

    await updateIssue('ABC-123', {
      customFields: {
        customfield_10006: 8,
        customfield_10106: null,
      },
    });

    expect(mockedPut).toHaveBeenCalledWith('/issue/ABC-123', {
      fields: {
        customfield_10006: 8,
        customfield_10106: null,
      },
    });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('resolves a unique edit-meta name before PUT', async () => {
    mockedGet.mockResolvedValue({
      fields: {
        customfield_11205: {
          required: true,
          name: 'Severity',
          operations: ['set'],
          schema: { type: 'option' },
        },
      },
    });
    mockedPut.mockResolvedValue(undefined);

    await updateIssue('ABC-123', {
      customFields: { Severity: { value: 'Critical' } },
    });

    expect(mockedGet).toHaveBeenCalledWith('/issue/ABC-123/editmeta');
    expect(mockedPut).toHaveBeenCalledWith('/issue/ABC-123', {
      fields: {
        customfield_11205: { value: 'Critical' },
      },
    });
  });

  it('rejects system field keys so they cannot bypass typed params', async () => {
    await expect(
      updateIssue('ABC-123', {
        customFields: { summary: 'hijack' },
      })
    ).rejects.toThrow(/Invalid: summary/);

    expect(mockedPut).not.toHaveBeenCalled();
  });
});

describe('getIssue custom fields', () => {
  const SYSTEM_FIELDS = [
    'summary', 'status', 'priority', 'issuetype', 'assignee', 'reporter',
    'description', 'labels', 'components', 'fixVersions', 'resolution',
    'created', 'updated', 'duedate', 'parent', 'subtasks', 'issuelinks',
    'timetracking', 'versions',
  ];

  const namedIssue = () => testIssue(defaultCustomFields, {
    customfield_10006: 'Story Points',
    customfield_10107: 'Publish Release Note',
    customfield_10106: 'Release Note',
  });

  it('asks Jira for navigable fields, system fields, and names — not comments or the catalog', async () => {
    mockedGet.mockResolvedValue(namedIssue());

    const issue = await getIssue('ABC-123');

    expect(mockedGet).toHaveBeenCalledTimes(1);
    const called = String(mockedGet.mock.calls[0]?.[0]);
    expect(called.startsWith('/issue/ABC-123?')).toBe(true);
    expect(called).not.toContain('/field');

    const params = new URLSearchParams(called.split('?')[1]);
    const requested = params.get('fields')?.split(',') ?? [];
    expect(requested[0]).toBe('*navigable');
    expect(requested).toEqual(expect.arrayContaining(SYSTEM_FIELDS));
    expect(requested).not.toContain('comment');
    expect(requested).not.toContain('worklog');
    expect(requested).not.toContain('attachment');
    expect(params.get('expand')).toBe('names');
    expect(requested.every(id => !id.startsWith('customfield_'))).toBe(true);

    expect(issue.customFields).toEqual([
      { id: 'customfield_10006', name: 'Story Points', value: 5 },
      { id: 'customfield_10107', name: 'Publish Release Note', value: { value: 'Yes' } },
    ]);
  });

  it('includes comments when asked', async () => {
    mockedGet.mockResolvedValue(namedIssue());

    await getIssue('ABC-123', { include: ['comments'] });

    const requested = new URLSearchParams(String(mockedGet.mock.calls[0]?.[0]).split('?')[1])
      .get('fields')?.split(',') ?? [];
    expect(requested).toContain('comment');
  });

  it('keeps null custom fields when customFields is all', async () => {
    mockedGet.mockResolvedValue(namedIssue());

    const issue = await getIssue('ABC-123', { customFields: 'all' });

    expect(issue.customFields).toEqual(expect.arrayContaining([
      { id: 'customfield_10106', name: 'Release Note', value: null },
    ]));
  });

  it('narrows the Jira GET to requested custom field ids', async () => {
    mockedGet.mockResolvedValue(namedIssue());

    const issue = await getIssue('ABC-123', { fields: ['customfield_10106'] });

    expect(mockedGet).toHaveBeenCalledTimes(1);
    const requested = new URLSearchParams(String(mockedGet.mock.calls[0]?.[0]).split('?')[1])
      .get('fields')?.split(',') ?? [];
    expect(requested).not.toContain('*navigable');
    expect(requested).toContain('customfield_10106');
    expect(issue.customFields).toEqual([
      { id: 'customfield_10106', name: 'Release Note', value: null },
    ]);
  });

  it('resolves an editmeta name then narrows the issue GET', async () => {
    mockedGet
      .mockResolvedValueOnce({
        fields: {
          customfield_11205: {
            required: true,
            name: 'Severity',
            operations: ['set'],
            schema: { type: 'option' },
          },
        },
      })
      .mockResolvedValueOnce(testIssue({
        customfield_11205: { value: 'Medium', id: '10606' },
      }, { customfield_11205: 'Severity' }));

    const issue = await getIssue('ABC-123', { fields: ['Severity'] });

    expect(mockedGet).toHaveBeenNthCalledWith(1, '/issue/ABC-123/editmeta');
    const issueUrl = String(mockedGet.mock.calls[1]?.[0]);
    expect(issueUrl).toContain('customfield_11205');
    expect(issueUrl).not.toContain('*navigable');
    expect(issue.customFields).toEqual([
      { id: 'customfield_11205', name: 'Severity', value: { value: 'Medium', id: '10606' } },
    ]);
  });

  it('still fails when the issue GET fails', async () => {
    mockedGet.mockRejectedValue(
      new JiraApiException('Issue does not exist or you do not have permission to see it.', 404)
    );

    await expect(getIssue('ABC-123')).rejects.toMatchObject({
      name: 'JiraApiException',
      status: 404,
    });
  });
});

describe('searchIssues named custom fields', () => {
  it('resolves a catalog name with a live GET /field and does not cache it', async () => {
    mockedGet
      .mockResolvedValueOnce([
        { id: 'customfield_11205', name: 'Severity', custom: true, orderable: true, navigable: true, searchable: true },
      ])
      .mockResolvedValueOnce({
        expand: '',
        startAt: 0,
        maxResults: 50,
        total: 0,
        names: { customfield_11205: 'Severity' },
        issues: [],
      })
      .mockResolvedValueOnce([
        { id: 'customfield_11205', name: 'Severity', custom: true, orderable: true, navigable: true, searchable: true },
      ])
      .mockResolvedValueOnce({
        expand: '',
        startAt: 0,
        maxResults: 50,
        total: 0,
        names: { customfield_11205: 'Severity' },
        issues: [],
      });

    await searchIssues('project = ABC', 50, 0, ['Severity']);
    await searchIssues('project = ABC', 50, 0, ['Severity']);

    expect(mockedGet).toHaveBeenNthCalledWith(1, '/field');
    expect(mockedGet).toHaveBeenNthCalledWith(3, '/field');
    const searchUrl = String(mockedGet.mock.calls[1]?.[0]);
    expect(searchUrl).toContain('/search?');
    expect(searchUrl).toContain('customfield_11205');
    expect(searchUrl).toContain('status');
    expect(searchUrl).toContain('issuetype');
    expect(searchUrl).toContain('expand=names');
  });

  it('keeps default system fields so a hit still simplifies', async () => {
    mockedGet
      .mockResolvedValueOnce([
        { id: 'customfield_11205', name: 'Severity', custom: true, orderable: true, navigable: true, searchable: true },
      ])
      .mockResolvedValueOnce({
        expand: '',
        startAt: 0,
        maxResults: 50,
        total: 1,
        names: { customfield_11205: 'Severity' },
        issues: [testIssue(
          { customfield_11205: { value: 'Medium' } },
          { customfield_11205: 'Severity' },
        )],
      });

    const result = await searchIssues('project = ABC', 50, 0, ['Severity']);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].status).toBe('Open');
    expect(result.issues[0].type).toBe('Bug');
    expect(result.issues[0].customFields).toEqual([
      { id: 'customfield_11205', name: 'Severity', value: { value: 'Medium' } },
    ]);
  });
});
