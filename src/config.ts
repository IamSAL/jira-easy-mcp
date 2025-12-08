/**
 * Jira MCP Server - Configuration Module
 * 
 * Handles environment variable loading and configuration management.
 */

import type { JiraConfig } from './types.js';

let cachedConfig: JiraConfig | null = null;

/**
 * Get Jira configuration from environment variables.
 * Caches the configuration for subsequent calls.
 */
export const getConfig = (): JiraConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) {
    throw new Error('Missing JIRA_BASE_URL environment variable');
  }
  
  const username = process.env.JIRA_USERNAME;
  if (!username) {
    throw new Error('Missing JIRA_USERNAME environment variable');
  }

  const password = process.env.JIRA_PASSWORD;
  if (!password) {
    throw new Error('Missing JIRA_PASSWORD environment variable');
  }

  // Optional: Project filter (comma-separated list of project keys)
  const projectsFilterStr = process.env.JIRA_PROJECTS_FILTER;
  const projectsFilter = projectsFilterStr
    ? projectsFilterStr.split(',').map(p => p.trim().toUpperCase()).filter(Boolean)
    : undefined;

  cachedConfig = {
    baseUrl: baseUrl.replace(/\/$/, ''),
    username,
    password,
    projectsFilter,
  };

  return cachedConfig;
};

/**
 * Validate configuration on startup.
 * Returns true if configuration is valid, throws error otherwise.
 */
export const validateConfig = (): boolean => {
  getConfig();
  return true;
};

/**
 * Clear cached configuration (useful for testing).
 */
export const clearConfigCache = (): void => {
  cachedConfig = null;
};

/**
 * Check if a project is allowed by the filter.
 * If no filter is configured, all projects are allowed.
 */
export const isProjectAllowed = (projectKey: string): boolean => {
  const config = getConfig();
  if (!config.projectsFilter || config.projectsFilter.length === 0) {
    return true;
  }
  return config.projectsFilter.includes(projectKey.toUpperCase());
};

/**
 * Default fields to retrieve when reading Jira issues.
 */
export const DEFAULT_READ_FIELDS = [
  'summary',
  'status',
  'priority',
  'issuetype',
  'assignee',
  'reporter',
  'created',
  'updated',
  'description',
  'labels',
  'components',
  'fixVersions',
  'resolution',
  'parent',
  'subtasks',
  'issuelinks',
  'duedate',
  'timetracking',
] as const;

/**
 * Minimal fields for search results.
 */
export const SEARCH_FIELDS = [
  'summary',
  'status',
  'priority',
  'issuetype',
  'assignee',
  'reporter',
  'created',
  'updated',
] as const;
