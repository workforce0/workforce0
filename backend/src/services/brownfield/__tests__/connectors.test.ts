// mvp/src/services/brownfield/__tests__/connectors.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createGitHubTools,
  createJiraTools,
  createConfluenceTools,
  createBrownfieldTools,
} from '../connectors.js';

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

function jsonResponse(data: any, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

describe('Brownfield MCP Connectors', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ---- GitHub ----

  describe('GitHub Tools', () => {
    const tools = createGitHubTools({
      provider: 'github',
      baseUrl: 'https://api.github.com',
      apiKey: 'ghp_test123',
    });

    it('should create 5 GitHub tools', () => {
      expect(tools).toHaveLength(5);
      const names = tools.map((t) => t.name);
      expect(names).toContain('github_list_repos');
      expect(names).toContain('github_read_file');
      expect(names).toContain('github_search_code');
      expect(names).toContain('github_list_prs');
      expect(names).toContain('github_get_repo_structure');
    });

    it('should list repos for an organization', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse([
        { name: 'api', full_name: 'org/api', language: 'TypeScript', default_branch: 'main', pushed_at: '2026-03-01', private: false },
      ]));

      const tool = tools.find((t) => t.name === 'github_list_repos')!;
      const result = await tool.execute({ org: 'myorg' }, {} as any);
      expect(result.success).toBe(true);
      expect((result.data as any)[0].name).toBe('api');
    });

    it('should read a file from a repo', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({
        content: Buffer.from('console.log("hello")').toString('base64'),
        encoding: 'base64',
        name: 'index.ts',
        size: 20,
      }));

      const tool = tools.find((t) => t.name === 'github_read_file')!;
      const result = await tool.execute({ owner: 'org', repo: 'api', path: 'src/index.ts' }, {} as any);
      expect(result.success).toBe(true);
      expect((result.data as any).content).toBe('console.log("hello")');
    });

    it('should search code in a repo', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({
        total_count: 1,
        items: [{ name: 'auth.ts', path: 'src/auth.ts', repository: { full_name: 'org/api' } }],
      }));

      const tool = tools.find((t) => t.name === 'github_search_code')!;
      const result = await tool.execute({ query: 'OAuth', repo: 'org/api' }, {} as any);
      expect(result.success).toBe(true);
      expect((result.data as any).totalCount).toBe(1);
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ message: 'Not Found' }, 404));

      const tool = tools.find((t) => t.name === 'github_list_repos')!;
      const result = await tool.execute({ org: 'nonexistent' }, {} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });

    it('should get repo structure', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({
        tree: [
          { path: 'src', type: 'tree' },
          { path: 'src/index.ts', type: 'blob', size: 100 },
          { path: 'package.json', type: 'blob', size: 500 },
        ],
        truncated: false,
      }));

      const tool = tools.find((t) => t.name === 'github_get_repo_structure')!;
      const result = await tool.execute({ owner: 'org', repo: 'api' }, {} as any);
      expect(result.success).toBe(true);
      expect((result.data as any).files).toHaveLength(2);
      expect((result.data as any).directories).toHaveLength(1);
    });
  });

  // ---- Jira ----

  describe('Jira Tools', () => {
    const tools = createJiraTools({
      provider: 'jira',
      baseUrl: 'https://myorg.atlassian.net',
      apiKey: 'base64-encoded-creds',
    });

    it('should create 4 Jira tools', () => {
      expect(tools).toHaveLength(4);
      const names = tools.map((t) => t.name);
      expect(names).toContain('jira_search_issues');
      expect(names).toContain('jira_get_issue');
      expect(names).toContain('jira_create_issue');
      expect(names).toContain('jira_get_sprint');
    });

    it('should search issues with JQL', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({
        total: 1,
        issues: [{
          key: 'PROJ-123',
          fields: {
            summary: 'Fix auth bug',
            status: { name: 'Open' },
            assignee: { displayName: 'Alice' },
            priority: { name: 'High' },
            issuetype: { name: 'Bug' },
            created: '2026-03-01',
          },
        }],
      }));

      const tool = tools.find((t) => t.name === 'jira_search_issues')!;
      const result = await tool.execute({ jql: 'project = PROJ' }, {} as any);
      expect(result.success).toBe(true);
      expect((result.data as any).issues[0].key).toBe('PROJ-123');
    });

    it('should create a new issue', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ key: 'PROJ-124', id: '10001' }));

      const tool = tools.find((t) => t.name === 'jira_create_issue')!;
      const result = await tool.execute({
        projectKey: 'PROJ',
        summary: 'New feature',
        issueType: 'Story',
        priority: 'Medium',
      }, {} as any);
      expect(result.success).toBe(true);
      expect((result.data as any).key).toBe('PROJ-124');
    });

    it('should handle Jira API errors', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ errorMessages: ['Permission denied'] }, 403));

      const tool = tools.find((t) => t.name === 'jira_search_issues')!;
      const result = await tool.execute({ jql: 'project = SECRET' }, {} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('403');
    });
  });

  // ---- Confluence ----

  describe('Confluence Tools', () => {
    const tools = createConfluenceTools({
      provider: 'confluence',
      baseUrl: 'https://myorg.atlassian.net',
      apiKey: 'base64-encoded-creds',
    });

    it('should create 3 Confluence tools', () => {
      expect(tools).toHaveLength(3);
      const names = tools.map((t) => t.name);
      expect(names).toContain('confluence_search');
      expect(names).toContain('confluence_get_page');
      expect(names).toContain('confluence_list_spaces');
    });

    it('should search pages', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({
        results: [{
          id: '12345',
          title: 'Architecture Decision Record',
          type: 'page',
          space: { key: 'DEV' },
          _links: { webui: '/wiki/spaces/DEV/pages/12345' },
          version: { when: '2026-03-01' },
        }],
      }));

      const tool = tools.find((t) => t.name === 'confluence_search')!;
      const result = await tool.execute({ cql: 'type=page AND text~architecture' }, {} as any);
      expect(result.success).toBe(true);
      expect((result.data as any)[0].title).toBe('Architecture Decision Record');
    });

    it('should get page content', async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({
        id: '12345',
        title: 'API Design',
        space: { key: 'DEV' },
        version: { number: 5, when: '2026-03-01' },
        body: { storage: { value: '<h1>API Design</h1><p>REST API architecture...</p>' } },
      }));

      const tool = tools.find((t) => t.name === 'confluence_get_page')!;
      const result = await tool.execute({ pageId: '12345' }, {} as any);
      expect(result.success).toBe(true);
      expect((result.data as any).body).toContain('API Design');
    });
  });

  // ---- Combined ----

  describe('createBrownfieldTools', () => {
    it('should combine tools from multiple connectors', () => {
      const tools = createBrownfieldTools([
        { provider: 'github', baseUrl: 'https://api.github.com', apiKey: 'ghp_test' },
        { provider: 'jira', baseUrl: 'https://org.atlassian.net', apiKey: 'creds' },
        { provider: 'confluence', baseUrl: 'https://org.atlassian.net', apiKey: 'creds' },
      ]);

      // 5 GitHub + 4 Jira + 3 Confluence = 12
      expect(tools).toHaveLength(12);
    });

    it('should create empty tool list for no configs', () => {
      const tools = createBrownfieldTools([]);
      expect(tools).toHaveLength(0);
    });

    it('should skip unknown providers', () => {
      const tools = createBrownfieldTools([
        { provider: 'unknown' as any, baseUrl: 'https://example.com', apiKey: 'key' },
      ]);
      expect(tools).toHaveLength(0);
    });
  });
});
