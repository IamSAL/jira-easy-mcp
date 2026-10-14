import { afterEach, describe, expect, it } from 'vitest';
import { clearConfigCache, formatResponse } from '../config.js';

afterEach(() => {
  delete process.env.JIRA_RESPONSE_FORMAT;
  clearConfigCache();
});

describe('formatResponse TOON', () => {
  it('keeps null object values so a cleared custom field stays visible', () => {
    process.env.JIRA_RESPONSE_FORMAT = 'TOON';
    clearConfigCache();

    const text = formatResponse({
      customFields: [
        { id: 'customfield_10006', name: 'Story Points', value: 5 },
        { id: 'customfield_10106', name: 'Release Note', value: null },
      ],
    });

    expect(text).toContain('customfield_10006');
    expect(text).toContain('value: 5');
    expect(text).toContain('value: null');
  });
});
