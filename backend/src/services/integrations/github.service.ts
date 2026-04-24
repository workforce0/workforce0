/**
 * =============================================================================
 * GITHUB SERVICE
 * =============================================================================
 *
 * Wraps the Octokit SDK to provide repository operations for the Dev Agent
 * and QA Agent. All operations are scoped to a single repository per call.
 *
 * Capabilities:
 * - Create branches from a base ref
 * - Create or update files on a branch
 * - Create pull requests for human review
 * - Read file content and list directory files
 * - Get PR diff/changed files for QA review
 * - Trigger workflow dispatch (CI) and read check run status
 *
 * @module services/integrations/github
 */

import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'GitHubService' });

export interface GitHubConfig {
  /** Personal access token or GitHub App installation token */
  token: string;
  /** Default repository owner (org or user) */
  defaultOwner?: string;
  /** Default repository name */
  defaultRepo?: string;
}

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface CreateBranchInput {
  owner?: string;
  repo?: string;
  branchName: string;
  /** Base branch or SHA to branch from (default: 'main') */
  fromRef?: string;
}

export interface CreateOrUpdateFileInput {
  owner?: string;
  repo?: string;
  path: string;
  content: string;
  message: string;
  branch: string;
  /** SHA of existing file (required for updates, omit for creates) */
  sha?: string;
}

export interface CreatePullRequestInput {
  owner?: string;
  repo?: string;
  title: string;
  body: string;
  head: string;
  base?: string;
  labels?: string[];
  reviewers?: string[];
}

export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface WorkflowDispatchInput {
  owner?: string;
  repo?: string;
  workflowId: string;
  ref: string;
  inputs?: Record<string, string>;
}

export interface CheckRunStatus {
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
}

/**
 * GitHub integration service using the REST API via fetch.
 *
 * We use raw fetch instead of Octokit to avoid adding a heavy dependency.
 * The GitHub REST API is stable and well-documented.
 */
export class GitHubService {
  private token: string;
  private defaultOwner: string;
  private defaultRepo: string;
  private baseUrl = 'https://api.github.com';

  constructor(config: GitHubConfig) {
    this.token = config.token;
    this.defaultOwner = config.defaultOwner ?? '';
    this.defaultRepo = config.defaultRepo ?? '';

    if (this.token) {
      logger.info('GitHubService initialized', {
        defaultOwner: this.defaultOwner || '(none)',
        defaultRepo: this.defaultRepo || '(none)',
      });
    } else {
      logger.warn('GitHubService initialized without token — all operations will fail');
    }
  }

  /** Whether the service has a valid token configured. */
  isAvailable(): boolean {
    return !!this.token;
  }

  /** Get the default repo owner for job forwarding. */
  getDefaultOwner(): string | undefined {
    return this.defaultOwner || undefined;
  }

  /** Get the default repo name for job forwarding. */
  getDefaultRepo(): string | undefined {
    return this.defaultRepo || undefined;
  }

  // ===========================================================================
  // Branch Operations
  // ===========================================================================

