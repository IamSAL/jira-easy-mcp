#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Jira MCP Server (Browser-based)
 * Uses Playwright to browse Jira issues through browser automation
 *
 * Environment variables:
 *   JIRA_BASE_URL - Jira instance URL (e.g., https://your-domain.atlassian.net)
 *   JIRA_USERNAME - Jira username for auto-login
 *   JIRA_PASSWORD - Jira password for auto-login
 *
 * The browser session will be persisted for subsequent runs.
 */

import * as path from 'path';
import * as os from 'os';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  chromium,
  type BrowserContext,
  type Page,
} from 'playwright';

// Browser state
let context: BrowserContext | null = null;
let page: Page | null = null;

const getBaseUrl = (): string => {
  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) {
    throw new Error('Missing JIRA_BASE_URL environment variable');
  }
  return baseUrl.replace(/\/$/, '');
};

const getCredentials = (): { username: string; password: string } | null => {
  const username = process.env.JIRA_USERNAME;
  const password = process.env.JIRA_PASSWORD;
  if (username && password) {
    return { username, password };
  }
  return null;
};

const getUserDataDir = (): string => {
  return path.join(os.homedir(), '.jira-mcp-browser-data');
};

// Initialize browser with persistent context
const initBrowser = async (): Promise<Page> => {
  if (page) return page;

  const userDataDir = getUserDataDir();
  console.error(`Using browser data dir: ${userDataDir}`);

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  page = context.pages()[0] || (await context.newPage());
  return page;
};

interface LoginStatus {
  loggedIn: boolean;
  message?: string;
}

// Ensure logged in
const ensureLoggedIn = async (p: Page): Promise<LoginStatus> => {
  const baseUrl = getBaseUrl();
  const currentUrl = p.url();

  // If not on Jira, navigate there
  if (!currentUrl.includes(new URL(baseUrl).hostname)) {
    await p.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2000);
  }

  // Check if login is required - support both Jira Cloud and Jira Server
  const loginForm = await p.$(
    '[data-testid="login-button"], #login-submit, input[type="submit"][value*="Log"], #login-form, form[name="loginform"]'
  );
  
  if (loginForm) {
    const credentials = getCredentials();
    if (!credentials) {
      return {
        loggedIn: false,
        message:
          'Login required. Set JIRA_USERNAME and JIRA_PASSWORD environment variables for auto-login.',
      };
    }

    console.error('Attempting auto-login...');
    
    // Try Jira Server login selectors first, then Cloud
    const usernameField = await p.$('#login-form-username, input[name="os_username"], #username, input[name="username"]');
    const passwordField = await p.$('#login-form-password, input[name="os_password"], #password, input[name="password"]');
    const submitButton = await p.$('#login-form-submit, #login-submit, input[type="submit"][value*="Log"], button[type="submit"]');
    
    if (usernameField && passwordField && submitButton) {
      await usernameField.fill(credentials.username);
      await passwordField.fill(credentials.password);
      await submitButton.click();
      
      // Wait for navigation after login
      await p.waitForTimeout(3000);
      
      // Check if login succeeded by looking for login form again
      const stillOnLogin = await p.$('#login-form, form[name="loginform"], [data-testid="login-button"]');
      if (stillOnLogin) {
        return {
          loggedIn: false,
          message: 'Auto-login failed. Please check your credentials.',
        };
      }
      
      console.error('Auto-login successful');
    } else {
      return {
        loggedIn: false,
        message: 'Could not find login form fields.',
      };
    }
  }

  return { loggedIn: true };
};

interface JiraIssue {
  key: string;
  summary: string;
  status?: string;
  priority?: string;
  assignee?: string;
  type?: string;
}

interface SearchResult {
  total: number;
  jql: string;
  issues: JiraIssue[];
}

