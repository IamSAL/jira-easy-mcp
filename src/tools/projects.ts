/**
 * Jira MCP Server - Project Tools
 * 
 * Tools for listing and getting project information.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jiraGet, jiraPost } from '../client.js';
import { toSimplifiedProject } from '../transformers.js';
import { getConfig } from '../config.js';
import type { JiraProject, JiraVersion, SimplifiedProject } from '../types.js';

/**
 * Get all projects.
 */
export const getAllProjects = async (): Promise<SimplifiedProject[]> => {
  const projects = await jiraGet<JiraProject[]>('/project');
  const { projectsFilter } = getConfig();
  
  let filtered = projects;
  if (projectsFilter && projectsFilter.length > 0) {
    const filterSet = new Set(projectsFilter.map((p: string) => p.toUpperCase()));
    filtered = projects.filter(p => filterSet.has(p.key.toUpperCase()));
  }

  return filtered.map(toSimplifiedProject);
};

/**
 * Get a single project.
 */
export const getProject = async (projectKey: string): Promise<SimplifiedProject> => {
  const project = await jiraGet<JiraProject>(`/project/${projectKey}`);
  return toSimplifiedProject(project);
};

/**
 * Get project versions.
 */
export const getProjectVersions = async (projectKey: string): Promise<JiraVersion[]> => {
  return jiraGet<JiraVersion[]>(`/project/${projectKey}/versions`);
};

/**
 * Create a project version.
 */
export const createVersion = async (
  projectKey: string,
  name: string,
  options?: {
    description?: string;
    releaseDate?: string;
    startDate?: string;
    released?: boolean;
    archived?: boolean;
  }
): Promise<JiraVersion> => {
  const body: Record<string, unknown> = {
    name,
    project: projectKey,
  };

  if (options?.description) body.description = options.description;
  if (options?.releaseDate) body.releaseDate = options.releaseDate;
  if (options?.startDate) body.startDate = options.startDate;
  if (options?.released !== undefined) body.released = options.released;
  if (options?.archived !== undefined) body.archived = options.archived;

  return jiraPost<JiraVersion>('/version', body);
};

/**
 * Register project tools with the MCP server.
 */
export const registerProjectTools = (server: McpServer): void => {
  // Get all projects
  server.tool(
    'jira_get_projects',
    'List all Jira projects the authenticated user has access to. Returns project keys, names, and lead information. Use this to discover available projects before searching for issues or creating new ones. If JIRA_PROJECTS_FILTER environment variable is set, only those specific projects are returned.',
    {},
    async () => {
      const projects = await getAllProjects();
      return {
        content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }],
      };
    }
  );

  // Get single project
  server.tool(
    'jira_get_project',
    'Get detailed information about a specific Jira project including description, lead, issue types, and components. Use jira_get_projects first to find available project keys.',
    {
      projectKey: z.string().describe('Project key (e.g., KP, PROJ). Get from jira_get_projects.'),
    },
    async ({ projectKey }) => {
      const project = await getProject(projectKey);
      return {
        content: [{ type: 'text', text: JSON.stringify(project, null, 2) }],
      };
    }
  );

  // Get project versions
  server.tool(
    'jira_get_project_versions',
    'Get all versions (releases) defined in a Jira project. Returns version names, release status, and dates. Useful for finding Fix Version values when creating/updating issues or for release planning.',
    {
      projectKey: z.string().describe('Project key (e.g., KP)'),
    },
    async ({ projectKey }) => {
      const versions = await getProjectVersions(projectKey);
      
      // Simplify the response
      const simplified = versions.map(v => ({
        id: v.id,
        name: v.name,
        description: v.description,
        released: v.released,
        archived: v.archived,
        releaseDate: v.releaseDate,
        startDate: v.startDate,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify(simplified, null, 2) }],
      };
    }
  );

  // Create version
  server.tool(
    'jira_create_version',
    'Create a new version/release in a Jira project for release planning and tracking. Versions can be used as Fix Version values on issues. Set released=true for already-released versions.',
    {
      projectKey: z.string().describe('Project key where the version will be created (e.g., KP)'),
      name: z.string().describe('Version name (e.g., "v1.2.0", "Sprint 5", "Q1 2024")'),
      description: z.string().optional().describe('Description of what this version/release includes'),
      releaseDate: z.string().optional().describe('Target or actual release date (YYYY-MM-DD format)'),
      startDate: z.string().optional().describe('Development start date (YYYY-MM-DD format)'),
      released: z.boolean().optional().describe('Set to true if this version has already been released'),
    },
    async ({ projectKey, name, description, releaseDate, startDate, released }) => {
      const version = await createVersion(projectKey, name, {
        description,
        releaseDate,
        startDate,
        released,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(version, null, 2) }],
      };
    }
  );
};