  /**
   * Create a new branch from an existing ref.
   */
  async createBranch(input: CreateBranchInput): Promise<{ ref: string; sha: string }> {
    const { owner, repo } = this.resolveRepo(input);
    const fromRef = input.fromRef ?? 'main';

    // Get the SHA of the base ref
    const refData = await this.request<{ object: { sha: string } }>(
      'GET',
      `/repos/${owner}/${repo}/git/ref/heads/${fromRef}`,
    );

    const sha = refData.object.sha;

    // Create the new branch
    const result = await this.request<{ ref: string; object: { sha: string } }>(
      'POST',
      `/repos/${owner}/${repo}/git/refs`,
      { ref: `refs/heads/${input.branchName}`, sha },
    );

    logger.info('Branch created', { branch: input.branchName, sha, owner, repo });
    return { ref: result.ref, sha: result.object.sha };
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Create or update a single file on a branch.
   */
  async createOrUpdateFile(input: CreateOrUpdateFileInput): Promise<{ sha: string; path: string }> {
    const { owner, repo } = this.resolveRepo(input);

    const body: Record<string, unknown> = {
      message: input.message,
      content: Buffer.from(input.content).toString('base64'),
      branch: input.branch,
    };

    if (input.sha) {
      body.sha = input.sha;
    }

    const result = await this.request<{ content: { sha: string; path: string } }>(
      'PUT',
      `/repos/${owner}/${repo}/contents/${input.path}`,
      body,
    );

    logger.debug('File created/updated', { path: input.path, branch: input.branch });
    return { sha: result.content.sha, path: result.content.path };
  }

  /**
   * Get the content of a file.
   */
  async getFileContent(
    owner: string | undefined,
    repo: string | undefined,
    path: string,
    ref?: string,
  ): Promise<{ content: string; sha: string }> {
    const resolved = this.resolveRepo({ owner, repo });
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';

    const result = await this.request<{ content: string; sha: string; encoding: string }>(
      'GET',
      `/repos/${resolved.owner}/${resolved.repo}/contents/${path}${query}`,
    );

    const content = result.encoding === 'base64'
      ? Buffer.from(result.content, 'base64').toString('utf-8')
      : result.content;

    return { content, sha: result.sha };
  }

  /**
   * List files in a directory.
   */
  async listFiles(
    owner: string | undefined,
    repo: string | undefined,
    path: string,
    ref?: string,
  ): Promise<Array<{ name: string; path: string; type: string; sha: string }>> {
    const resolved = this.resolveRepo({ owner, repo });
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';

    const result = await this.request<Array<{ name: string; path: string; type: string; sha: string }>>(
      'GET',
      `/repos/${resolved.owner}/${resolved.repo}/contents/${path}${query}`,
    );

    return result;
  }

  // ===========================================================================
  // Pull Request Operations
  // ===========================================================================

  /**
   * Create a pull request.
   */
  async createPullRequest(input: CreatePullRequestInput): Promise<{
    number: number;
    htmlUrl: string;
    title: string;
    state: string;
  }> {
    const { owner, repo } = this.resolveRepo(input);

    const body: Record<string, unknown> = {
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base ?? 'main',
    };

    const pr = await this.request<{
      number: number;
      html_url: string;
      title: string;
      state: string;
    }>(
      'POST',
      `/repos/${owner}/${repo}/pulls`,
      body,
    );

    // Add labels if provided
    if (input.labels && input.labels.length > 0) {
      await this.request(
        'POST',
        `/repos/${owner}/${repo}/issues/${pr.number}/labels`,
        { labels: input.labels },
      ).catch(err => {
        logger.warn('Failed to add labels to PR', { prNumber: pr.number, error: (err as Error).message });
      });
    }

    // Request reviewers if provided
    if (input.reviewers && input.reviewers.length > 0) {
      await this.request(
        'POST',
        `/repos/${owner}/${repo}/pulls/${pr.number}/requested_reviewers`,
        { reviewers: input.reviewers },
      ).catch(err => {
        logger.warn('Failed to request reviewers', { prNumber: pr.number, error: (err as Error).message });
      });
    }

    logger.info('Pull request created', { number: pr.number, title: pr.title, owner, repo });
    return {
      number: pr.number,
      htmlUrl: pr.html_url,
      title: pr.title,
      state: pr.state,
    };
  }

  /**
   * Get files changed in a pull request (for QA review).
   */
  async getPRFiles(
    owner: string | undefined,
    repo: string | undefined,
    prNumber: number,
  ): Promise<PRFile[]> {
    const resolved = this.resolveRepo({ owner, repo });

    const files = await this.request<Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }>>(
      'GET',
      `/repos/${resolved.owner}/${resolved.repo}/pulls/${prNumber}/files`,
    );

    return files.map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
  }

  // ===========================================================================
  // CI/CD Operations
  // ===========================================================================

  /**
   * Trigger a GitHub Actions workflow dispatch.
   */
  async triggerWorkflow(input: WorkflowDispatchInput): Promise<void> {
    const { owner, repo } = this.resolveRepo(input);

    await this.request(
      'POST',
      `/repos/${owner}/${repo}/actions/workflows/${input.workflowId}/dispatches`,
      { ref: input.ref, inputs: input.inputs ?? {} },
    );

    logger.info('Workflow dispatched', { workflowId: input.workflowId, ref: input.ref });
  }

  /**
   * Get check runs for a specific commit SHA.
   */
  async getCheckRuns(
    owner: string | undefined,
    repo: string | undefined,
    ref: string,
  ): Promise<CheckRunStatus[]> {
    const resolved = this.resolveRepo({ owner, repo });

    const result = await this.request<{
      total_count: number;
      check_runs: Array<{
        name: string;
        status: string;
        conclusion: string | null;
        html_url: string;
      }>;
    }>(
      'GET',
      `/repos/${resolved.owner}/${resolved.repo}/commits/${ref}/check-runs`,
    );

    return result.check_runs.map(cr => ({
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion,
      htmlUrl: cr.html_url,
    }));
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private resolveRepo(input: { owner?: string; repo?: string }): RepoRef {
    const owner = input.owner || this.defaultOwner;
    const repo = input.repo || this.defaultRepo;

    if (!owner || !repo) {
      throw new Error('GitHub owner and repo are required. Set defaults or pass explicitly.');
    }

    return { owner, repo };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      const error = new Error(`GitHub API ${method} ${path} failed: ${response.status} ${errorBody}`);
      logger.error('GitHub API error', { method, path, status: response.status, error: errorBody });
      throw error;
    }

    // 204 No Content (e.g., workflow dispatch)
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}
