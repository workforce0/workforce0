/**
 * =============================================================================
 * ROUTES INDEX
 * =============================================================================
 *
 * Central export point for all API routes.
 *
 * Route Registration:
 * -------------------
 * Routes are registered with Fastify using the plugin pattern.
 * Each route module exports an async function that receives the
 * Fastify instance and registers its routes.
 *
 * Route Structure:
 * ----------------
 * ```
 * /api
 * ├── /meetings        → Meeting management
 * │   ├── POST /       → Schedule meeting bot
 * │   ├── GET /        → List meetings
 * │   ├── GET /:id     → Get meeting details
 * │   ├── DELETE /:id  → Cancel meeting
 * │   └── GET /:id/transcript → Get transcript
 * │
 * ├── /agents          → Agent tasks and PRDs
 * │   ├── POST /ba/process → Trigger BA Agent
 * │   ├── GET /tasks   → List tasks
 * │   ├── GET /tasks/:id → Get task
 * │   ├── GET /prds    → List PRDs
 * │   ├── GET /prds/:id → Get PRD
 * │   ├── POST /prds/:id/approve → Approve PRD
 * │   ├── POST /prds/:id/reject → Reject PRD
 * │   ├── POST /prds/:id/tickets → Create tickets
 * │   └── POST /clarifications/:id/respond → Answer question
 * │
 * ├── /engagements     → Engagement lifecycle management
 * │   ├── GET /        → List engagements
 * │   ├── GET /:id     → Get engagement details
 * │   ├── POST /:id/advance → Advance phase
 * │   ├── POST /:id/pause   → Pause engagement
 * │   └── POST /:id/resume  → Resume engagement
 * │
 * ├── /models          → Model configuration
 * │   ├── GET /config    → Get tenant model config
 * │   ├── PUT /config    → Update model assignments
 * │   └── GET /available → List available models
 * │
 * ├── /team            → Team roster management
 * │   ├── GET /        → List team members
 * │   ├── POST /       → Add team member
 * │   ├── PUT /:id     → Update team member
 * │   └── DELETE /:id  → Remove team member
 * │
 * └── /webhooks        → External service callbacks
 *     ├── POST /jira   → Jira events
 *     ├── POST /github → GitHub events
 *     └── GET /health  → Webhook health check
 * ```
 *
 * Authentication:
 * ---------------
 * - /api/* routes require API key authentication
 * - /webhooks/* routes use signature verification
 *
 * @module routes
 */

import { FastifyInstance } from 'fastify';
import { meetingRoutes } from './meetings.routes.js';
import { agentRoutes } from './agents.routes.js';
import { authRoutes, verifyToken } from './auth.routes.js';
import { dashboardRoutes } from './dashboard.routes.js';
import { settingsRoutes } from './settings.routes.js';
import { createWebhookHandler, WebhookDependencies } from './webhooks.routes.js';
import { registerGChatWebhook } from './webhooks/gchat-webhook.handler.js';
import { registerGoogleDriveWebhook } from './webhooks/google-drive.webhook.js';
import { registerSlackEventsWebhook } from './webhooks/slack-events.handler.js';
import { registerEmailReplyWebhook } from './webhooks/email-reply.handler.js';
import { registerTwilioWhatsAppWebhook } from './webhooks/twilio-whatsapp.handler.js';
import { meetingBotRecallWebhookRoutes } from './webhooks/meeting-bot-recall.routes.js';
import { engagementRoutes } from './engagements.routes.js';
import { modelConfigRoutes } from './model-config.routes.js';
import { teamRoutes } from './team.routes.js';
import { auditRoutes } from './audit.routes.js';
import { webhookApiRoutes } from './webhook-api.routes.js';
import { sseRoutes } from './sse.routes.js';
import { notificationRoutes } from './notifications.routes.js';
import { twilioRoutes, twilioWebhookRoutes } from './twilio.routes.js';
import { uploadRoutes } from './upload.routes.js';
import { registerStorageRoutes } from './storage.routes.js';
import { googleIntegrationRoutes } from './google-integration.routes.js';
import { integrationRoutes } from './integrations.routes.js';
import { integrationsStatusRoutes } from './integrations-status.routes.js';
import { setupRoutes as setupWizardRoutes } from './setup.routes.js';
import { skillsRoutes } from './skills.routes.js';
import { cronRoutes } from './cron.routes.js';
import { architectRoutes } from './architect.routes.js';
import { learnedSkillsRoutes } from './learned-skills.routes.js';
import { agentRolesRoutes } from './agent-roles.routes.js';
import { goalsRoutes } from './goals.routes.js';
import { ticketsRoutes } from './tickets.routes.js';
import { agentWebhooksRoutes } from './agent-webhooks.routes.js';
import { projectsRoutes } from './projects.routes.js';
import { libraryRoutes } from './library.routes.js';
import { projectGraphRoutes } from './project-graph.routes.js';
import { agentHubRoutes } from './agent-hub.routes.js';
import { providerRoutes } from './providers.routes.js';
import { createChildLogger } from '../lib/logger.js';
import { config } from '../config/index.js';