// Search issues using JQL
const searchIssues = async (
  jql: string,
  maxResults = 50
): Promise<SearchResult | LoginStatus> => {
  const p = await initBrowser();
  const baseUrl = getBaseUrl();

  const loginStatus = await ensureLoggedIn(p);
  if (!loginStatus.loggedIn) {
    return loginStatus;
  }

  // Navigate to search with JQL
  const searchUrl = `${baseUrl}/issues/?jql=${encodeURIComponent(jql)}`;
  await p.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);

  // Extract issues from the page
  const issues = await p.evaluate(() => {
    const results: Array<{
      key: string;
      summary: string;
      status?: string;
      priority?: string;
      assignee?: string;
      type?: string;
    }> = [];

    // Jira Server table structure - get rows from the issue table body
    const issueRows = document.querySelectorAll(
      'table tbody tr, .issuerow, [data-issuekey], tr.issuerow'
    );

    issueRows.forEach(row => {
      // Jira Server: Key is in a cell with a link to /browse/KEY
      const keyLink = row.querySelector('a[href*="/browse/"]');
      const key = keyLink?.textContent?.trim();
      
      if (!key || key.includes('/')) return; // Skip if not a valid issue key
      
      // Summary is usually in a cell with a paragraph containing a link
      const summaryEl = row.querySelector('td p a, td.summary a, .summary a');
      const summary = summaryEl?.textContent?.trim() || '';
      
      // Status is in a span/div with the status text
      const statusEl = row.querySelector('td span[class*="status"], td div[class*="status"], .status span');
      const status = statusEl?.textContent?.trim();
      
      // Priority is an img with alt text
      const priorityEl = row.querySelector('td img[alt]');
      const priority = priorityEl?.getAttribute('alt') || undefined;
      
      // Assignee is a link to the user profile
      const cells = row.querySelectorAll('td');
      let assignee: string | undefined;
      let type: string | undefined;
      
      cells.forEach((cell, index) => {
        const link = cell.querySelector('a[href*="ViewProfile"]');
        if (link && !assignee) {
          // First profile link is often assignee (after developer name)
          assignee = link.textContent?.trim();
        }
        // Type is in the first cell with an img
        if (index === 0) {
          const typeImg = cell.querySelector('img[alt]');
          if (typeImg) {
            type = typeImg.getAttribute('alt') || undefined;
          }
        }
      });

      if (key) {
        results.push({
          key,
          summary,
          status,
          priority,
          assignee,
          type,
        });
      }
    });

    // Remove duplicates (key appears multiple times in the row)
    const seen = new Set<string>();
    return results.filter(issue => {
      if (seen.has(issue.key)) return false;
      seen.add(issue.key);
      return true;
    });
  });

  return {
    total: issues.length,
    jql,
    issues: issues.slice(0, maxResults),
  };
};

interface IssueDetails {
  key: string | null;
  summary: string | null;
  status: string | null;
  priority: string | null;
  type: string | null;
  assignee: string | null;
  reporter: string | null;
  description: string | null;
  acceptanceCriteria: string | null;
  labels: string[];
  components: string[];
  created: string | null;
  updated: string | null;
}

