/**
 * Jira MCP Server - Custom Field Helpers
 *
 * Field-id guards for REST writes. Jira Server 7.12 only accepts keys like
 * customfield_10006 on PUT/POST /rest/api/2/issue.
 */

export const CUSTOM_FIELD_ID = /^customfield_\d+$/;

export const isCustomFieldId = (id: string): boolean => CUSTOM_FIELD_ID.test(id);

const SYSTEM_WRITE_KEYS = new Set([
  'summary', 'description', 'assignee', 'priority', 'labels', 'components',
  'fixVersions', 'duedate', 'issuetype', 'project', 'parent', 'status',
  'reporter', 'resolution', 'versions', 'timetracking', 'comment', 'worklog',
  'attachment',
]);

export const isSystemWriteKey = (key: string): boolean => SYSTEM_WRITE_KEYS.has(key);

/**
 * Reject keys that are not Jira custom field ids so display names and system
 * field keys fail loudly instead of being sent as bogus REST keys.
 */
export const assertCustomFieldKeys = (customFields?: Record<string, unknown>): void => {
  if (!customFields) {
    return;
  }

  const invalid = Object.keys(customFields).filter(key => !isCustomFieldId(key));
  if (invalid.length > 0) {
    throw new Error(
      `customFields keys must be field ids like customfield_10006. Invalid: ${invalid.join(', ')}`
    );
  }
};

export const assertNoSystemWriteKeys = (customFields?: Record<string, unknown>): void => {
  if (!customFields) {
    return;
  }
  const invalid = Object.keys(customFields).filter(isSystemWriteKey);
  if (invalid.length > 0) {
    throw new Error(
      `customFields keys must be field ids like customfield_10006. Invalid: ${invalid.join(', ')}`
    );
  }
};

/** Validate custom field ids, then copy them onto a REST fields object. */
export const mergeCustomFields = (
  target: Record<string, unknown>,
  customFields?: Record<string, unknown>
): void => {
  if (!customFields) {
    return;
  }
  assertCustomFieldKeys(customFields);
  Object.assign(target, customFields);
};

export interface NamedField {
  id: string;
  name: string;
}

/**
 * Map a customFields key that is already an id, or a unique display name from
 * this issue/create screen, onto a customfield_<digits> id.
 */
export const resolveCustomFieldKey = (key: string, namedFields: NamedField[]): string => {
  if (isCustomFieldId(key)) {
    return key;
  }

  const matches = namedFields.filter(field => isCustomFieldId(field.id) && field.name === key);
  if (matches.length === 1) {
    return matches[0].id;
  }
  if (matches.length > 1) {
    throw new Error(
      `customFields name "${key}" matches multiple fields: ${matches.map(field => field.id).join(', ')}. Use a field id.`
    );
  }

  throw new Error(
    `customFields keys must be field ids like customfield_10006 or a unique name from jira_get_edit_meta / jira_get_create_meta. Invalid: ${key}`
  );
};

export const customFieldsNeedNameResolve = (customFields?: Record<string, unknown>): boolean =>
  !!customFields && Object.keys(customFields).some(key => !isCustomFieldId(key) && !isSystemWriteKey(key));

/** Resolve display-name keys, then assert every key is a custom field id. */
export const resolveCustomFieldMap = (
  customFields: Record<string, unknown> | undefined,
  namedFields: NamedField[]
): Record<string, unknown> | undefined => {
  if (!customFields) {
    return undefined;
  }

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(customFields)) {
    const id = resolveCustomFieldKey(key, namedFields);
    if (Object.prototype.hasOwnProperty.call(resolved, id)) {
      throw new Error(
        `customFields maps more than one key to ${id}. Use a single field id.`
      );
    }
    resolved[id] = value;
  }
  return resolved;
};
