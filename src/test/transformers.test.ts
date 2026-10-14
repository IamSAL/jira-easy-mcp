import { describe, expect, it } from 'vitest';
import { toSimplifiedCreateMeta, toSimplifiedIssue, toSimplifiedMetaField } from '../transformers.js';
import { testIssue } from './fixtures/jira-issue.js';

describe('toSimplifiedIssue customFields', () => {
  it('omits null custom fields by default and shapes set fields as id/name/value', () => {
    const issue = toSimplifiedIssue(testIssue({
      customfield_10006: 5,
      customfield_10106: null,
    }, {
      customfield_10006: 'Story Points',
      customfield_10106: 'Release Note',
    }));

    expect(issue.customFields).toEqual([
      { id: 'customfield_10006', name: 'Story Points', value: 5 },
    ]);
  });

  it('keeps null custom fields when includeNullCustomFields is true', () => {
    const issue = toSimplifiedIssue(testIssue({
      customfield_10006: 5,
      customfield_10106: null,
    }, {
      customfield_10006: 'Story Points',
      customfield_10106: 'Release Note',
    }), { includeNullCustomFields: true });

    expect(issue.customFields).toEqual([
      { id: 'customfield_10006', name: 'Story Points', value: 5 },
      { id: 'customfield_10106', name: 'Release Note', value: null },
    ]);
  });

  it('omits undefined custom fields', () => {
    const issue = toSimplifiedIssue(testIssue({
      customfield_10006: 5,
      customfield_10106: undefined,
    }));

    expect(issue.customFields).toEqual([
      { id: 'customfield_10006', value: 5 },
    ]);
  });

  it('omits keys that are not customfield_<digits>', () => {
    const issue = toSimplifiedIssue(testIssue({
      customfield_10006: 5,
      customfield_10006_extra: 9,
      'Story Points': 8,
    }));

    expect(issue.customFields).toEqual([
      { id: 'customfield_10006', value: 5 },
    ]);
  });
});

describe('toSimplifiedMetaField', () => {
  it('copies schema, operations, disabled, and children[]', () => {
    expect(toSimplifiedMetaField('customfield_10107', {
      required: false,
      name: 'Publish Release Note',
      operations: ['set'],
      schema: {
        type: 'option',
        custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select',
      },
      allowedValues: [
        { id: '10100', value: 'Yes', disabled: true },
        { id: 10101, value: 'No', disabled: false },
      ],
    })).toEqual({
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
    });
  });

  it('copies schema.items onto itemsType for array fields', () => {
    expect(toSimplifiedMetaField('customfield_11203', {
      required: false,
      name: 'Reviewers',
      operations: ['set', 'add', 'remove'],
      schema: { type: 'array', items: 'user' },
    })).toEqual({
      id: 'customfield_11203',
      name: 'Reviewers',
      required: false,
      type: 'array',
      itemsType: 'user',
      customType: undefined,
      operations: ['set', 'add', 'remove'],
    });
  });
});

describe('toSimplifiedCreateMeta', () => {
  it('walks projects.issuetypes.fields with the same meta-field stripper', () => {
    const result = toSimplifiedCreateMeta('ABC', {
      projects: [{
        key: 'ABC',
        issuetypes: [{
          id: '1',
          name: 'Bug',
          subtask: false,
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
        }],
      }],
    });

    expect(result).toEqual({
      projectKey: 'ABC',
      issueTypes: [{
        id: '1',
        name: 'Bug',
        subtask: false,
        fields: [
          {
            id: 'summary',
            name: 'Summary',
            required: true,
            type: 'string',
            customType: undefined,
            operations: ['set'],
          },
          {
            id: 'customfield_10006',
            name: 'Story Points',
            required: false,
            type: 'number',
            customType: undefined,
            operations: ['set'],
          },
        ],
      }],
    });
  });
});
