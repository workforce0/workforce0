/**
 * =============================================================================
 * LINEAR INTEGRATION SERVICE
 * =============================================================================
 *
 * Creates Linear issues from approved PRD requirements. Linear is the
 * alternative to Jira for teams that prefer an issue tracker built for the
 * modern product workflow.
 *
 * API Overview
 * ------------
 * Linear uses a single GraphQL endpoint: `POST https://api.linear.app/graphql`
 *
 * We use a small set of operations:
 *   - `query viewer`                    — connection test (who am I?)
 *   - `query teams`                     — list teams the key has access to
 *   - `mutation issueCreate`            — create an issue
 *   - `query users(filter: {email})`    — resolve owner email → Linear user ID
 *   - `query issueLabels(team)`         — list labels for label mapping
 *
 * Authentication
 * --------------
 * Personal API keys (prefix `lin_api_`) sent in the `Authorization` header
 * WITHOUT the `Bearer ` prefix. This is a Linear quirk — see:
 * https://developers.linear.app/docs/graphql/working-with-the-graphql-api/authentication
 *
 * Rate Limits
 * -----------
 * 1,500 requests/hour per key. We don't implement backoff at the service
 * layer — callers (the BA Agent, the route) handle 429 via retries.
 *
 * Field Mapping
 * -------------
 * PRD Requirement → Linear Issue:
 *   title             → title
 *   description       → description (plain markdown; Linear handles it)
 *   priority          → priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)
 *   owner email       → assignee (via users query)
 *   source section    → labels (from label-mapping config)
 *
 * @module services/integrations/linear
 */

import { createChildLogger } from '../../lib/logger.js';
import { AppError } from '../../lib/error-handler.js';

const logger = createChildLogger({ service: 'LinearService' });

const LINEAR_API_URL = 'https://api.linear.app/graphql';

/**
 * Linear connection configuration. Stored encrypted per-tenant in
 * IntegrationConnection rows.
 */
