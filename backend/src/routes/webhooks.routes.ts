/**
 * =============================================================================
 * WEBHOOKS ROUTES - MVP
 * =============================================================================
 *
 * Webhook endpoints for Jira and GitHub callbacks.
 *
 * Security:
 * ---------
 * All webhooks are verified using HMAC-SHA256 signatures.
 *
 * Processing:
 * -----------
 * 1. Validate signature
 * 2. Acknowledge receipt immediately (200 OK)
 * 3. Process event asynchronously
 *
 * @module mvp/routes/webhooks
 */

import crypto from 'crypto';
import { config as globalConfig } from '../config/index.js';

/**
 * Webhook route dependencies.
 */
export interface WebhookDependencies {
  meetingService: {
    handleStatusUpdate: (params: {
      meetingId: string;
      status: string;
      metadata?: Record<string, unknown>;
    }) => Promise<void>;
  };
  /** Batched transcript buffer - use this instead of per-word DB writes */
  transcriptBuffer: {
    addChunk: (meetingId: string, chunk: {
      speaker?: string;
      text: string;
      startTime: number;
      endTime: number;
      confidence?: number;
    }) => void;
    endMeeting: (meetingId: string) => Promise<void>;
  };
  meetingRepository: {
    findByExternalId: (externalId: string) => Promise<{
      id: string;
      tenantId: string;
      title: string;
      metadata?: Record<string, unknown>;
    } | null>;
    update: (id: string, data: Record<string, unknown>) => Promise<void>;
  };
  googleChatService: {
    sendNotification: (params: {
      tenantId: string;
      type: string;
      title: string;
      message: string;
      metadata?: Record<string, unknown>;
    }) => Promise<void>;
  };
  logger: {
    info: (message: string, data?: Record<string, unknown>) => void;
    debug: (message: string, data?: Record<string, unknown>) => void;
    warn: (message: string, data?: Record<string, unknown>) => void;
    error: (message: string, data?: Record<string, unknown>) => void;
  };
  config: {
    jiraWebhookSecret?: string;
  };
  redis?: {
    hset: (key: string, field: string, value: string) => Promise<number>;
    hget: (key: string, field: string) => Promise<string | null>;
    hgetall: (key: string) => Promise<Record<string, string>>;
    hdel: (key: string, ...fields: string[]) => Promise<number>;
    expire: (key: string, seconds: number) => Promise<number>;
  };
  /** PRD repository for syncing Jira ticket status back to DB */
  prdRepository?: {
    updateTicketStatusByExternalKey: (externalKey: string, status: string) => Promise<void>;
  };
  /** Engagement service for advancing phases on GitHub merge */
  engagementService?: {
    advancePhase: (tenantId: string, engagementId: string, params: {
      confidence?: number;
      output?: unknown;
    }) => Promise<{ id: string; phase: string }>;
  };
  /** Prisma client for looking up engagements by PR data */
  prisma?: {
    engagement: {
      findFirst: (args: { where: Record<string, unknown> }) => Promise<{ id: string; phase: string; tenantId: string } | null>;
    };
  };
  /** PG.11: auto-refresh project graphs on GitHub push events to
   *  the default branch. Optional — webhook keeps working when not
   *  wired (older deploys). */
  projectGraphService?: {
    refreshForRepo: (repoFullName: string) => Promise<{
      matched: number;
      rebuilt: number;
      skipped: number;
      errors: string[];
    }>;
  };
}

/**
 * Verify Jira webhook signature using shared secret (HMAC-SHA256).
 * Jira sends the signature in the x-hub-signature header.
 */
