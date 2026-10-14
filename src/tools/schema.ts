/**
 * Jira MCP Server - Shared Zod Schemas
 * 
 * Some models send booleans as strings ("true"/"false"). z.coerce.boolean()
 * would turn "false" into true, so only the two literal strings are mapped.
 */

import { z } from 'zod';

export const zBoolean = () =>
  z.preprocess(value => (value === 'true' ? true : value === 'false' ? false : value), z.boolean());