// Get issue details
const getIssueDetails = async (
  issueKey: string
): Promise<IssueDetails | LoginStatus> => {
  const p = await initBrowser();
  const baseUrl = getBaseUrl();

  const loginStatus = await ensureLoggedIn(p);
  if (!loginStatus.loggedIn) {
    return loginStatus;
  }

  // Navigate to the issue
  const issueUrl = `${baseUrl}/browse/${issueKey}`;
  await p.goto(issueUrl, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);

  // Extract issue details
  const details = await p.evaluate(() => {
    // Jira Server: Get key from breadcrumb or meta tag
    const keyEl = document.querySelector('nav ol li:last-child a, meta[name="ajs-issue-key"]');
    const key = keyEl?.textContent?.trim() || keyEl?.getAttribute('content') || null;

    // Get summary from h1 heading
    const summaryEl = document.querySelector('h1');
    const summary = summaryEl?.textContent?.trim() || null;

    // Get status from the status field
    let status: string | null = null;
    document.querySelectorAll('li').forEach(li => {
      const strong = li.querySelector('strong');
      if (strong?.textContent?.includes('Status:')) {
        // Status can be in span, div, or direct text
        const statusContainer = li.querySelector('span:not([class*="icon"]), div:not([class*="icon"]), [class*="status"]');
        if (statusContainer) {
          status = statusContainer.textContent?.trim() || null;
        }
        if (!status) {
          // Try getting text after the strong tag
          const fullText = li.textContent || '';
          const match = fullText.match(/Status:\s*(.+?)(?:\(|$)/);
          if (match) status = match[1].trim();
        }
      }
    });

    // Get priority
    const priorityEl = document.querySelector('img[alt*="Highest"], img[alt*="High"], img[alt*="Medium"], img[alt*="Low"], img[alt*="Lowest"]');
    const priority = priorityEl?.getAttribute('alt')?.split(' - ')[0] || null;

    // Get type
    let type: string | null = null;
    document.querySelectorAll('li').forEach(li => {
      const strong = li.querySelector('strong');
      if (strong?.textContent?.includes('Type:')) {
        const img = li.querySelector('img');
        type = img?.getAttribute('alt') || li.textContent?.replace('Type:', '').trim() || null;
      }
    });

    // Get assignee
    let assignee: string | null = null;
    document.querySelectorAll('dt, term').forEach(dt => {
      if (dt.textContent?.includes('Assignee:')) {
        const dd = dt.nextElementSibling;
        assignee = dd?.textContent?.trim() || null;
      }
    });

    // Get reporter
    let reporter: string | null = null;
    document.querySelectorAll('dt, term').forEach(dt => {
      if (dt.textContent?.includes('Reporter:')) {
        const dd = dt.nextElementSibling;
        reporter = dd?.textContent?.trim() || null;
      }
    });

    // Get description
    let description: string | null = null;
    document.querySelectorAll('h4').forEach(h4 => {
      if (h4.textContent?.includes('Description')) {
        const descContainer = h4.closest('div')?.nextElementSibling || h4.parentElement?.nextElementSibling;
        description = descContainer?.textContent?.trim() || null;
      }
    });

    // Get labels
    const labels: string[] = [];
    document.querySelectorAll('li').forEach(li => {
      const strong = li.querySelector('strong');
      if (strong?.textContent?.includes('Labels:')) {
        li.querySelectorAll('a').forEach(a => {
          const label = a.textContent?.trim();
          if (label) labels.push(label);
        });
      }
    });

    // Get components
    const components: string[] = [];
    document.querySelectorAll('li').forEach(li => {
      const strong = li.querySelector('strong');
      if (strong?.textContent?.includes('Component')) {
        li.querySelectorAll('a').forEach(a => {
          const comp = a.textContent?.trim();
          if (comp) components.push(comp);
        });
      }
    });

    // Get created/updated dates
    let created: string | null = null;
    let updated: string | null = null;
    document.querySelectorAll('dt, term').forEach(dt => {
      if (dt.textContent?.includes('Created:')) {
        const dd = dt.nextElementSibling;
        const time = dd?.querySelector('time');
        created = time?.textContent?.trim() || dd?.textContent?.trim() || null;
      }
      if (dt.textContent?.includes('Updated:')) {
        const dd = dt.nextElementSibling;
        const time = dd?.querySelector('time');
        updated = time?.textContent?.trim() || dd?.textContent?.trim() || null;
      }
    });

    return {
      key,
      summary,
      status,
      priority,
      type,
      assignee,
      reporter,
      description,
      acceptanceCriteria: null, // Custom field - may vary
      labels,
      components,
      created,
      updated,
    };
  });

  return details;
};

// Cleanup on exit
const cleanup = async (): Promise<void> => {
  if (context) {
    await context.close();
  }
};

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

// Create MCP server
const server = new McpServer({
  name: 'jira-browser-mcp',
  version: '1.0.0',
});

// Register tools
server.tool(
  'jira_search_issues',
  'Search for Jira issues using JQL. Opens browser if needed (login manually on first use).',
  {
    jql: z
      .string()
      .describe('JQL query (e.g., "project = PROJ AND status = Open")'),
    maxResults: z
      .number()
      .optional()
      .describe('Max results to return (default: 50)'),
  },
  async ({ jql, maxResults }) => {
    try {
      const result = await searchIssues(jql, maxResults ?? 50);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'jira_get_issue',
  'Get detailed information about a Jira issue by key (e.g., PROJ-123).',
  {
    issueKey: z.string().describe('The issue key (e.g., PROJ-123)'),
  },
  async ({ issueKey }) => {
    try {
      const result = await getIssueDetails(issueKey);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// Run server
const main = async (): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Jira MCP server (browser-based) running on stdio');
};

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
