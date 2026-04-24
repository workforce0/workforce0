/**
 * =============================================================================
 * JIRA INTEGRATION SERVICE
 * =============================================================================
 *
 * Integration with Atlassian Jira for ticket creation and management.
 *
 * Why Jira?
 * ---------
 * Jira is the most widely used project management tool in enterprise.
 * Integrating with Jira allows the BA Agent to:
 * - Create tickets directly from PRD requirements
 * - Update tickets as requirements change
 * - Track ticket status back to PRDs
 *
 * API Overview:
 * -------------
 * Uses Jira REST API v3 with OAuth 2.0 or API tokens.
 *
 * - POST /rest/api/3/issue           → Create issue
 * - PUT  /rest/api/3/issue/:key      → Update issue
 * - GET  /rest/api/3/issue/:key      → Get issue details
 * - POST /rest/api/3/issue/bulk      → Create multiple issues
 *
 * Authentication:
 * ---------------
 * 1. API Token (Cloud): email + API token as Basic Auth
 * 2. OAuth 2.0 (Cloud): For user-level actions with consent
 * 3. PAT (Server/DC): Personal Access Token
 *
 * We use API token for server-to-server communication as it's simpler
 * and doesn't require user interaction.
 *
 * Rate Limits:
 * ------------
 * - Cloud: ~100 requests/10 seconds per user
 * - Implement exponential backoff on 429 responses
 *
 * Field Mapping:
 * --------------
 * PRD Requirement → Jira Issue mapping:
 * - title            → summary
 * - description      → description (ADF format)
 * - priority         → priority (mapping required)
 * - type             → issuetype
 * - acceptanceCriteria → custom field or description
 * - estimatedEffort  → story points (custom field)
 *
 * @module services/integrations/jira
 */

import { createChildLogger } from '../../lib/logger.js';
import { AppError } from '../../lib/error-handler.js';

/**
 * Jira connection configuration.
 *
 * Stored per-tenant in the integrations settings.
 */
export interface JiraConfig {
  /** Jira Cloud instance URL (e.g., https://yourcompany.atlassian.net) */
  baseUrl: string;
  /** Email associated with API token */
  email: string;
  /** API token from Atlassian account */
  apiToken: string;
  /** Default project key for ticket creation */
  defaultProjectKey?: string;
  /** Custom field ID for story points */
  storyPointsFieldId?: string;
  /** Custom field ID for acceptance criteria */
  acceptanceCriteriaFieldId?: string;
}

/**
 * Input for creating a Jira issue.
 */
export interface CreateIssueInput {
  /** Project key (e.g., 'PROJ') */
  projectKey: string;
  /** Issue type (Story, Task, Bug, Epic) */
  issueType: string;
  /** Issue summary/title */
  summary: string;
  /** Issue description (will be converted to ADF) */
  description: string;
  /** Priority name (Highest, High, Medium, Low, Lowest) */
  priority?: string;
  /** Labels to add */
  labels?: string[];
  /** Acceptance criteria text */
  acceptanceCriteria?: string;
  /** Story points estimate */
  storyPoints?: number;
  /** Epic link (for Stories/Tasks under an Epic) */
  epicKey?: string;
  /** Assignee account ID */
  assigneeId?: string;
  /** Additional custom fields */
  customFields?: Record<string, unknown>;
}

/**
 * Result from creating a Jira issue.
 */
export interface CreateIssueResult {
  /** Jira issue ID */
  id: string;
  /** Jira issue key (e.g., 'PROJ-123') */
  key: string;
  /** Self URL for the issue */
  self: string;
}

/**
 * Bulk create result.
 */
export interface BulkCreateResult {
  /** Successfully created issues */
  created: CreateIssueResult[];
  /** Failed issues with error messages */
  failed: Array<{ input: CreateIssueInput; error: string }>;
}

/**
 * Jira project info.
 */
export interface JiraProject {
  id: string;
  key: string;
  name: string;
  issueTypes: Array<{ id: string; name: string }>;
}

/**
 * Jira Service for ticket management.
 *
 * @example
 * ```typescript
 * const jira = new JiraService({
 *   baseUrl: 'https://company.atlassian.net',
 *   email: 'bot@company.com',
 *   apiToken: 'xxx',
 * });
 *
 * // Create a single ticket
 * const issue = await jira.createIssue({
 *   projectKey: 'PROJ',
 *   issueType: 'Story',
 *   summary: 'User login feature',
 *   description: 'As a user, I want to login...',
 *   priority: 'High',
 *   storyPoints: 5,
 * });
 *
 * // Create multiple tickets from PRD
 * const results = await jira.bulkCreateIssues([...requirements]);
 * ```
 */
export class JiraService {
  private readonly logger = createChildLogger({ service: 'JiraService' });
  private readonly baseUrl?: string;
  private readonly authHeader?: string;
  private readonly storyPointsFieldId?: string;
  private readonly acceptanceCriteriaFieldId?: string;
  private readonly defaultProjectKey?: string;
  private readonly enabled: boolean;

  /** Request timeout */
  private readonly timeout = 30000;