export function verifyJiraSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  try {
    // Jira sends "sha256=<hex>" format
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    const sigHex = signature.replace('sha256=', '');
    return crypto.timingSafeEqual(
      Buffer.from(sigHex),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

/**
 * Create webhook handler for Fastify.
 *
 * Usage with Fastify:
 * ```typescript
 * import { createWebhookHandler } from './routes/webhooks.routes.js';
 *
 * const handler = createWebhookHandler(deps);
 *
 * fastify.post('/webhooks/jira', handler.jira);
 * fastify.post('/webhooks/github', handler.github);
 * fastify.get('/webhooks/health', handler.health);
 * ```
 */
export function createWebhookHandler(deps: WebhookDependencies) {
  const { logger, config } = deps;

  return {
    /**
     * Jira webhook handler.
     */
    jira: async (request: { headers: Record<string, string>; body: unknown; rawBody?: string }, reply: { status: (code: number) => { send: (data: unknown) => void } }) => {
      // Verify Jira webhook signature
      const jiraSecret = config.jiraWebhookSecret;
      if (!jiraSecret) {
        logger.warn('Jira webhook secret not configured - rejecting request. Set JIRA_WEBHOOK_SECRET.');
        return reply.status(401).send({ error: 'Webhook authentication not configured' });
      }

      const signature = request.headers['x-hub-signature'];
      if (!signature || !request.rawBody) {
        logger.warn('Jira webhook missing signature');
        return reply.status(401).send({ error: 'Missing webhook signature' });
      }

      const isValid = verifyJiraSignature(request.rawBody, signature, jiraSecret);
      if (!isValid) {
        logger.warn('Invalid Jira webhook signature');
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      const event = request.body as {
        webhookEvent: string;
        issue?: {
          key: string;
          fields: {
            status: { name: string };
          };
        };
      };

      logger.info('Received Jira webhook', {
        event: event.webhookEvent,
        issueKey: event.issue?.key,
        issueStatus: event.issue?.fields?.status?.name,
      });

      // Sync Jira issue status back to local JiraTicket record
      if (event.webhookEvent === 'jira:issue_updated' && event.issue) {
        const issueKey = event.issue.key;
        const newStatus = event.issue.fields.status.name;

        logger.info('Jira issue status change detected', { issueKey, newStatus });

        if (deps.prdRepository?.updateTicketStatusByExternalKey) {
          try {
            await deps.prdRepository.updateTicketStatusByExternalKey(issueKey, newStatus);
            logger.info('Local ticket status synced from Jira', { issueKey, newStatus });
          } catch (err) {
            logger.error('Failed to sync ticket status from Jira', {
              issueKey,
              newStatus,
              error: (err as Error).message,
            });
          }
        }
      }

      reply.status(200).send({ received: true });
    },

    /**
     * GitHub webhook handler — advances engagement from ship->learn on PR merge.
     */
    github: async (request: { headers: Record<string, string>; body: unknown; rawBody?: string }, reply: { status: (code: number) => { send: (data: unknown) => void } }) => {
      const event = request.headers['x-github-event'];

      // PG.11: push events → refresh project graphs whose cached
      // repoLabel matches the repo. Only rebuild on default-branch
      // pushes to avoid thrashing the graph on every feature branch.
      if (event === 'push') {
        const pushPayload = request.body as {
          ref?: string;
          repository?: { full_name?: string; default_branch?: string };
        };
        const ref = pushPayload?.ref ?? '';
        const repoFullName = pushPayload?.repository?.full_name;
        const defaultBranch = pushPayload?.repository?.default_branch;
        if (!repoFullName || !ref || !defaultBranch) {
          return reply.status(200).send({ received: true, skipped: 'missing_fields' });
        }
        if (ref !== `refs/heads/${defaultBranch}`) {
          return reply.status(200).send({ received: true, skipped: 'not_default_branch' });
        }
        if (deps.projectGraphService) {
          try {
            const result = await deps.projectGraphService.refreshForRepo(repoFullName);
            logger.info('Project graphs refreshed on push', { repoFullName, ...result });
          } catch (err) {
            logger.error('Project graph refresh failed', {
              repoFullName,
              error: (err as Error).message,
            });
          }
        }
        return reply.status(200).send({ received: true, kind: 'push' });
      }

      // Only process pull_request events
      if (event !== 'pull_request') {
        return reply.status(200).send({ received: true, skipped: true });
      }

      const payload = request.body as {
        action: string;
        pull_request: {
          merged: boolean;
          number: number;
          title: string;
          html_url: string;
          head: { ref: string };
          base: { ref: string };
          body?: string;
        };
        repository: { full_name: string };
      };

      // Only handle merged PRs
      if (payload.action !== 'closed' || !payload.pull_request.merged) {
        return reply.status(200).send({ received: true, skipped: true });
      }

      logger.info('GitHub PR merged', {
        pr: payload.pull_request.number,
        title: payload.pull_request.title,
        repo: payload.repository.full_name,
      });

      // Find engagement in 'ship' phase that has this PR in its metadata
      if (deps.prisma && deps.engagementService) {
        try {
          const engagement = await deps.prisma.engagement.findFirst({
            where: {
              phase: 'ship',
              status: 'active',
              output: {
                path: ['prNumber'],
                equals: payload.pull_request.number,
              },
            },
          });

          if (engagement) {
            await deps.engagementService.advancePhase(engagement.tenantId, engagement.id, {
              confidence: 1.0,
              output: {
                mergedPr: payload.pull_request.number,
                prUrl: payload.pull_request.html_url,
                repo: payload.repository.full_name,
                mergedAt: new Date().toISOString(),
              },
            });
            logger.info('Engagement advanced from ship to learn on PR merge', {
              engagementId: engagement.id,
              prNumber: payload.pull_request.number,
            });
          } else {
            logger.debug('No matching engagement found for merged PR', {
              prNumber: payload.pull_request.number,
            });
          }
        } catch (err) {
          logger.error('Failed to advance engagement on PR merge', {
            prNumber: payload.pull_request.number,
            error: (err as Error).message,
          });
        }
      }

      reply.status(200).send({ received: true });
    },

    /**
     * Health check for webhooks.
     */
    health: async (_request: unknown, reply: { send: (data: unknown) => void }) => {
      reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    },
  };
}