export interface LinearConfig {
  /** Personal API key. Must start with `lin_api_`. */
  apiKey: string;
  /** Default team UUID. Populated after `Connect` succeeds and a team is picked. */
  defaultTeamId?: string;
  /** Brief-section → Linear-label-name mapping. Keys like `risks`, `dependencies`. */
  labelMapping?: Record<string, string>;
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearUser {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

export interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

export interface CreateLinearIssueInput {
  /** Team UUID. Defaults to the connection's defaultTeamId if omitted. */
  teamId?: string;
  title: string;
  /** Markdown. Linear supports a flavoured subset. */
  description?: string;
  /** 0..4 — see Linear priority mapping above. */
  priority?: 0 | 1 | 2 | 3 | 4;
  /** Linear user UUID. */
  assigneeId?: string;
  /** Linear label UUIDs. */
  labelIds?: string[];
}

export interface CreatedLinearIssue {
  id: string;
  identifier: string;        // e.g. "ENG-123"
  title: string;
  url: string;
  state: { name: string };
}

export interface TestResult {
  ok: boolean;
  /** User-facing message. Always populated. */
  message: string;
  /** The Linear user who owns the API key, if reachable. */
  viewer?: { id: string; name: string; email: string };
  /** Raw error code for debugging. */
  code?: string;
}

/**
 * LinearService. Instantiated with optional config — `null`/absent config
 * means "not connected"; every mutation short-circuits with a typed error
 * instead of crashing the backend.
 */
export class LinearService {
  constructor(private readonly config: LinearConfig | null) {}

  /** Fast, never-throwing check. Routes use this to render "Connected" pills. */
  isConfigured(): boolean {
    return this.config !== null && this.config.apiKey.startsWith('lin_api_');
  }

  /** Calls `viewer` to prove the key works. Safe for connection-test flows. */
  async test(): Promise<TestResult> {
    if (!this.config) {
      return { ok: false, message: 'Linear is not connected yet.', code: 'NOT_CONFIGURED' };
    }
    if (!this.config.apiKey.startsWith('lin_api_')) {
      return {
        ok: false,
        message: 'Key does not look like a Linear API key (should start with lin_api_).',
        code: 'INVALID_KEY_FORMAT',
      };
    }
    try {
      const data = await this.gql<{ viewer: { id: string; name: string; email: string } }>(
        `query { viewer { id name email } }`,
      );
      return {
        ok: true,
        message: `Connected as ${data.viewer.name} (${data.viewer.email}).`,
        viewer: data.viewer,
      };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.toLowerCase().includes('auth')) {
        return { ok: false, message: 'Invalid or revoked API key.', code: 'INVALID_AUTH' };
      }
      return { ok: false, message: `Could not reach Linear: ${msg}`, code: 'NETWORK_ERROR' };
    }
  }

  async listTeams(): Promise<LinearTeam[]> {
    this.ensureConfigured();
    const data = await this.gql<{ teams: { nodes: LinearTeam[] } }>(
      `query { teams(first: 50) { nodes { id name key } } }`,
    );
    return data.teams.nodes;
  }

  async listLabels(teamId: string): Promise<LinearLabel[]> {
    this.ensureConfigured();
    const data = await this.gql<{ issueLabels: { nodes: LinearLabel[] } }>(
      `query($teamId: ID!) {
        issueLabels(first: 100, filter: { team: { id: { eq: $teamId } } }) {
          nodes { id name color }
        }
      }`,
      { teamId },
    );
    return data.issueLabels.nodes;
  }

  /**
   * Resolve an owner email to a Linear user UUID.
   * Returns `null` if no active user matches — callers should fall back to
   * creating the issue unassigned.
   */
  async resolveUserByEmail(email: string): Promise<LinearUser | null> {
    this.ensureConfigured();
    if (!email) return null;
    const data = await this.gql<{ users: { nodes: LinearUser[] } }>(
      `query($email: String!) {
        users(first: 1, filter: { email: { eq: $email }, active: { eq: true } }) {
          nodes { id name email active }
        }
      }`,
      { email },
    );
    return data.users.nodes[0] ?? null;
  }

  /**
   * Create a Linear issue. Falls back to the connection's default team
   * when the caller doesn't specify one.
   */
  async createIssue(input: CreateLinearIssueInput): Promise<CreatedLinearIssue> {
    this.ensureConfigured();
    const teamId = input.teamId ?? this.config!.defaultTeamId;
    if (!teamId) {
      throw new AppError('No Linear team selected. Set defaultTeamId or pass teamId.', 400, 'LINEAR_NO_TEAM');
    }

    const data = await this.gql<{
      issueCreate: {
        success: boolean;
        issue: CreatedLinearIssue;
      };
    }>(
      `mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier title url state { name } }
        }
      }`,
      {
        input: {
          teamId,
          title: input.title,
          description: input.description ?? '',
          priority: input.priority ?? 0,
          assigneeId: input.assigneeId,
          labelIds: input.labelIds ?? [],
        },
      },
    );

    if (!data.issueCreate.success) {
      throw new AppError('Linear returned issueCreate.success=false', 502, 'LINEAR_CREATE_FAILED');
    }
    logger.info('Linear issue created', {
      id: data.issueCreate.issue.id,
      identifier: data.issueCreate.issue.identifier,
    });
    return data.issueCreate.issue;
  }

  /**
   * Map PRD requirement priority to Linear's 0..4 scale.
   * 0 none / 1 urgent / 2 high / 3 medium / 4 low.
   */
  static priorityFromPrd(prdPriority: string | undefined): 0 | 1 | 2 | 3 | 4 {
    switch ((prdPriority ?? '').toLowerCase()) {
      case 'critical':
      case 'urgent':
        return 1;
      case 'high':
        return 2;
      case 'medium':
        return 3;
      case 'low':
        return 4;
      default:
        return 0;
    }
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new AppError('Linear is not connected', 400, 'LINEAR_NOT_CONFIGURED');
    }
  }

  /** Minimal GraphQL client. No caching — keys are BYOK and short-lived. */
  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Linear's quirk: personal API keys are sent WITHOUT a "Bearer " prefix.
        Authorization: this.config!.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Linear HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };

    if (json.errors?.length) {
      const first = json.errors[0]!;
      throw new Error(first.message);
    }
    if (!json.data) {
      throw new Error('Linear returned no data and no errors');
    }
    return json.data;
  }
}