const logger = createChildLogger({ module: 'routes' });

/**
 * Register all API routes.
 *
 * @param fastify - Fastify instance
 */
export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  logger.info('Registering API routes');

  // Health check endpoint (no auth required)
  // Verifies database and Redis connections are working
  fastify.get('/health', async (request, reply) => {
    const checks: Record<string, 'connected' | 'disconnected' | 'error'> = {
      database: 'disconnected',
      redis: 'disconnected',
    };

    let healthy = true;

    // Check database connection
    try {
      await fastify.services.prisma.$queryRaw`SELECT 1`;
      checks.database = 'connected';
    } catch (error) {
      healthy = false;
      checks.database = 'error';
      logger.error('Health check: Database connection failed', { error });
    }

    // Check Redis connection
    try {
      const pong = await fastify.services.redis.ping();
      checks.redis = pong === 'PONG' ? 'connected' : 'disconnected';
      if (checks.redis === 'disconnected') healthy = false;
    } catch (error) {
      healthy = false;
      checks.redis = 'error';
      logger.error('Health check: Redis connection failed', { error });
    }

    // Collect AgentHub status
    const agentHubStatus = fastify.services.agentHub
      ? {
          connectedAgents: fastify.services.agentHub.getConnectionCount(),
          pendingJobs: await fastify.services.agentHub.getPendingJobCount(),
        }
      : null;

    const response = {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      uptime: process.uptime(),
      services: { ...checks, agentHub: agentHubStatus },
    };

    return reply.status(healthy ? 200 : 503).send(response);
  });

  // Auth routes (no auth required) - registered at /api/auth
  await fastify.register(
    async (authInstance) => {
      await authInstance.register(authRoutes);
    },
    { prefix: '/api/auth' }
  );

  // Storage routes (no Bearer auth — the URL-embedded JWT token is the auth).
  // Only the local driver installs these handlers; S3 deployments skip them.
  await fastify.register(
    async (storageInstance) => {
      await registerStorageRoutes(storageInstance);
    },
    { prefix: '/api/storage' }
  );

  // API routes with /api prefix
  await fastify.register(
    async (apiInstance) => {
      // Add authentication hook for API routes
      // NOTE: Tenant extraction is handled by tenant middleware in di-container.ts
      // This hook only validates the API key / Bearer token
      apiInstance.addHook('onRequest', async (request, reply) => {
        // Skip auth for OPTIONS requests (CORS preflight)
        if (request.method === 'OPTIONS') return;

        // Check Authorization header first, then fall back to httpOnly cookie
        const apiKey = request.headers['authorization']?.replace('Bearer ', '')
          || (request.cookies as Record<string, string>)?.['wf0_access'];

        if (!apiKey) {
          return reply.status(401).send({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'API key required' },
          });
        }

        // Extract tenant ID from JWT token
        const payload = verifyToken(apiKey);
        if (!payload?.tenantId) {
          return reply.status(401).send({
            success: false,
            error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
          });
        }
        (request as any).tenantId = payload.tenantId;
        (request as any).userId = payload.userId;
        (request as any).userRole = payload.role || 'owner';

        // P1: Project-level isolation — extract project scope from header
        // or ?projectId= query param. List endpoints honor this to filter
        // results. Null means "all projects" (legacy / cross-project views).
        const headerProject = request.headers['x-project-id'];
        const queryProject = (request.query as any)?.projectId;
        const projectId = (typeof headerProject === 'string' && headerProject)
          || (typeof queryProject === 'string' && queryProject)
          || null;
        (request as any).projectId = projectId || null;
      });

      // Register route modules
      await apiInstance.register(meetingRoutes, { prefix: '/meetings' });
      await apiInstance.register(agentRoutes, { prefix: '/agents' });
      await apiInstance.register(dashboardRoutes, { prefix: '/dashboard' });
      await apiInstance.register(settingsRoutes, { prefix: '/settings' });
      await apiInstance.register(engagementRoutes, { prefix: '/engagements' });
      await apiInstance.register(modelConfigRoutes, { prefix: '/models' });
      await apiInstance.register(teamRoutes, { prefix: '/team' });
      await apiInstance.register(notificationRoutes, { prefix: '/notifications' });
      await apiInstance.register(integrationRoutes, { prefix: '/integrations' });
      await apiInstance.register(integrationsStatusRoutes);
      await apiInstance.register(setupWizardRoutes, { prefix: '/setup' });
      await apiInstance.register(skillsRoutes, { prefix: '/skills' });
      await apiInstance.register(cronRoutes, { prefix: '/cron' });
      await apiInstance.register(architectRoutes, { prefix: '/architect' });
      await apiInstance.register(providerRoutes, { prefix: '/providers' });
      await apiInstance.register(auditRoutes, { prefix: '/audit-log' });
      await apiInstance.register(webhookApiRoutes, { prefix: '/webhooks' });
      await apiInstance.register(sseRoutes, { prefix: '/events' });

      // Admin: learned skill kill switch
      await apiInstance.register(learnedSkillsRoutes, { prefix: '/admin/learned-skills' });

      // M1: Agent roles (pluggable agent type registry)
      await apiInstance.register(agentRolesRoutes, { prefix: '/agent-roles' });

      // M2: Goals (company → project → ticket lineage)
      await apiInstance.register(goalsRoutes, { prefix: '/goals' });

      // M4: Tickets (unified role-keyed work items with pull queue)
      await apiInstance.register(ticketsRoutes, { prefix: '/tickets' });

      // N4: Cross-language agent webhooks
      await apiInstance.register(agentWebhooksRoutes, { prefix: '/agent-webhooks' });

      // P1: Project-level isolation (container above meeting/brief/engagement/ticket)
      await apiInstance.register(projectsRoutes, { prefix: '/projects' });

      // M7.3: Skills + subagents library + execution plans (audit-only).
      await apiInstance.register(libraryRoutes, { prefix: '/library' });

      // Per-project AST knowledge graph (credits: safishamsi/graphify).
      await apiInstance.register(projectGraphRoutes, { prefix: '/project-graph' });

      // Agent Hub: token management and job status
      await apiInstance.register(agentHubRoutes, { prefix: '/agents' });

      // Meeting ingestion routes (upload + Google OAuth)
      await apiInstance.register(uploadRoutes);
      await apiInstance.register(googleIntegrationRoutes, { prefix: '/integrations' });

      // Register Twilio voice routes (for dial-in voice bot)
      const { twilioVoiceService } = fastify.services;
      if (twilioVoiceService && config.OPENAI_API_KEY) {
        await apiInstance.register(
          async (voiceInstance) => {
            await twilioRoutes(voiceInstance, {
              twilioVoiceService,
              openaiApiKey: config.OPENAI_API_KEY ?? '',
              meetingRepository: fastify.services.meetingRepository as unknown as import('./twilio.routes.js').TwilioDependencies['meetingRepository'],
              queueService: fastify.services.queueService as unknown as import('./twilio.routes.js').TwilioDependencies['queueService'],
              engagementService: fastify.services.engagementService as unknown as import('./twilio.routes.js').TwilioDependencies['engagementService'],
            });
          },
          { prefix: '/voice' }
        );
      }
    },
    { prefix: '/api' }
  );

  // ==========================================================================
  // Webhook routes (no auth, use signature verification)
  // ==========================================================================
  await fastify.register(
    async (webhookInstance) => {
      const { meetingService, meetingRepository, googleChatService, transcriptBuffer, redis, prdRepository } = fastify.services;

      // Create webhook handler with dependencies
      const webhookDeps: WebhookDependencies = {
        meetingService: {
          handleStatusUpdate: async ({ meetingId, status, metadata }) => {
            await meetingService.handleStatusUpdate({
              meetingId,
              status,
              metadata,
            });
          },
        },
        // Transcript buffer - batches chunks to avoid per-word DB writes
        transcriptBuffer: {
          addChunk: transcriptBuffer.addChunk.bind(transcriptBuffer),
          endMeeting: transcriptBuffer.endMeeting.bind(transcriptBuffer),
        },
        meetingRepository: meetingRepository as unknown as WebhookDependencies['meetingRepository'],
        googleChatService: googleChatService as unknown as WebhookDependencies['googleChatService'],
        logger: logger as unknown as WebhookDependencies['logger'],
        config: {
          jiraWebhookSecret: config.JIRA_WEBHOOK_SECRET,
        },
        redis: redis as unknown as WebhookDependencies['redis'],
        prdRepository: {
          updateTicketStatusByExternalKey: (prdRepository as any).updateTicketStatusByExternalKey?.bind(prdRepository),
        },
        engagementService: fastify.services.engagementService as unknown as WebhookDependencies['engagementService'],
        prisma: fastify.services.prisma as unknown as WebhookDependencies['prisma'],
        // PG.11: GitHub push webhook → auto-refresh project graphs
        // whose cached repoLabel matches this repo.
        projectGraphService: {
          refreshForRepo: fastify.services.projectGraphService.refreshForRepo.bind(
            fastify.services.projectGraphService,
          ),
        },
      };

      const handlers = createWebhookHandler(webhookDeps);

      // Register webhook endpoints
      webhookInstance.post('/jira', handlers.jira as any);
      webhookInstance.post('/github', handlers.github as any);
      webhookInstance.get('/health', handlers.health as any);

      // Register Google Chat webhook (for clarification loop responses)
      await registerGChatWebhook(webhookInstance);

      // Register Google Drive webhook (for auto-detecting Meet recordings)
      await registerGoogleDriveWebhook(webhookInstance);

      // Register Slack Events webhook (for reply-ingested approvals)
      await registerSlackEventsWebhook(webhookInstance);

      // Register inbound-email reply webhook (for email-replied approvals)
      await registerEmailReplyWebhook(webhookInstance);

      // Register inbound WhatsApp/SMS reply-to-approve webhook. Same payload
      // shape as Twilio voice — lives here because it doesn't need the voice
      // service, only ApprovalFanoutService.
      await registerTwilioWhatsAppWebhook(webhookInstance);

      // Step 0: Recall.ai bot-event webhook (HMAC-validated). Mounted at
      // /webhooks/meeting-bot/recall — the parent register prefix is
      // /webhooks, so we add the /meeting-bot segment here.
      await webhookInstance.register(meetingBotRecallWebhookRoutes, { prefix: '/meeting-bot' });

      // Register Twilio webhooks (for voice callback and status)
      const { twilioVoiceService } = fastify.services;
      if (twilioVoiceService && config.OPENAI_API_KEY) {
        await webhookInstance.register(
          async (twilioInstance) => {
            await twilioWebhookRoutes(twilioInstance, {
              twilioVoiceService,
              openaiApiKey: config.OPENAI_API_KEY ?? '',
              meetingRepository: fastify.services.meetingRepository as unknown as import('./twilio.routes.js').TwilioDependencies['meetingRepository'],
              queueService: fastify.services.queueService as unknown as import('./twilio.routes.js').TwilioDependencies['queueService'],
              engagementService: fastify.services.engagementService as unknown as import('./twilio.routes.js').TwilioDependencies['engagementService'],
            });
          },
          { prefix: '/twilio' }
        );
      }
    },
    { prefix: '/webhooks' }
  );

  logger.info('Routes registered successfully');
}

/**
 * Export individual route modules for testing.
 */
export { meetingRoutes } from './meetings.routes.js';
export { agentRoutes } from './agents.routes.js';

/**
 * Alias for registerRoutes (used by main index.ts)
 */
export const setupRoutes = registerRoutes;
