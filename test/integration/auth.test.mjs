/**
 * Authentication paths against a live Jira:
 *   - env vars (JIRA_USERNAME / JIRA_PASSWORD)
 *   - OS credential store ("JiraMCP" in macOS Keychain / Windows Credential Manager / libsecret)
 *   - failure modes: wrong password, CAPTCHA lockout, missing credentials
 *
 *   JIRA_IT_BASE_URL=http://localhost:8091 node --test test/integration/auth.test.mjs
 *
 * Keychain tests run only where keytar loads and no "JiraMCP" credential exists
 * yet (they never touch a real one). Set JIRA_IT_SKIP_KEYCHAIN=1 to skip them.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jiraEnv, startServer } from './helpers.mjs';

const env = jiraEnv();
const serverEntry = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'index.js');

const adminFetch = (path, init = {}) => fetch(`${env.JIRA_BASE_URL}/rest/api/2${path}`, {
  ...init,
  headers: {
    'Authorization': `Basic ${Buffer.from(`${env.JIRA_USERNAME}:${env.JIRA_PASSWORD}`).toString('base64')}`,
    'Content-Type': 'application/json',
    ...init.headers,
  },
});

/** Run the server binary to completion (for startup failures). */
const runServer = (childEnv) => new Promise(resolve => {
  const child = spawn(process.execPath, [serverEntry], { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('exit', code => resolve({ code, stderr }));
  setTimeout(() => child.kill(), 15000);
});

/** keytar plus whether "JiraMCP" already holds a real credential; null if no usable store. */
const loadKeytar = async () => {
  if (process.env.JIRA_IT_SKIP_KEYCHAIN === '1') return null;
  try {
    const keytar = (await import('keytar')).default;
    // Throws on Linux without a running Secret Service
    const existing = await keytar.findCredentials('JiraMCP');
    return { keytar, hasRealCredential: existing.length > 0 };
  } catch {
    return null;
  }
};

describe('authentication', { skip: !env && 'JIRA_IT_BASE_URL not set' }, () => {
  const throwaway = `it-auth-${Date.now()}`;
  const lockedOut = `${throwaway}-captcha`;

  const createUser = async name => {
    const created = await adminFetch('/user', {
      method: 'POST',
      body: JSON.stringify({
        name, password: 'Right-pass-1', emailAddress: `${name}@example.com`,
        displayName: 'Auth Test', applicationKeys: ['jira-software'],
      }),
    });
    assert.ok(created.status < 300, `create user ${name}: ${created.status} ${await created.text()}`);
  };

  before(async () => {
    await createUser(throwaway);
    await createUser(lockedOut);
  });

  after(async () => {
    for (const name of [throwaway, lockedOut]) {
      await adminFetch(`/user?username=${name}`, { method: 'DELETE' });
    }
  });

  it('env vars: basic auth works', async () => {
    const server = await startServer({ ...env, JIRA_USERNAME: throwaway, JIRA_PASSWORD: 'Right-pass-1' });
    try {
      const { json } = await server.ok('jira_get_myself');
      assert.equal(json.name, throwaway);
    } finally {
      await server.close();
    }
  });

  it('wrong password: clear auth error, not retried', async () => {
    const server = await startServer({ ...env, JIRA_USERNAME: throwaway, JIRA_PASSWORD: 'wrong' });
    try {
      const started = Date.now();
      const result = await server.call('jira_get_myself');
      assert.equal(result.isError, true);
      assert.match(result.text, /Authentication failed/);
      assert.ok(Date.now() - started < 5000, 'a 401 must not be retried with backoff');
      // Later calls must not log in again: each failed login counts toward Jira's CAPTCHA
      const again = await server.call('jira_search', { jql: 'project = IT' });
      assert.equal(again.isError, true);
      assert.match(again.text, /restart the MCP server/);
    } finally {
      await server.close();
    }
    // A successful login resets Jira's failed-login counter
    const reset = await startServer({ ...env, JIRA_USERNAME: throwaway, JIRA_PASSWORD: 'Right-pass-1' });
    await reset.ok('jira_get_myself');
    await reset.close();
  });

  it('CAPTCHA lockout is reported as such', async () => {
    // Simulate other clients (or a browser) failing to log in repeatedly
    const wrong = `Basic ${Buffer.from(`${lockedOut}:wrong`).toString('base64')}`;
    for (let i = 0; i < 4; i++) {
      await fetch(`${env.JIRA_BASE_URL}/rest/api/2/myself`, { headers: { Authorization: wrong } });
    }

    const server = await startServer({ ...env, JIRA_USERNAME: lockedOut, JIRA_PASSWORD: 'Right-pass-1' });
    try {
      const result = await server.call('jira_get_myself');
      assert.equal(result.isError, true, 'locked out after repeated failures');
      assert.match(result.text, /CAPTCHA/);
    } finally {
      await server.close();
    }
  });

  it('missing credentials: server exits with a helpful message', async () => {
    const childEnv = { ...process.env, JIRA_BASE_URL: env.JIRA_BASE_URL };
    delete childEnv.JIRA_USERNAME;
    delete childEnv.JIRA_PASSWORD;
    // A real stored credential would (correctly) be used instead
    if ((await loadKeytar())?.hasRealCredential) return;
    const { code, stderr } = await runServer(childEnv);
    assert.equal(code, 1);
    assert.match(stderr, /JIRA_USERNAME and JIRA_PASSWORD|No Jira credentials|credential store/);
  });

  it('missing JIRA_BASE_URL: server exits with a helpful message', async () => {
    const childEnv = { ...process.env, ...env };
    delete childEnv.JIRA_BASE_URL;
    const { code, stderr } = await runServer(childEnv);
    assert.equal(code, 1);
    assert.match(stderr, /JIRA_BASE_URL/);
  });

  describe('OS credential store', () => {
    let keytar;
    const stored = [];

    before(async () => {
      const store = await loadKeytar();
      // never touch a real credential
      keytar = store && !store.hasRealCredential ? store.keytar : null;
    });

    after(async () => {
      for (const account of stored) await keytar?.deletePassword('JiraMCP', account);
    });

    const store = async (account, password) => {
      await keytar.setPassword('JiraMCP', account, password);
      stored.push(account);
    };

    it('reads the credential when env vars are absent', async (t) => {
      if (!keytar) return t.skip('keytar unavailable or a real JiraMCP credential exists');
      await store(throwaway, 'Right-pass-1');
      const server = await startServer({ JIRA_BASE_URL: env.JIRA_BASE_URL, JIRA_LOG_LEVEL: 'ERROR' }, {
        omit: ['JIRA_USERNAME', 'JIRA_PASSWORD'],
      });
      try {
        const { json } = await server.ok('jira_get_myself');
        assert.equal(json.name, throwaway);
      } finally {
        await server.close();
      }
    });

    it('env vars win over the credential store', async (t) => {
      if (!keytar) return t.skip('keytar unavailable');
      const server = await startServer(env);
      try {
        const { json } = await server.ok('jira_get_myself');
        assert.equal(json.name, env.JIRA_USERNAME);
      } finally {
        await server.close();
      }
    });

    it('multiple stored accounts: JIRA_USERNAME selects one, otherwise a clear error', async (t) => {
      if (!keytar) return t.skip('keytar unavailable');
      await store(env.JIRA_USERNAME, env.JIRA_PASSWORD);

      const ambiguous = await runServer({ ...process.env, JIRA_BASE_URL: env.JIRA_BASE_URL, JIRA_USERNAME: '', JIRA_PASSWORD: '' });
      assert.equal(ambiguous.code, 1);
      assert.match(ambiguous.stderr, /Multiple Jira credentials/);

      const server = await startServer({ JIRA_BASE_URL: env.JIRA_BASE_URL, JIRA_USERNAME: throwaway, JIRA_LOG_LEVEL: 'ERROR' }, {
        omit: ['JIRA_PASSWORD'],
      });
      try {
        const { json } = await server.ok('jira_get_myself');
        assert.equal(json.name, throwaway);
      } finally {
        await server.close();
      }
    });
  });
});
