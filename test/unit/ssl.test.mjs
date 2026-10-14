import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const dist = file => new URL(`../../dist/${file}`, import.meta.url).href;
const fixtures = new URL('./fixtures/', import.meta.url);
let server;
let baseUrl;

before(async () => {
  server = https.createServer({
    key: readFileSync(new URL('self-signed.key', fixtures)),
    cert: readFileSync(new URL('self-signed.crt', fixtures)),
  }, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'tls-user' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `https://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

/** Call jiraGet('/myself') in a fresh process: TLS settings are process-wide. */
const myself = (sslVerify) => run(process.execPath, ['--input-type=module', '-e', `
  const { initializeConfig } = await import('${dist('config.js')}');
  await initializeConfig();
  const { jiraGet } = await import('${dist('client.js')}');
  console.log(JSON.stringify(await jiraGet('/myself')));
`], {
  env: {
    ...process.env, JIRA_BASE_URL: baseUrl, JIRA_USERNAME: 'u', JIRA_PASSWORD: 'p',
    JIRA_RETRY_COUNT: '0', JIRA_LOG_LEVEL: 'ERROR', JIRA_SSL_VERIFY: sslVerify,
  },
});

test('self-signed certificate is rejected by default', async () => {
  await assert.rejects(myself('true'), /certificate|fetch failed/i);
});

test('JIRA_SSL_VERIFY=false accepts a self-signed certificate', async () => {
  const { stdout } = await myself('false');
  assert.deepEqual(JSON.parse(stdout), { name: 'tls-user' });
});
