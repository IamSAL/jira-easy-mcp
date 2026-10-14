import { describe, expect, it } from 'vitest';
import { assertCustomFieldKeys, isCustomFieldId, mergeCustomFields, resolveCustomFieldKey, resolveCustomFieldMap } from '../custom-fields.js';

describe('isCustomFieldId', () => {
  it('accepts Jira REST custom field ids', () => {
    expect(isCustomFieldId('customfield_10006')).toBe(true);
    expect(isCustomFieldId('customfield_1')).toBe(true);
  });

  it('rejects display names, system fields, and clause names', () => {
    expect(isCustomFieldId('Story Points')).toBe(false);
    expect(isCustomFieldId('summary')).toBe(false);
    expect(isCustomFieldId('cf[10006]')).toBe(false);
    expect(isCustomFieldId('customfield_')).toBe(false);
    expect(isCustomFieldId('customfield_10006_extra')).toBe(false);
    expect(isCustomFieldId('Customfield_10006')).toBe(false);
  });
});

describe('assertCustomFieldKeys', () => {
  it('allows undefined, empty, and valid custom field maps', () => {
    expect(() => assertCustomFieldKeys(undefined)).not.toThrow();
    expect(() => assertCustomFieldKeys({})).not.toThrow();
    expect(() => assertCustomFieldKeys({
      customfield_10006: 5,
      customfield_10107: { value: 'Yes' },
      customfield_10106: null,
    })).not.toThrow();
  });

  it('rejects display names and system field keys in one error', () => {
    expect(() => assertCustomFieldKeys({
      'Story Points': 5,
      summary: 'nope',
      customfield_10006: 8,
    })).toThrow(
      'customFields keys must be field ids like customfield_10006. Invalid: Story Points, summary'
    );
  });
});

describe('mergeCustomFields', () => {
  it('asserts then copies onto the target', () => {
    const target: Record<string, unknown> = { summary: 'x' };
    mergeCustomFields(target, { customfield_10006: 5 });
    expect(target).toEqual({ summary: 'x', customfield_10006: 5 });
  });

  it('leaves the target unchanged when customFields is omitted', () => {
    const target: Record<string, unknown> = { summary: 'x' };
    mergeCustomFields(target, undefined);
    expect(target).toEqual({ summary: 'x' });
  });

  it('does not assign when a key is invalid', () => {
    const target: Record<string, unknown> = { summary: 'x' };
    expect(() => mergeCustomFields(target, { 'Story Points': 5 })).toThrow(/Invalid: Story Points/);
    expect(target).toEqual({ summary: 'x' });
  });
});

describe('resolveCustomFieldKey', () => {
  const meta = [
    { id: 'customfield_11205', name: 'Severity' },
    { id: 'summary', name: 'Summary' },
  ];

  it('passes through custom field ids', () => {
    expect(resolveCustomFieldKey('customfield_11205', meta)).toBe('customfield_11205');
  });

  it('resolves a unique custom field name', () => {
    expect(resolveCustomFieldKey('Severity', meta)).toBe('customfield_11205');
  });

  it('does not resolve a system field name into a write key', () => {
    expect(() => resolveCustomFieldKey('Summary', meta)).toThrow(/Invalid: Summary/);
  });

  it('rejects an ambiguous custom field name', () => {
    expect(() => resolveCustomFieldKey('Severity', [
      { id: 'customfield_11205', name: 'Severity' },
      { id: 'customfield_19999', name: 'Severity' },
    ])).toThrow(/multiple fields: customfield_11205, customfield_19999/);
  });
});

describe('resolveCustomFieldMap', () => {
  it('rewrites name keys to ids and leaves id keys', () => {
    expect(resolveCustomFieldMap({
      Severity: { value: 'Critical' },
      customfield_10006: 5,
    }, [{ id: 'customfield_11205', name: 'Severity' }])).toEqual({
      customfield_11205: { value: 'Critical' },
      customfield_10006: 5,
    });
  });

  it('rejects a name and id that alias the same field', () => {
    expect(() => resolveCustomFieldMap({
      Severity: { value: 'Critical' },
      customfield_11205: { value: 'Medium' },
    }, [{ id: 'customfield_11205', name: 'Severity' }])).toThrow(
      /maps more than one key to customfield_11205/
    );
  });
});