  /** Priority mapping from our system to Jira */
  private readonly priorityMapping: Record<string, string> = {
    'must-have': 'Highest',
    'should-have': 'High',
    'nice-to-have': 'Medium',
    'future': 'Low',
    // Direct Jira priorities also supported
    'Highest': 'Highest',
    'High': 'High',
    'Medium': 'Medium',
    'Low': 'Low',
    'Lowest': 'Lowest',
  };

  constructor(config: Partial<JiraConfig>) {
    // Check if fully configured
    if (!config.baseUrl || !config.email || !config.apiToken) {
      this.enabled = false;
      this.logger.warn('Jira service disabled - missing configuration');
      return;
    }

    this.enabled = true;

    // Remove trailing slash from base URL
    this.baseUrl = config.baseUrl.replace(/\/$/, '');

    // Create Basic Auth header (email:apiToken base64 encoded)
    const credentials = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;

    this.storyPointsFieldId = config.storyPointsFieldId;
    this.acceptanceCriteriaFieldId = config.acceptanceCriteriaFieldId;
    this.defaultProjectKey = config.defaultProjectKey;

    this.logger.info('Jira service initialized', {
      baseUrl: this.baseUrl,
      hasStoryPointsField: !!this.storyPointsFieldId,
    });
  }

  /** Check if service is enabled */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Create a single Jira issue.
   *
   * @param input - Issue creation input
   * @returns Created issue details
   */
  async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    if (!this.enabled) {
      throw new Error(
        'Jira is not connected. Have an admin open Settings → Integrations → Jira to connect it, then try again.',
      );
    }

    this.logger.info('Creating Jira issue', {
      projectKey: input.projectKey,
      issueType: input.issueType,
      summary: input.summary.substring(0, 50),
    });

    const payload = this.buildIssuePayload(input);
    const response = await this.request<CreateIssueResult>('POST', '/rest/api/3/issue', payload);

    this.logger.info('Jira issue created', {
      key: response.key,
      id: response.id,
    });

