#!/usr/bin/env node
/**
 * Run a test suite with `node --test` on an explicit file list.
 * Node < 21 does not expand globs and Windows shells do not either, so the
 * files are listed here instead of in package.json.
 *
 *   node scripts/run-tests.mjs unit
 *   node scripts/run-tests.mjs integration   # needs JIRA_IT_BASE_URL
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const suite = process.argv[2] || 'unit';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'test', suite);
const files = readdirSync(dir).filter(name => name.endsWith('.test.mjs')).sort().map(name => join(dir, name));
if (files.length === 0) {
  console.error(`No tests found in ${dir}`);
  process.exit(1);
}

const args = ['--test', ...(suite === 'integration' ? ['--test-concurrency=1'] : []), ...files];
const { status } = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(status ?? 1);
