#!/usr/bin/env node
/**
 * Spin up a throwaway Jira Software instance in Docker for integration tests.
 *
 *   node test/integration/jira-docker.mjs up <version> [port] [contextPath]   # start + set up + seed
 *   node test/integration/jira-docker.mjs down <version>                      # remove container
 *
 * contextPath (e.g. /jira) serves Jira under a sub-path, like many company installs.
 *
 * Setup uses Atlassian's public 3-hour "timebomb" Data Center license
 * (https://developer.atlassian.com/platform/marketplace/timebomb-licenses-for-testing-server-apps/),
 * the embedded database (PostgreSQL for Jira 10+), admin / Jira-IT-admin-1, and a Scrum project "IT" (which also
 * creates a board). Prints the JIRA_BASE_URL on success.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ADMIN = { username: 'admin', password: 'Jira-IT-admin-1' };
export const SECOND_USER = { username: 'jdoe', password: 'Jira-IT-jdoe-1', displayName: 'John Doe' };
export const PROJECT_KEY = 'IT';
/** A second project, used to check JIRA_PROJECTS_FILTER isolation. */
export const OTHER_PROJECT_KEY = 'OT';

const containerName = version => `jira-easy-mcp-it-${version.replace(/[^\w.-]/g, '')}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = msg => console.error(`[jira-docker] ${msg}`);

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Minimal cookie-jar fetch for the browser-style setup wizard. */
const createSession = baseUrl => {
  const cookies = new Map();
  const request = async (path, { form, ...options } = {}) => {
    const headers = { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...options.headers };
    let body;
    if (form) {
      body = new URLSearchParams({ ...form, atl_token: cookies.get('atlassian.xsrf.token') || '' });
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['X-Atlassian-Token'] = 'no-check';
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method: form ? 'POST' : 'GET',
      redirect: 'manual',
      ...options,
      headers,
      body,
    });
    for (const cookie of response.headers.getSetCookie?.() || []) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  };
  return { request, cookies };
};

const getState = async baseUrl => {
  try {
    const response = await fetch(`${baseUrl}/status`);
    return (await response.json()).state;
  } catch {
    return 'DOWN';
  }
};

const waitForState = async (baseUrl, states, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let state;
  while (Date.now() < deadline) {
    state = await getState(baseUrl);
    if (states.includes(state)) return state;
    await sleep(5000);
  }
  throw new Error(`Jira at ${baseUrl} did not reach ${states.join('/')} (last state: ${state})`);
};

const rest = async (baseUrl, method, path, body) => {
  const response = await fetch(`${baseUrl}/rest${path}`, {
    method,
    headers: {
      'Authorization': `Basic ${Buffer.from(`${ADMIN.username}:${ADMIN.password}`).toString('base64')}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined, text };
};

/** GET a wizard step and report its form field names (for debugging new Jira versions). */
const inspectStep = async (request, path) => {
  const response = await request(path);
  const html = await response.text();
  const fields = [...new Set([...html.matchAll(/name="([\w.]+)"/g)].map(m => m[1]))];
  if (process.env.JIRA_DOCKER_DEBUG) log(`  ${path} -> ${response.status} fields=${fields.join(',')}`);
  return fields;
};

const post = async (request, path, form) => {
  const response = await request(path, { form });
  if (process.env.JIRA_DOCKER_DEBUG) {
    log(`  POST ${path} -> ${response.status} ${response.headers.get('location') || ''}`);
  }
  if (response.status >= 400) throw new Error(`${path} failed with ${response.status}`);
  return response;
};

/** Walk the first-run setup wizard (works on Jira 7.x through 10.x). */
const runSetupWizard = async (baseUrl, license, { postgresHost }) => {
  const { request } = createSession(baseUrl);
  await request('/secure/SetupMode!default.jspa');

  if (postgresHost) {
    log('setup: database (PostgreSQL)');
    await request('/secure/SetupDatabase.jspa', {
      form: {
        databaseOption: 'external', databaseType: 'postgres72', jdbcHostname: postgresHost, jdbcPort: '5432',
        jdbcDatabase: 'jira', jdbcUsername: 'jira', jdbcPassword: 'jira', schemaName: 'public', testingConnection: 'false',
      },
    });
  } else {
    log('setup: database (embedded)');
    await request('/secure/SetupDatabase.jspa', { form: { databaseOption: 'internal' } });
  }
  // Database initialisation can take minutes; poll until the next step page renders
  for (let i = 0; i < 120; i++) {
    const response = await request('/secure/SetupApplicationProperties!default.jspa');
    if (response.status === 200) break;
    await sleep(5000);
  }

  log('setup: application properties');
  await inspectStep(request, '/secure/SetupApplicationProperties!default.jspa');
  await post(request, '/secure/SetupApplicationProperties.jspa', {
    title: 'Jira IT', mode: 'private', baseURL: baseUrl, nextStep: 'true',
  });

  log('setup: license');
  await inspectStep(request, '/secure/SetupLicense!default.jspa');
  await post(request, '/secure/SetupLicense.jspa', { setupLicenseKey: license });

  log('setup: admin account');
  await inspectStep(request, '/secure/SetupAdminAccount!default.jspa');
  const adminResponse = await post(request, '/secure/SetupAdminAccount.jspa', {
    fullname: 'Admin', email: 'admin@example.com',
    username: ADMIN.username, password: ADMIN.password, confirm: ADMIN.password,
  });
  if (adminResponse.status !== 302) {
    // Jira 7-9 redirect on success; Jira 10 answers 200. Either way, a
    // re-rendered form with error messages means the account was not created.
    const html = await adminResponse.text();
    const errors = [...html.matchAll(/<div[^>]*class="[^"]*error[^"]*"[^>]*>([\s\S]{0,300}?)<\/div>/g)]
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (errors.length) throw new Error(`Admin account step rejected: ${errors.join('; ')}`);
  }

  log('setup: mail (disabled)');
  await inspectStep(request, '/secure/SetupMailNotifications!default.jspa');
  await post(request, '/secure/SetupMailNotifications.jspa', { noemail: 'true' });
};