    return response;
  }

  /**
   * Create multiple Jira issues in bulk.
   *
   * More efficient than creating one at a time.
   * Handles partial failures gracefully.
   *
   * @param inputs - Array of issue inputs
   * @returns Results with created issues and any failures
   */
  async bulkCreateIssues(inputs: CreateIssueInput[]): Promise<BulkCreateResult> {
    if (!this.enabled) {
      this.logger.warn('Jira service disabled - skipping bulkCreateIssues');
      return { created: [], failed: [] };
    }

    this.logger.info('Bulk creating Jira issues', { count: inputs.length });

    const result: BulkCreateResult = {
      created: [],
      failed: [],
    };

    // Jira bulk API has a limit of 50 issues per request
    const batchSize = 50;
    const batches: CreateIssueInput[][] = [];

    for (let i = 0; i < inputs.length; i += batchSize) {
      batches.push(inputs.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      try {
        const payload = {
          issueUpdates: batch.map((input) => this.buildIssuePayload(input)),
        };

        const response = await this.request<{
          issues: CreateIssueResult[];
          errors: Array<{ failedElementNumber: number; status: number; message: string }>;
        }>('POST', '/rest/api/3/issue/bulk', payload);

        // Add successful issues
        result.created.push(...response.issues);

        // Process any errors
        if (response.errors?.length > 0) {
          for (const error of response.errors) {
            result.failed.push({
              input: batch[error.failedElementNumber],
              error: error.message,
            });
          }
        }

      } catch (error) {
        // If entire batch fails, add all as failures
        for (const input of batch) {
          result.failed.push({
            input,
            error: (error as Error).message,
          });
        }
      }
    }

    this.logger.info('Bulk create completed', {
      created: result.created.length,
      failed: result.failed.length,
    });

    return result;
  }

  /**
   * Update an existing Jira issue.
   *
   * @param issueKey - Jira issue key (e.g., 'PROJ-123')
   * @param updates - Fields to update
   */
  async updateIssue(
    issueKey: string,
    updates: Partial<CreateIssueInput>
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('Jira service disabled - skipping updateIssue');
      return;
    }

    this.logger.info('Updating Jira issue', { issueKey });

    const payload: Record<string, unknown> = { fields: {} };

    if (updates.summary) {
      (payload.fields as Record<string, unknown>).summary = updates.summary;
    }

    if (updates.description) {
      (payload.fields as Record<string, unknown>).description = this.toADF(updates.description);
    }

    if (updates.priority) {
      const jiraPriority = this.priorityMapping[updates.priority] || 'Medium';
      (payload.fields as Record<string, unknown>).priority = { name: jiraPriority };
    }

    if (updates.labels) {
      (payload.fields as Record<string, unknown>).labels = updates.labels;
    }

    if (updates.storyPoints && this.storyPointsFieldId) {
      (payload.fields as Record<string, unknown>)[this.storyPointsFieldId] = updates.storyPoints;
    }

    await this.request<void>('PUT', `/rest/api/3/issue/${issueKey}`, payload);

    this.logger.info('Jira issue updated', { issueKey });
  }

  /**
   * Get issue details.
   *
   * @param issueKey - Jira issue key
   * @returns Issue details
   */
  async getIssue(issueKey: string): Promise<Record<string, unknown>> {
    if (!this.enabled) {
      this.logger.warn('Jira service disabled - skipping getIssue');
      return {};
    }
    return this.request<Record<string, unknown>>('GET', `/rest/api/3/issue/${issueKey}`);
  }

  /**
   * Get available projects.
   *
   * @returns Array of projects
   */
  async getProjects(): Promise<JiraProject[]> {
    if (!this.enabled) {
      this.logger.warn('Jira service disabled - skipping getProjects');
      return [];
    }

    const response = await this.request<Array<{
      id: string;
      key: string;
      name: string;
      issueTypes: Array<{ id: string; name: string }>;
    }>>('GET', '/rest/api/3/project');

    return response;
  }

  /**
   * Test connection to Jira.
   *
   * @returns True if connection successful
   */
  async testConnection(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    try {
      await this.request<unknown>('GET', '/rest/api/3/myself');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add a comment to an issue.
   *
   * @param issueKey - Jira issue key
   * @param comment - Comment text
   */
  async addComment(issueKey: string, comment: string): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('Jira service disabled - skipping addComment');
      return;
    }

    this.logger.info('Adding comment to Jira issue', { issueKey });

    await this.request<void>('POST', `/rest/api/3/issue/${issueKey}/comment`, {
      body: this.toADF(comment),
    });
  }

  /**
   * Build the issue payload for Jira API.
   */
  private buildIssuePayload(input: CreateIssueInput): Record<string, unknown> {
    const projectKey = input.projectKey || this.defaultProjectKey;
    if (!projectKey) {
      throw new AppError('Project key is required', 400, 'VALIDATION_ERROR');
    }

    // Build description with acceptance criteria if provided
    let description = input.description;
    if (input.acceptanceCriteria) {
      description += `\n\n*Acceptance Criteria:*\n${input.acceptanceCriteria}`;
    }

    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      issuetype: { name: input.issueType },
      summary: input.summary,
      description: this.toADF(description),
    };

    // Add priority if specified
    if (input.priority) {
      const jiraPriority = this.priorityMapping[input.priority] || 'Medium';
      fields.priority = { name: jiraPriority };
    }

    // Add labels if specified
    if (input.labels?.length) {
      fields.labels = input.labels;
    }

    // Add story points if field is configured
    if (input.storyPoints && this.storyPointsFieldId) {
      fields[this.storyPointsFieldId] = input.storyPoints;
    }

    // Add acceptance criteria to custom field if configured
    if (input.acceptanceCriteria && this.acceptanceCriteriaFieldId) {
      fields[this.acceptanceCriteriaFieldId] = input.acceptanceCriteria;
    }

    // Add epic link if specified
    if (input.epicKey) {
      // Epic link field varies by Jira version
      fields.parent = { key: input.epicKey };
    }

    // Add assignee if specified
    if (input.assigneeId) {
      fields.assignee = { accountId: input.assigneeId };
    }

    // Add any additional custom fields
    if (input.customFields) {
      Object.assign(fields, input.customFields);
    }

    return { fields };
  }

  /**
   * Convert plain text/markdown to Atlassian Document Format (ADF).
   *
   * Jira Cloud API v3 requires descriptions in ADF format.
   * This is a simple converter that handles basic formatting.
   */
  private toADF(text: string): Record<string, unknown> {
    // Split text into paragraphs
    const paragraphs = text.split(/\n\n+/);

    const content = paragraphs.map((para) => {
      // Check if it's a list (starts with - or *)
      if (para.match(/^[\-\*]\s/m)) {
        const items = para.split(/\n/).map((line) => ({
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: line.replace(/^[\-\*]\s/, '') }],
            },
          ],
        }));

        return {
          type: 'bulletList',
          content: items,
        };
      }

      // Check if it's a heading (starts with *)
      if (para.startsWith('*') && para.endsWith('*')) {
        return {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: para.slice(1, -1),
              marks: [{ type: 'strong' }],
            },
          ],
        };
      }

      // Regular paragraph
      return {
        type: 'paragraph',
        content: [{ type: 'text', text: para }],
      };
    });

    return {
      type: 'doc',
      version: 1,
      content,
    };
  }

  /**
   * Make an authenticated request to Jira API.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': this.authHeader!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error('Jira API error', {
          status: response.status,
          body: errorBody,
        });

        let message = 'Jira API error';
        try {
          const parsed = JSON.parse(errorBody);
          message = parsed.errorMessages?.[0] || parsed.message || message;
        } catch {
          message = errorBody || message;
        }

        throw new AppError(message, response.status, 'JIRA_API_ERROR');
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      return response.json() as T;

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new AppError('Jira request timeout', 504, 'JIRA_TIMEOUT');
      }

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        `Jira request failed: ${(error as Error).message}`,
        502,
        'JIRA_REQUEST_ERROR'
      );
    }
  }
}

/**
 * Factory function to create JiraService from tenant configuration.
 *
 * @param config - Jira configuration from tenant settings
 * @returns Configured JiraService
 */
export function createJiraService(config: JiraConfig): JiraService {
  return new JiraService(config);
}
