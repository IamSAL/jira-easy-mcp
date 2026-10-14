#!/usr/bin/env node
/**
 * Start dist/index.js over stdio the way MCP clients (Claude Code, Codex,
 * Cursor, VS Code, ...) do, and check the handshake and tool list. Needs no
 * Jira: JIRA_BASE_URL only has to be set.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const started = Date.now();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env: { ...process.env, JIRA_LOG_LEVEL: 'ERROR' },
});
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
const serverVersion = client.getServerVersion()?.version;
const elapsed = Date.now() - started;
await client.close();

const problems = [];
const { version } = JSON.parse(readFileSync(join(dirname(entry), '..', 'package.json'), 'utf8'));
if (serverVersion !== version) problems.push(`server reports version ${serverVersion}, package.json has ${version}`);
if (tools.length < 41) problems.push(`expected >= 41 tools, got ${tools.length}`);
for (const tool of tools) {
  // OpenAI/Codex and Gemini require ^[a-zA-Z0-9_-]{1,64}$
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) problems.push(`invalid tool name: ${tool.name}`);
  for (const [prop, schema] of Object.entries(tool.inputSchema.properties || {})) {
    if (!schema.description) problems.push(`${tool.name}.${prop} has no description`);
  }
}
// Codex's default startup timeout is 10s; stay well under it
if (elapsed > 5000) problems.push(`startup took ${elapsed}ms`);

if (problems.length) {
  console.error(`Smoke test failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`OK: v${serverVersion}, ${tools.length} tools, handshake in ${elapsed}ms`);