const seed = async baseUrl => {
  const myself = await rest(baseUrl, 'GET', '/api/2/myself');
  if (myself.status !== 200) {
    throw new Error(`Admin login failed after setup (${myself.status}): ${myself.text.slice(0, 300)}`);
  }

  for (const [key, name] of [[PROJECT_KEY, 'Integration Tests'], [OTHER_PROJECT_KEY, 'Other Project']]) {
    const existing = await rest(baseUrl, 'GET', `/api/2/project/${key}`);
    if (existing.status === 200) continue;
    log(`seed: project ${key}`);
    const created = await rest(baseUrl, 'POST', '/api/2/project', {
      key,
      name,
      projectTypeKey: 'software',
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-scrum-template',
      lead: ADMIN.username,
    });
    if (created.status >= 300) throw new Error(`Project ${key} create failed: ${created.text}`);
  }

  const user = await rest(baseUrl, 'GET', `/api/2/user?username=${SECOND_USER.username}`);
  if (user.status !== 200) {
    log(`seed: user ${SECOND_USER.username}`);
    const created = await rest(baseUrl, 'POST', '/api/2/user', {
      name: SECOND_USER.username,
      password: SECOND_USER.password,
      emailAddress: 'jdoe@example.com',
      displayName: SECOND_USER.displayName,
      applicationKeys: ['jira-software'],
    });
    if (created.status >= 300) throw new Error(`User create failed: ${created.text}`);
  }
  // Make the second user assignable in the project (Developers role)
  const roles = await rest(baseUrl, 'GET', `/api/2/project/${PROJECT_KEY}/role`);
  const developers = Object.entries(roles.data || {}).find(([name]) => /developer|member/i.test(name));
  if (developers) {
    const roleId = developers[1].split('/').pop();
    await rest(baseUrl, 'POST', `/api/2/project/${PROJECT_KEY}/role/${roleId}`, { user: [SECOND_USER.username] });
  }
};

const exists = name => Boolean(docker('ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}'));

/** Jira 10 dropped the embedded H2 database, so it gets a PostgreSQL sidecar. */
const needsPostgres = version => Number(version.split('.')[0]) >= 10;

const startPostgres = name => {
  const db = `${name}-db`;
  if (exists(db)) {
    docker('start', db);
  } else {
    log(`starting ${db}`);
    docker(
      'run', '-d', '--name', db, '--network', name,
      '-e', 'POSTGRES_USER=jira', '-e', 'POSTGRES_PASSWORD=jira', '-e', 'POSTGRES_DB=jira',
      '-e', 'POSTGRES_INITDB_ARGS=--encoding=UTF8 --lc-collate=C --lc-ctype=C',
      'postgres:15'
    );
  }
  return db;
};

export const up = async (version, port, contextPath = '') => {
  const name = containerName(version);
  const baseUrl = `http://localhost:${port}${contextPath}`;
  const license = readFileSync(join(here, 'timebomb-license.txt'), 'utf8').trim();
  const postgres = needsPostgres(version);

  if (!exists(name)) {
    log(`starting ${name} on ${baseUrl}`);
    let dbArgs = [];
    if (postgres) {
      try { docker('network', 'create', name); } catch { /* already exists */ }
      startPostgres(name);
      dbArgs = ['--network', name];
    }
    docker(
      'run', '-d', '--name', name, '-p', `${port}:8080`, ...dbArgs,
      '-e', 'JVM_MINIMUM_MEMORY=1024m', '-e', 'JVM_MAXIMUM_MEMORY=2048m',
      '-e', `ATL_PROXY_NAME=localhost`, '-e', `ATL_PROXY_PORT=${port}`, '-e', 'ATL_TOMCAT_SCHEME=http',
      ...(contextPath ? ['-e', `ATL_TOMCAT_CONTEXTPATH=${contextPath}`] : []),
      `atlassian/jira-software:${version}`
    );
  } else {
    if (postgres) startPostgres(name);
    docker('start', name);
  }

  const state = await waitForState(baseUrl, ['FIRST_RUN', 'RUNNING'], 15 * 60_000);
  if (state === 'FIRST_RUN') {
    await runSetupWizard(baseUrl, license, { postgresHost: postgres ? `${name}-db` : undefined });
    await waitForState(baseUrl, ['RUNNING'], 10 * 60_000);
  }
  await seed(baseUrl);
  log(`ready: ${baseUrl}`);
  return baseUrl;
};

export const down = version => {
  const name = containerName(version);
  for (const container of [name, `${name}-db`]) {
    if (exists(container)) docker('rm', '-f', container);
  }
  try { docker('network', 'rm', name); } catch { /* no network */ }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, version, port = '8080', contextPath = ''] = process.argv.slice(2);
  if (command === 'up' && version) {
    up(version, Number(port), contextPath).then(url => console.log(url), err => {
      console.error(err);
      process.exit(1);
    });
  } else if (command === 'down' && version) {
    down(version);
  } else {
    console.error('usage: jira-docker.mjs up <version> [port] [contextPath] | down <version>');
    process.exit(2);
  }
}
