import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverEntry = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'index.js');

export const jiraEnv = () => {
  const baseUrl = process.env.JIRA_IT_BASE_URL;
  if (!baseUrl) return null;
  return {
    JIRA_BASE_URL: baseUrl,
    JIRA_USERNAME: process.env.JIRA_IT_USERNAME || 'admin',
    JIRA_PASSWORD: process.env.JIRA_IT_PASSWORD || 'Jira-IT-admin-1',
    JIRA_LOG_LEVEL: 'ERROR',
  };
};

/**
 * Start the MCP server over stdio exactly like an MCP client (Claude Code,
 * Codex, Cursor, ...) does, and return a small call() helper.
 */
export const startServer = async (env, { omit = [] } = {}) => {
  const childEnv = { ...process.env, ...env };
  for (const key of omit) delete childEnv[key];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: childEnv,
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'jira-easy-mcp-it', version: '0.0.0' });
  await client.connect(transport);

  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    let json;
    try { json = JSON.parse(text); } catch { /* plain text or TOON */ }
    return { ...result, text, json };
  };

  /** call() that fails the test with the server's message when the tool errors. */
  const ok = async (name, args = {}) => {
    const result = await call(name, args);
    if (result.isError) {
      throw new Error(`${name} failed: ${result.text}\n--- server stderr ---\n${stderr.slice(-600)}`);
    }
    return result;
  };

  return { client, call, ok, close: () => client.close(), stderr: () => stderr };
};
