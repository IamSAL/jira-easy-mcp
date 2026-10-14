import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { JiraApiException, jiraGet } from '../client.js';
import { getCreateMeta, getEditMeta, listFields } from '../tools/fields.js';

const mockedGet = vi.mocked(jiraGet);

beforeEach(() => {
  mockedGet.mockReset();
});

describe('getEditMeta', () => {
  it('GETs /issue/{key}/editmeta and simplifies allowedValues', async () => {
    mockedGet.mockResolvedValue({
      fields: {
        summary: {
          required: true,
          name: 'Summary',
          operations: ['set'],
          schema: { type: 'string', system: 'summary' },
        },
        customfield_10107: {
          required: false,
          name: 'Publish Release Note',
          operations: ['set'],
          schema: {
            type: 'option',
            custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select',
            customId: 10107,
          },
          allowedValues: [
            {
              self: 'https://jira.example.com/rest/api/2/customFieldOption/10100',
              value: 'Yes',
              id: '10100',
              disabled: true,
            },
            {
              self: 'https://jira.example.com/rest/api/2/customFieldOption/10101',
              value: 'No',
              id: 10101,
              disabled: false,
            },
          ],
        },
        customfield_12007: {
          required: false,
          name: 'Module',
          operations: ['set', 'add', 'remove'],
          schema: { type: 'array', items: 'option' },
          allowedValues: [
            {
              id: '1',
              value: 'Core',
              children: [
                { id: '2', value: 'UI' },
                { id: '3', value: 'API' },
              ],
            },
          ],
        },
      },
    });

    const result = await getEditMeta('ABC-123');

    expect(mockedGet).toHaveBeenCalledWith('/issue/ABC-123/editmeta');
    expect(result.issueKey).toBe('ABC-123');
    expect(result.fields).toEqual([
      {
        id: 'summary',
        name: 'Summary',
        required: true,
        type: 'string',
        customType: undefined,
        operations: ['set'],
      },
      {
        id: 'customfield_10107',
        name: 'Publish Release Note',
        required: false,
        type: 'option',
        customType: 'com.atlassian.jira.plugin.system.customfieldtypes:select',
        operations: ['set'],
        allowedValues: [
          { id: '10100', value: 'Yes', disabled: true },
          { id: '10101', value: 'No', disabled: false },
        ],
      },
      {
        id: 'customfield_12007',
        name: 'Module',
        required: false,
        type: 'array',
        itemsType: 'option',
        customType: undefined,
        operations: ['set', 'add', 'remove'],
        allowedValues: [
          {
            id: '1',
            value: 'Core',
            children: [
              { id: '2', value: 'UI' },
              { id: '3', value: 'API' },
            ],
          },
        ],
      },
    ]);
  });

  it('filters to custom field ids when customOnly is true', async () => {
    mockedGet.mockResolvedValue({
      fields: {
        summary: {
          required: true,
          name: 'Summary',
          operations: ['set'],
          schema: { type: 'string', system: 'summary' },
        },
        customfield_10006: {
          required: false,
          name: 'Story Points',
          operations: ['set'],
          schema: { type: 'number' },
        },
      },
    });

    const result = await getEditMeta('ABC-123', true);

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]?.id).toBe('customfield_10006');
  });

  it('treats a missing fields object as empty', async () => {
    mockedGet.mockResolvedValue({});

    const result = await getEditMeta('ABC-1');

    expect(result).toEqual({ issueKey: 'ABC-1', fields: [] });
  });
});

describe('listFields', () => {
  it('customOnly omits custom fields whose id is not customfield_<digits>', async () => {
    mockedGet.mockResolvedValue([
      { id: 'summary', name: 'Summary', custom: false, orderable: true, navigable: true, searchable: true },
      { id: 'customfield_10006', name: 'Story Points', custom: true, orderable: true, navigable: true, searchable: true },
      { id: 'Story Points', name: 'Story Points', custom: true, orderable: true, navigable: true, searchable: true },
    ]);

    const fields = await listFields(true);

    expect(fields.map(f => f.id)).toEqual(['customfield_10006']);
  });

  it('does not cache GET /field', async () => {
    mockedGet.mockResolvedValue([
      { id: 'customfield_10006', name: 'Story Points', custom: true, orderable: true, navigable: true, searchable: true },
    ]);

    await listFields(true);
    await listFields(true);

    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(mockedGet).toHaveBeenNthCalledWith(1, '/field');
    expect(mockedGet).toHaveBeenNthCalledWith(2, '/field');
  });
});

const releaseNoteField = {
  required: false,
  name: 'Publish Release Note',
  operations: ['set'],
  schema: {
    type: 'option',
    custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select',
  },
  allowedValues: [
    { id: '10100', value: 'Yes', disabled: true },
  ],
};

const expectedCreateMeta = {
  projectKey: 'ABC',
  issueTypes: [{
    id: '1',
    name: 'Bug',
    subtask: false,
    fields: [{
      id: 'customfield_10107',
      name: 'Publish Release Note',
      required: false,
      type: 'option',
      customType: 'com.atlassian.jira.plugin.system.customfieldtypes:select',
      operations: ['set'],
      allowedValues: [{ id: '10100', value: 'Yes', disabled: true }],
    }],
  }],
};

describe('getCreateMeta', () => {
  it('uses the per-project createmeta endpoints (Jira 8.4+, required on 9+)', async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/issue/createmeta/ABC/issuetypes/1?')) {
        return { values: [{ fieldId: 'customfield_10107', ...releaseNoteField }], isLast: true };
      }
      if (url.startsWith('/issue/createmeta/ABC/issuetypes?')) {
        return { values: [{ id: '1', name: 'Bug', subtask: false }, { id: '2', name: 'Task', subtask: false }], isLast: true };
      }
      throw new Error(`unexpected GET ${url}`);
    });

    const result = await getCreateMeta('ABC', ['Bug']);

    expect(result).toEqual(expectedCreateMeta);
  });

  it('falls back to the legacy createmeta endpoint on Jira 7.x - 8.3', async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/issue/createmeta/')) {
        throw new JiraApiException('Resource not found', 404);
      }
      return {
        projects: [{
          key: 'ABC',
          issuetypes: [
            { id: '1', name: 'Bug', subtask: false, fields: { customfield_10107: releaseNoteField } },
            { id: '2', name: 'Task', subtask: false, fields: {} },
          ],
        }],
      };
    });

    const result = await getCreateMeta('ABC', ['Bug']);

    expect(mockedGet).toHaveBeenCalledWith(
      '/issue/createmeta?projectKeys=ABC&expand=projects.issuetypes.fields'
    );
    expect(result).toEqual(expectedCreateMeta);
  });
});
