// mvp/src/services/brownfield/connectors.ts

import { createChildLogger } from '../../lib/logger.js';
import type { AgentTool, AgentContext, ToolResult } from '../agent-runtime/types.js';

const log = createChildLogger({ service: 'BrownfieldConnectors' });

/**
 * MCP connector configuration for a brownfield data source.
 */
export interface ConnectorConfig {
  provider: 'github' | 'jira' | 'confluence';
  baseUrl: string;
  apiKey: string;
  metadata?: Record<string, string>;
}

// =============================================================================
// GitHub MCP Connector
// =============================================================================

/**
 * Create GitHub MCP tools for repo access, code search, and PR management.
 *
 * These tools are used by the Dev Agent for brownfield support:
 * - Level 1: Full codebase scan during onboarding
 * - Level 2: Per-engagement fresh reads of relevant files
 */
export function createGitHubTools(config: ConnectorConfig): AgentTool[] {
  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Workforce0-Agent',
  };
  const baseUrl = config.baseUrl.replace(/\/+$/, '');

  return [
    {
      name: 'github_list_repos',
      description: 'List repositories accessible to the integration. Returns repo names, languages, and last push dates.',
      inputSchema: {
        type: 'object',
        properties: {
          org: { type: 'string', description: 'Organization or user name' },
          page: { type: 'number', description: 'Page number (default 1)' },
        },
        required: ['org'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const org = input.org as string;
          const page = (input.page as number) || 1;
          const response = await fetch(`${baseUrl}/orgs/${org}/repos?page=${page}&per_page=30`, { headers });
          if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
          const repos = await response.json() as any[];
          return {
            success: true,
            data: repos.map((r: any) => ({
              name: r.name,
              fullName: r.full_name,
              language: r.language,
              defaultBranch: r.default_branch,
              lastPush: r.pushed_at,
              private: r.private,
            })),
          };
        } catch (err) {
          log.error({ error: (err as Error).message }, 'github_list_repos failed');
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'github_read_file',
      description: 'Read a file from a repository. Returns the decoded content.',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repo owner' },
          repo: { type: 'string', description: 'Repo name' },
          path: { type: 'string', description: 'File path within the repo' },
          ref: { type: 'string', description: 'Branch or commit SHA (default: main)' },
        },
        required: ['owner', 'repo', 'path'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const { owner, repo, path, ref } = input as { owner: string; repo: string; path: string; ref?: string };
          const url = `${baseUrl}/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${ref}` : ''}`;
          const response = await fetch(url, { headers });
          if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
          const data = await response.json() as { content: string; encoding: string; name: string; size: number };
          const content = Buffer.from(data.content, 'base64').toString('utf-8');
          return { success: true, data: { name: data.name, size: data.size, content } };
        } catch (err) {
          log.error({ error: (err as Error).message }, 'github_read_file failed');
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'github_search_code',
      description: 'Search for code in a repository. Returns matching files with context.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (GitHub code search syntax)' },
          repo: { type: 'string', description: 'Full repo name (owner/repo)' },
        },
        required: ['query'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const query = input.query as string;
          const repo = input.repo as string | undefined;
          const q = repo ? `${query} repo:${repo}` : query;
          const response = await fetch(`${baseUrl}/search/code?q=${encodeURIComponent(q)}&per_page=20`, { headers });
          if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
          const data = await response.json() as { total_count: number; items: any[] };
          return {
            success: true,
            data: {
              totalCount: data.total_count,
              items: data.items.map((item: any) => ({
                name: item.name,
                path: item.path,
                repo: item.repository?.full_name,
              })),
            },
          };
        } catch (err) {
          log.error({ error: (err as Error).message }, 'github_search_code failed');
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'github_list_prs',
      description: 'List pull requests for a repository. Returns PR titles, states, and authors.',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repo owner' },
          repo: { type: 'string', description: 'Repo name' },
          state: { type: 'string', description: 'PR state: open, closed, all (default: open)' },
        },
        required: ['owner', 'repo'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const { owner, repo, state } = input as { owner: string; repo: string; state?: string };
          const response = await fetch(
            `${baseUrl}/repos/${owner}/${repo}/pulls?state=${state || 'open'}&per_page=20`,
            { headers },
          );
          if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
          const prs = await response.json() as any[];
          return {
            success: true,
            data: prs.map((pr: any) => ({
              number: pr.number,
              title: pr.title,
              state: pr.state,
              author: pr.user?.login,
              createdAt: pr.created_at,
              updatedAt: pr.updated_at,
            })),
          };
        } catch (err) {
          log.error({ error: (err as Error).message }, 'github_list_prs failed');
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'github_get_repo_structure',
      description: 'Get the directory tree of a repository. Returns file/folder paths for codebase understanding.',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repo owner' },
          repo: { type: 'string', description: 'Repo name' },
          ref: { type: 'string', description: 'Branch or commit (default: main)' },
        },
        required: ['owner', 'repo'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const { owner, repo, ref } = input as { owner: string; repo: string; ref?: string };
          const sha = ref || 'HEAD';
          const response = await fetch(
            `${baseUrl}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
            { headers },
          );
          if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
          const data = await response.json() as { tree: any[]; truncated: boolean };
          return {
            success: true,
            data: {
              truncated: data.truncated,
              files: data.tree
                .filter((t: any) => t.type === 'blob')
                .map((t: any) => ({ path: t.path, size: t.size })),
              directories: data.tree
                .filter((t: any) => t.type === 'tree')
                .map((t: any) => t.path),
            },
          };
        } catch (err) {
          log.error({ error: (err as Error).message }, 'github_get_repo_structure failed');
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}

// =============================================================================
// Jira MCP Connector
// =============================================================================

/**
 * Create Jira MCP tools for ticket management and backlog queries.
 *
 * Used by BA Agent to check for duplicate requirements and by
 * Dev Agent to understand sprint context.
 */
export function createJiraTools(config: ConnectorConfig): AgentTool[] {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'Authorization': `Basic ${config.apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  return [
    {
      name: 'jira_search_issues',
      description: 'Search Jira issues using JQL. Returns issue keys, summaries, statuses, and assignees.',
      inputSchema: {
        type: 'object',
        properties: {
          jql: { type: 'string', description: 'JQL query (e.g., "project = PROJ AND status = Open")' },
          maxResults: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['jql'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const jql = input.jql as string;
          const maxResults = (input.maxResults as number) || 20;
          const response = await fetch(
            `${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`,
            { headers },
          );
          if (!response.ok) throw new Error(`Jira API ${response.status}: ${await response.text()}`);
          const data = await response.json() as { total: number; issues: any[] };
          return {
            success: true,
            data: {
              total: data.total,
              issues: data.issues.map((issue: any) => ({
                key: issue.key,
                summary: issue.fields?.summary,
                status: issue.fields?.status?.name,
                assignee: issue.fields?.assignee?.displayName,
                priority: issue.fields?.priority?.name,
                issueType: issue.fields?.issuetype?.name,
                created: issue.fields?.created,
              })),
            },
          };
        } catch (err) {
          log.error({ error: (err as Error).message }, 'jira_search_issues failed');
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'jira_get_issue',
      description: 'Get detailed information about a specific Jira issue.',
      inputSchema: {
        type: 'object',
        properties: {
          issueKey: { type: 'string', description: 'Jira issue key (e.g., PROJ-123)' },
        },
        required: ['issueKey'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const issueKey = input.issueKey as string;
          const response = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}`, { headers });
          if (!response.ok) throw new Error(`Jira API ${response.status}: ${await response.text()}`);
          const data = await response.json() as any;
          return {
            success: true,
            data: {
              key: data.key,
              summary: data.fields?.summary,
              description: data.fields?.description,
              status: data.fields?.status?.name,
              assignee: data.fields?.assignee?.displayName,
              priority: data.fields?.priority?.name,
              labels: data.fields?.labels,
              created: data.fields?.created,
              updated: data.fields?.updated,
            },
          };
        } catch (err) {
          log.error({ error: (err as Error).message }, 'jira_get_issue failed');
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'jira_create_issue',
      description: 'Create a new Jira issue in a project.',
      inputSchema: {
        type: 'object',
        properties: {
          projectKey: { type: 'string', description: 'Jira project key (e.g., PROJ)' },
          summary: { type: 'string', description: 'Issue summary/title' },
          description: { type: 'string', description: 'Issue description' },
          issueType: { type: 'string', description: 'Issue type: Story, Task, Bug, Epic' },
          priority: { type: 'string', description: 'Priority: Highest, High, Medium, Low, Lowest' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Labels to add' },
        },
        required: ['projectKey', 'summary', 'issueType'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const body: any = {
            fields: {
              project: { key: input.projectKey },
              summary: input.summary,
              issuetype: { name: input.issueType },
            },
          };
          if (input.description) {
            body.fields.description = {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: input.description as string }] }],
            };
          }
          if (input.priority) body.fields.priority = { name: input.priority };
          if (input.labels) body.fields.labels = input.labels;

          const response = await fetch(`${baseUrl}/rest/api/3/issue`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
          if (!response.ok) throw new Error(`Jira API ${response.status}: ${await response.text()}`);
          const data = await response.json() as { key: string; id: string };
          return { success: true, data: { key: data.key, id: data.id } };
        } catch (err) {
          log.error({ error: (err as Error).message }, 'jira_create_issue failed');
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'jira_get_sprint',
      description: 'Get current active sprint for a board, including issues in the sprint.',
      inputSchema: {
        type: 'object',
        properties: {
          boardId: { type: 'number', description: 'Jira board ID' },
        },
        required: ['boardId'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const boardId = input.boardId as number;
          const response = await fetch(
            `${baseUrl}/rest/agile/1.0/board/${boardId}/sprint?state=active`,
            { headers },
          );
          if (!response.ok) throw new Error(`Jira API ${response.status}: ${await response.text()}`);
          const data = await response.json() as { values: any[] };
          return {
            success: true,
            data: data.values.map((sprint: any) => ({
              id: sprint.id,
              name: sprint.name,
              state: sprint.state,
              startDate: sprint.startDate,
              endDate: sprint.endDate,
              goal: sprint.goal,
            })),
          };
        } catch (err) {
          log.error({ error: (err as Error).message }, 'jira_get_sprint failed');
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}

// =============================================================================
// Confluence MCP Connector
// =============================================================================

/**
 * Create Confluence MCP tools for documentation access.
 *
 * Used during brownfield onboarding to ingest existing architecture
 * decisions, runbooks, and technical documentation.
 */
export function createConfluenceTools(config: ConnectorConfig): AgentTool[] {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'Authorization': `Basic ${config.apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  return [
    {
      name: 'confluence_search',
      description: 'Search Confluence pages using CQL (Confluence Query Language).',
      inputSchema: {
        type: 'object',
        properties: {
          cql: { type: 'string', description: 'CQL query (e.g., "type=page AND space=DEV AND text~architecture")' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['cql'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const cql = input.cql as string;
          const limit = (input.limit as number) || 20;
          const response = await fetch(
            `${baseUrl}/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}`,
            { headers },
          );
          if (!response.ok) throw new Error(`Confluence API ${response.status}: ${await response.text()}`);
          const data = await response.json() as { results: any[] };
          return {
            success: true,
            data: data.results.map((page: any) => ({
              id: page.id,
              title: page.title,
              type: page.type,
              space: page.space?.key,
              url: page._links?.webui,
              lastModified: page.version?.when,
            })),
          };
        } catch (err) {
          log.error({ error: (err as Error).message }, 'confluence_search failed');
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'confluence_get_page',
      description: 'Get the content of a Confluence page by ID.',
      inputSchema: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Confluence page ID' },
        },
        required: ['pageId'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const pageId = input.pageId as string;
          const response = await fetch(
            `${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,version,space`,
            { headers },
          );
          if (!response.ok) throw new Error(`Confluence API ${response.status}: ${await response.text()}`);
          const data = await response.json() as any;
          return {
            success: true,
            data: {
              id: data.id,
              title: data.title,
              space: data.space?.key,
              version: data.version?.number,
              lastModified: data.version?.when,
              body: data.body?.storage?.value,
            },
          };
        } catch (err) {
          log.error({ error: (err as Error).message }, 'confluence_get_page failed');
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'confluence_list_spaces',
      description: 'List all Confluence spaces accessible to the integration.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Space type: global or personal (default: global)' },
        },
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const type = (input.type as string) || 'global';
          const response = await fetch(
            `${baseUrl}/wiki/rest/api/space?type=${type}&limit=50`,
            { headers },
          );
          if (!response.ok) throw new Error(`Confluence API ${response.status}: ${await response.text()}`);
          const data = await response.json() as { results: any[] };
          return {
            success: true,
            data: data.results.map((space: any) => ({
              key: space.key,
              name: space.name,
              type: space.type,
              description: space.description?.plain?.value,
            })),
          };
        } catch (err) {
          log.error({ error: (err as Error).message }, 'confluence_list_spaces failed');
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}

/**
 * Create all brownfield connector tools based on available configurations.
 *
 * @param configs - Array of connector configurations (one per provider)
 * @returns Combined array of all available tools
 */
export function createBrownfieldTools(configs: ConnectorConfig[]): AgentTool[] {
  const tools: AgentTool[] = [];

  for (const config of configs) {
    switch (config.provider) {
      case 'github':
        tools.push(...createGitHubTools(config));
        break;
      case 'jira':
        tools.push(...createJiraTools(config));
        break;
      case 'confluence':
        tools.push(...createConfluenceTools(config));
        break;
      default:
        log.warn({ provider: config.provider }, 'Unknown brownfield connector provider');
    }
  }

  log.info({ connectorCount: configs.length, toolCount: tools.length }, 'Brownfield tools created');
  return tools;
}
