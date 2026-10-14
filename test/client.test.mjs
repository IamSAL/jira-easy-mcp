import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let baseUrl;
let lastRequest;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      lastRequest = { method: req.method, url: req.url, headers: req.headers, body };
      if (req.url === '/rest/api/2/issueLink') {
        // Jira Server: 201 Created, empty body, no Content-Length (chunked)
        res.writeHead(201);
        res.end();
      } else if (req.url === '/rest/agile/1.0/empty') {
        res.writeHead(201);
        res.end();
      } else if (req.url === '/rest/api/2/myself') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'tester' }));
      } else if (req.url.startsWith('/rest/api/2/issue/KP-1/attachments')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ id: '1' }]));
      } else if (req.url === '/secure/attachment/1/small.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(Buffer.from([1, 2, 3, 4]));
      } else if (req.url === '/secure/attachment/2/big.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(Buffer.alloc(2048));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.JIRA_BASE_URL = baseUrl;
  process.env.JIRA_USERNAME = 'tester';
  process.env.JIRA_PASSWORD = 'secret';
  process.env.JIRA_RETRY_COUNT = '0';
  process.env.JIRA_LOG_LEVEL = 'ERROR';
});

after(() => server.close());

const client = () => import('../dist/client.js');

test('201 with empty body resolves to undefined (issue #2)', async () => {
  const { jiraPost } = await client();
  const result = await jiraPost('/issueLink', { type: { name: 'Relates' } });
  assert.equal(result, undefined);
});

test('agile 201 with empty body resolves to undefined', async () => {
  const { jiraAgilePost } = await client();
  assert.equal(await jiraAgilePost('/empty', {}), undefined);
});

test('200 JSON body is parsed', async () => {
  const { jiraGet } = await client();
  assert.deepEqual(await jiraGet('/myself'), { name: 'tester' });
});
