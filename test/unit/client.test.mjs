import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let baseUrl;
let lastRequest;
const hits = {};

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
      } else if (req.url.startsWith('/rest/api/2/flaky')) {
        hits[req.method] = (hits[req.method] || 0) + 1;
        res.writeHead(504);
        res.end();
      } else if (req.url.startsWith('/rest/api/2/moved')) {
        res.writeHead(301, { Location: 'https://jira.example.com/rest/api/2/moved' });
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
      } else if (req.url.startsWith('/rest/api/2/html404')) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><head><title>HTTP Status 404 – Not Found</title></head></html>');
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
  process.env.JIRA_RETRY_COUNT = '2';
  process.env.JIRA_RETRY_DELAY = '1';
  process.env.JIRA_LOG_LEVEL = 'ERROR';
});

after(() => server.close());

const client = () => import('../../dist/client.js');

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

test('jiraPostForm sends multipart/form-data, not JSON', async () => {
  const { jiraPostForm } = await client();
  const form = new FormData();
  form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  const result = await jiraPostForm('/issue/KP-1/attachments', form);
  assert.deepEqual(result, [{ id: '1' }]);
  assert.match(lastRequest.headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.equal(lastRequest.headers['x-atlassian-token'], 'no-check');
  assert.match(lastRequest.body, /filename="a.txt"/);
});

test('JSON requests still send application/json', async () => {
  const { jiraPost } = await client();
  await jiraPost('/issueLink', {});
  assert.equal(lastRequest.headers['content-type'], 'application/json');
});

test('jiraDownloadAttachment returns base64 image data', async () => {
  const { jiraDownloadAttachment } = await client();
  const result = await jiraDownloadAttachment(`${baseUrl}/secure/attachment/1/small.png`, 1024);
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.size, 4);
  assert.equal(result.data, Buffer.from([1, 2, 3, 4]).toString('base64'));
  assert.ok(lastRequest.headers.authorization.startsWith('Basic '));
});

test('jiraDownloadAttachment rejects other origins and paths', async () => {
  const { jiraDownloadAttachment } = await client();
  await assert.rejects(
    jiraDownloadAttachment('https://evil.example/secure/attachment/1/x.png', 1024),
    /outside the configured attachment path/
  );
  await assert.rejects(
    jiraDownloadAttachment(`${baseUrl}/rest/api/2/myself`, 1024),
    /outside the configured attachment path/
  );
});

test('jiraDownloadAttachment enforces the size limit', async () => {
  const { jiraDownloadAttachment } = await client();
  await assert.rejects(
    jiraDownloadAttachment(`${baseUrl}/secure/attachment/2/big.png`, 1024),
    /limit/
  );
});

test('uploadAttachment sends the file with its MIME type', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { uploadAttachment } = await import('../../dist/tools/attachments.js');
  const dir = await mkdtemp(join(tmpdir(), 'jira-mcp-'));
  const file = join(dir, 'shot.png');
  await writeFile(file, Buffer.from([1, 2, 3]));
  await uploadAttachment('KP-1', file);
  assert.match(lastRequest.body, /filename="shot.png"\r\nContent-Type: image\/png/);
  await assert.rejects(uploadAttachment('KP-1', 'relative.png'), /absolute path/);
});

test('GET is retried on 504, POST is not (avoids duplicate writes)', async () => {
  const { jiraGet, jiraPost } = await client();
  await assert.rejects(jiraGet('/flaky'), /504/);
  await assert.rejects(jiraPost('/flaky', {}), /504/);
  assert.equal(hits.GET, 3, 'GET: 1 attempt + 2 retries');
  assert.equal(hits.POST, 1, 'POST must not be retried');
});

test('a redirecting base URL fails with the target, not a confusing 401', async () => {
  const { jiraPost } = await client();
  await assert.rejects(jiraPost('/moved', {}), /redirected to https:\/\/jira\.example\.com.*JIRA_BASE_URL/);
});

test('an HTML 404 points at JIRA_BASE_URL (e.g. missing context path)', async () => {
  const { jiraGet } = await client();
  await assert.rejects(jiraGet('/html404'), /No Jira REST API at .*JIRA_BASE_URL.*context path/);
});
