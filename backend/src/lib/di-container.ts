/**
 * =============================================================================
 * DEPENDENCY INJECTION CONTAINER
 * =============================================================================
 *
 * This module sets up dependency injection for the application.
 *
 * Why Dependency Injection?
 * -------------------------
 * 1. Testability: Easy to mock dependencies in tests
 * 2. Loose Coupling: Services don't create their own dependencies
 * 3. Single Source of Truth: All dependencies configured in one place
 * 4. Lifecycle Management: Control when services are created/destroyed
 *
 * How It Works:
 * -------------
 * We use Fastify's decorator pattern to inject services into the app instance.
 * After setup, services are accessible via `fastify.services.*`
 *
 * Dependency Graph:
 * -----------------
 * ```
 * Database (Prisma)
 *     │
 *     ├── MeetingRepository
 *     │       │
 *     │       └── MeetingService
 *     │
 *     ├── TaskRepository
 *     │       │
 *     │       └── BAAgentService
 *     │
 *     └── PRDRepository
 *             │
 *             └── JiraService
 *
 * Redis
 *     │
 *     └── QueueService (BullMQ)
 *             │
 *             └── Used by all services for async processing
 *
 * External APIs
 *     │
 *     ├── GeminiService (AI)
 *     ├── JiraClient (Tickets)
 *     └── GoogleChatService (Notifications)
 * ```
 *
 * @module lib/di-container
 */

import { FastifyInstance } from 'fastify';
import { PrismaClient } from '../../prisma/generated/client/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { Redis } from 'ioredis';
import { createRedisConnection } from './redis.js';
import { config } from '../config/index.js';
import { logger } from './logger.js';

// Repositories
import { MeetingRepository } from '../repositories/meeting.repository.js';
import { TaskRepository } from '../repositories/task.repository.js';
import { PRDRepository } from '../repositories/prd.repository.js';

// Services
import { MeetingService } from '../services/meeting/meeting.service.js';
import { BAAgentService } from '../services/agent/ba-agent.service.js';
import { GeminiService } from '../services/ai/gemini.service.js';
import { OpenAIService } from '../services/ai/openai.service.js';
import { OllamaService } from '../services/ai/ollama.service.js';
import { AICouncil } from '../services/ai/ai-council.js';
import { JiraService } from '../services/integrations/jira.service.js';
import { LinearService } from '../services/integrations/linear.service.js';
import { NotionService } from '../services/integrations/notion.service.js';
import { AgentDispatcherService } from '../services/agent-dispatcher/agent-dispatcher.service.js';
import { ConversationOrchestratorService } from '../services/conversation/conversation-orchestrator.service.js';
import { SkillDistillerService } from '../services/skill-distiller/skill-distiller.service.js';
import { SkillRankingService } from '../services/skill-ranking/skill-ranking.service.js';
import { GoogleChatService } from '../services/integrations/gchat.service.js';
import { GoogleDocsService } from '../services/integrations/gdocs.service.js';
import { QueueService, JobType } from '../services/queue/queue.service.js';
import { createProcessors } from '../services/queue/processors.js';

// Tenant isolation middleware
import { registerTenantMiddleware, wrapRoutesWithTenantContext } from '../middleware/tenant.middleware.js';
import { createTenantAwarePrisma } from '../middleware/prisma-rls.middleware.js';
import { registerRateLimiting } from '../middleware/rate-limit.middleware.js';

// Transcript buffering (batches real-time chunks to avoid per-word DB writes)
import { TranscriptBufferService } from '../services/meeting/transcript-buffer.service.js';

// Twilio Voice (dial-in voice bot)
import { TwilioVoiceService } from '../services/voice/twilio-voice.service.js';

// Engagement lifecycle
import { EngagementService } from '../services/engagement/engagement.service.js';

// Clarification timeout handling
import { ClarificationTimeoutService } from '../services/agent/clarification-timeout.service.js';

// Communication router for multi-channel messaging
import { CommunicationRouter } from '../services/communication/router.js';

// GitHub integration for Dev/QA agents
import { GitHubService } from '../services/integrations/github.service.js';
import { IntegrationConnectionService } from '../services/integrations/integration-connection.service.js';
import { ApprovalFanoutService } from '../services/approval-fanout/approval-fanout.service.js';
import { SkillsService } from '../services/skills/skills.service.js';
import { TrajectoryService } from '../services/trajectory/trajectory.service.js';
import { PromptPipeline } from '../services/agent-runtime/prompt-pipeline.js';
import { SubagentSpawner } from '../services/agent-runtime/subagent-spawner.js';
import { CronSchedulerService } from '../services/cron/cron-scheduler.service.js';
import { MemoryManager } from '../services/memory/memory-provider.js';
import { BuiltinMemoryProvider } from '../services/memory/builtin-memory-provider.js';
import { HonchoMemoryProvider } from '../services/memory/honcho-memory-provider.js';
import { ArchitectService } from '../services/agent/architect.service.js';
import { LiveCaptureService } from '../services/meeting/live-capture.service.js';
import { ModelRegistryService } from '../services/model-registry/model-registry.service.js';
import { HardwareDetectService } from '../services/wizard/hardware-detect.service.js';

/**
 * Build the MemoryManager with the always-on builtin provider + optional
 * Honcho provider (enabled when HONCHO_API_KEY + HONCHO_APP_ID are set).
 */
function buildMemoryManager(prisma: any): MemoryManager {
  const manager = new MemoryManager();
  manager.add(new BuiltinMemoryProvider(prisma));
  // Honcho registration is deferred until config module is available inside
  // the DI scope where this runs — we look it up via process.env as a
  // safe fallback so this helper stays pure. If both vars are set at boot,
  // the provider is added; otherwise skipped.
  const honchoKey = process.env.HONCHO_API_KEY;
  const honchoApp = process.env.HONCHO_APP_ID;
  if (honchoKey && honchoApp) {
    manager.add(
      new HonchoMemoryProvider({
        apiKey: honchoKey,
        appId: honchoApp,
        baseUrl: process.env.HONCHO_BASE_URL,
      }),
    );
  }
  return manager;
}

// Communication channel adapters
import { SlackChannel } from '../services/communication/channels/slack.channel.js';
import { EmailChannel } from '../services/communication/channels/email.channel.js';
import { WhatsAppChannel } from '../services/communication/channels/whatsapp.channel.js';
import { TeamsChannel } from '../services/communication/channels/teams.channel.js';
import { SMSChannel } from '../services/communication/channels/sms.channel.js';
import type { ChannelAdapter } from '../services/communication/types.js';

// Memory Optimizer Agent
import { MemoryOptimizerAgent } from '../services/agents/memory-optimizer/memory-optimizer.agent.js';

// Outcome Observer (learning loop)
import { OutcomeObserver } from '../services/agents/outcome-observer.js';
import { MemoryService } from '../services/memory/memory.service.js';
import { GoogleClient } from '../services/agent-runtime/clients/google-client.js';

// SkillLoader for agent skill injection
import { SkillLoader } from '../services/agents/skills/loader.js';

// AI token & cost metering
import { UsageService } from '../services/usage/usage.service.js';

// Auth services
import { WorkOSService } from '../services/auth/workos.service.js';

// Audit logging
import { AuditService } from '../services/audit/audit.service.js';

// Outgoing webhooks
import { WebhookService } from '../services/webhook/webhook.service.js';

// Meeting audio storage (local filesystem by default, S3 opt-in)
import { createStorageService, type StorageService } from '../services/storage/index.js';

// PII / secret redaction for prompts and logs (used inline in the BA
// agent's `redact` hook below — must be a real ES import, not require()).
import { redact as redactSecrets } from '../services/model-registry/redact.js';

// M1: Pluggable agent role registry.
import { AgentRoleService } from '../services/agent-role/agent-role.service.js';

// M2: Goal ancestry — every agent call knows the "why".
import { GoalService } from '../services/goal/goal.service.js';

// M4: Ticket unification — role-keyed pull queue.
import { TicketService } from '../services/ticket/ticket.service.js';

// N4: Cross-language agents — POST ticket.ready to registered webhooks.
import { AgentWebhookService } from '../services/agent-webhook/agent-webhook.service.js';

// P1: Project-level isolation — user-visible entities are scoped per project.
import { ProjectService } from '../services/project/project.service.js';

// Project graph — per-project AST knowledge graph (inspired by
// safishamsi/graphify; native TS reimplementation).
import { ProjectGraphService } from '../services/project-graph/project-graph.service.js';
import { PRDSymbolLinker } from '../services/project-graph/prd-symbol-linker.js';

// M7: Skills + subagents library (vendored from anthropics/skills and
// VoltAgent/awesome-claude-code-subagents). chief_of_staff planner
// queries this on every ticket decomposition.
import { LibraryService } from '../services/library/library.service.js';

// M7.2: Chief-of-staff orchestration — plans tickets, posts to comms,
// replans on failure, escalates to the user via their preferred channel.
import { ChiefOfStaffService } from '../services/chief-of-staff/chief-of-staff.service.js';
import { LLMPlanner } from '../services/chief-of-staff/planner-llm.js';

// M7.5: Escalation reply handling (RETRY / PAUSE / CANCEL).
import { EscalationService } from '../services/escalation/escalation.service.js';

// Transcription (OpenAI Whisper API)
import { TranscriptionService } from '../services/transcription/transcription.service.js';
import { DomainPromptBuilder } from '../services/transcription/domain-prompt.js';

// STT (provider-agnostic speech-to-text — routes to local Whisper / OpenAI / …)
import {
  STTProviderRouter,
  LocalWhisperProvider,
  OpenAIWhisperProvider,
  type STTProviderId,
} from '../services/stt/index.js';

// Google OAuth (per-user Google Meet integration)
import { GoogleOAuthService } from '../services/integrations/google-oauth.service.js';

// SSE real-time updates
import { SSEService } from '../services/sse/sse.service.js';

// AgentHub (WebSocket agent connections)
import { AgentJobQueue } from '../services/agent-hub/job-queue.js';
import { AgentHub } from '../services/agent-hub/agent-hub.service.js';

// Meeting bot abstraction (Step 0 — §6 + §7)
import {
  MeetingBotRouter,
  ManualProvider,
  RecallProvider,
  VexaProvider,
} from '../services/meeting-bot/index.js';

/**
 * Interface defining all available services.
 *
 * This interface is used to:
 * 1. Provide type safety when accessing services
 * 2. Document all available services in one place
 * 3. Enable IDE autocompletion
 */
export interface Services {
  // Database client
  prisma: PrismaClient;

  // Cache client
  redis: Redis;

  // Repositories (data access layer)
  meetingRepository: MeetingRepository;
  taskRepository: TaskRepository;
  prdRepository: PRDRepository;

  // Core services (business logic layer)
  meetingService: MeetingService;
  baAgentService: BAAgentService;
  queueService: QueueService;

  // AI services
  geminiService: GeminiService;
  openaiService: OpenAIService;
  /** Local LLM provider (Ollama). Stays disabled when OLLAMA_BASE_URL is
   *  unset; the AI Council fallback chain skips it via isAvailable(). */
  ollamaService: OllamaService;
  aiCouncil: AICouncil;

  // Integration services
  jiraService: JiraService;
  googleChatService: GoogleChatService;
  googleDocsService: GoogleDocsService;

  // Generic BYOK credential vault for in-app integration wizards
  integrationConnectionService: IntegrationConnectionService;

  // Approval fan-out (reaches approvers on their preferred channel)
  approvalFanoutService: ApprovalFanoutService;

  // Agent dispatcher — @mention routing for inbound chat (WhatsApp / Slack)
  agentDispatcherService: AgentDispatcherService;

  // Tier 3b — multi-agent conversation orchestrator (persistent threads,
  // runaway-loop guard, rate limit, LLM-backed replies with persona)
  conversationOrchestratorService: ConversationOrchestratorService;

  // Hermes self-learning: clusters approved trajectories and proposes
  // reusable skills for admin review.
  skillDistillerService: SkillDistillerService;

  // Outcome-based reinforcement: nudges learned-skill confidence up/down
  // based on the target agent's recent approval rate.
  skillRankingService: SkillRankingService;

  // Skills (Hermes-inspired user-message injection playbooks)
  skillsService: SkillsService;

  // Trajectory (per-turn telemetry for skill distillation + replay)
  trajectoryService: TrajectoryService;

  // Prompt pipeline (redaction + prompt caching + trajectory wrapper for ModelClient)
  promptPipeline: PromptPipeline;

  // Subagent spawner (parent agents fan out isolated child work)
  subagentSpawner: SubagentSpawner;

  // Cron scheduler (user-facing recurring jobs)
  cronSchedulerService: CronSchedulerService;

  // Memory manager (builtin + optional external provider e.g. Honcho)
  memoryManager: MemoryManager;

  // Architect agent (design step between BA approval and Dev implementation)
  architectService: ArchitectService;

  // Live meeting capture (browser mic / tab audio → BA pipeline)
  liveCaptureService: LiveCaptureService;

  // Model registry — per-tenant provider credential + model config storage
  modelRegistry: ModelRegistryService;

  // Twilio Voice (dial-in voice bot)
  twilioVoiceService: TwilioVoiceService | null;  // null if Twilio not configured

  // Transcript buffering (batches real-time chunks)
  transcriptBuffer: TranscriptBufferService;

  // Engagement lifecycle management
  engagementService: EngagementService;

  // Clarification timeout handling
  clarificationTimeoutService: ClarificationTimeoutService;

  // Communication router (multi-channel messaging)
  communicationRouter: CommunicationRouter;

  // Direct email sender (used for transactional emails: password reset, etc.)
  emailChannel: EmailChannel;

  // GitHub integration (for Dev Agent + QA Agent)
  githubService: GitHubService | null;  // null if GITHUB_TOKEN not configured

  // AI token & cost metering
  usageService: UsageService;

  // M1: Pluggable agent role registry (was a hardcoded enum before).
  agentRoleService: AgentRoleService;

  // M2: Goal service (company → project → ticket lineage).
  goalService: GoalService;

  // M4: Ticket service (role-keyed pull queue).
  ticketService: TicketService;

  // N4: Webhook fan-out for cross-language agents.
  agentWebhookService: AgentWebhookService;

  // P1: Project service (project-level isolation).
  projectService: ProjectService;

  // Per-project AST knowledge graph for agent context (credits to
  // safishamsi/graphify in the README).
  projectGraphService: ProjectGraphService;

  // PG.8: links a completed PRD back to project-graph symbols via
  // one structured LLM call after brief finalization.
  prdSymbolLinker: PRDSymbolLinker;

  // M7: Skills + subagents library.
  libraryService: LibraryService;

  // M7.2: Chief-of-staff orchestrator (planner + channel broadcaster).
  chiefOfStaffService: ChiefOfStaffService;

  // M7.5: Escalation reply handling.
  escalationService: EscalationService;

  // Auth services
  workosService: WorkOSService | null;  // null if WorkOS not configured

  // Audit logging
  auditService: AuditService;

  // Outgoing webhooks
  webhookService: WebhookService;
  sseService: SSEService;

  // Meeting ingestion services
  storageService: StorageService;                   // Local filesystem by default; S3 when AWS_S3_BUCKET set
  transcriptionService: TranscriptionService | null; // null if no STT provider is configured (no OpenAI key + no local Whisper)
  /** Provider-agnostic STT router (Plan 2). Wraps local Whisper + OpenAI
   *  Whisper. Always set, even when no providers are configured — the
   *  wizard's status indicator polls this in Plan 3. */
  sttRouter: STTProviderRouter;
  /** PG.7: builds domain-aware Whisper prompts from tenant corpus
   *  (god nodes + skills + recent PRD titles). Credit:
   *  safishamsi/graphify. */
  domainPromptBuilder: DomainPromptBuilder;
  googleOAuthService: GoogleOAuthService | null;    // null if Google OAuth not configured

  // AgentHub (WebSocket agent connections + job queue)
  agentJobQueue: AgentJobQueue;
  agentHub: AgentHub;

  // Meeting bot router (live-capture provider abstraction —
  // resolves vexa | recall | manual per tenant at request time).
  meetingBotRouter: MeetingBotRouter;
  /** Shared with the Recall webhook route for HMAC verification. */
  recallWebhookSecret: string | undefined;

  /** Validated env-derived config — exposed so routes (e.g.
   *  /api/integrations/status) can probe feature URLs without
   *  re-importing the config module. */
  config: typeof config;

  /** Step 0 wizard: detects host RAM/CPU and recommends a local-LLM tier. */
  hardwareDetectService: HardwareDetectService;
}

/**
 * Extend Fastify's type definitions to include our services.
 *
 * This allows TypeScript to know about `fastify.services` throughout the app.
 */
declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}

/**
 * Sets up all dependencies and registers them with Fastify.
 *
 * This function:
 * 1. Creates database and cache connections
 * 2. Instantiates repositories with database client
 * 3. Instantiates services with their dependencies
 * 4. Registers everything on the Fastify instance
 *
 * Order matters! Dependencies must be created before dependents.
 *
 * @param app - Fastify instance to register services on
 *
 * @example
 * ```typescript
 * const app = Fastify();
 * await setupDependencies(app);
 *
 * // Now services are available
 * const meetings = await app.services.meetingService.getAll();
 * ```
 */
export async function setupDependencies(app: FastifyInstance): Promise<void> {
  logger.info('Setting up dependency injection container...');

  // ==========================================================================
  // STEP 1: Create database connection (Prisma 7 with pg adapter)
  // ==========================================================================
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
  });

  const adapter = new PrismaPg(pool);

  const prisma = new PrismaClient({
    adapter,
    log: config.NODE_ENV === 'development'
      ? ['query', 'info', 'warn', 'error']
      : ['error'],
  });

  // Test database connection
  try {
    await pool.query('SELECT 1');
    logger.info('✅ Database connection established');
  } catch (error) {
    logger.fatal('❌ Failed to connect to database', { error });
    throw error;
  }

  // Apply Row-Level Security via Prisma client extensions ($extends)
  // This ensures all queries on tenant-scoped models are automatically filtered by tenantId
  // The extended client wraps the base client - reassign to use it everywhere
  const rlsPrisma = createTenantAwarePrisma(prisma, {
    requireTenantContext: false, // Allow queries without tenant context (webhooks, system tasks)
    debug: config.NODE_ENV === 'development',
  });
  logger.info('✅ RLS middleware applied via Prisma client extensions');

  // M1 + M2 services — created early because downstream constructors
  // (BAAgentService in particular) reference them via callbacks.
  // agentRoleService also runs its idempotent built-in seed here.
  const agentRoleService = new AgentRoleService(rlsPrisma);
  await agentRoleService.seedBuiltins().catch((err) => {
    logger.error('Failed to seed agent roles (non-fatal)', { error: (err as Error).message });
  });
  const goalService = new GoalService(rlsPrisma);
  const ticketService = new TicketService(rlsPrisma);
  // Constructor subscribes to ticketService.events — fan-out happens
  // automatically on every ticket.ready from here on.
  const agentWebhookService = new AgentWebhookService(rlsPrisma, ticketService);
  const projectService = new ProjectService(rlsPrisma);
  const projectGraphService = new ProjectGraphService(rlsPrisma);
  const prdSymbolLinker = new PRDSymbolLinker({
    prisma: rlsPrisma,
    modelRegistry: new ModelRegistryService(rlsPrisma),
  });
  // M7: vendor library — seeding happens async on boot, non-fatal.
  const libraryService = new LibraryService(rlsPrisma);
  libraryService.seedFromVendor().catch((err) => {
    logger.error('Library seed failed (non-fatal)', { error: (err as Error).message });
  });

  // ==========================================================================
  // STEP 2: Create Redis connections
  // ==========================================================================
  // Main Redis connection for general caching (supports Sentinel HA via REDIS_SENTINEL_HOSTS)
  const redis = createRedisConnection(config, { name: 'main' });

  redis.on('connect', () => logger.info('✅ Redis connection established'));
  redis.on('error', (err) => logger.error('Redis error', { error: err }));

  // Separate Redis connection for BullMQ (requires maxRetriesPerRequest: null)
  const bullmqRedis = createRedisConnection(config, { name: 'bullmq', maxRetriesPerRequest: null });

  bullmqRedis.on('connect', () => logger.info('✅ BullMQ Redis connection established'));
  bullmqRedis.on('error', (err) => logger.error('BullMQ Redis error', { error: err }));

  // ==========================================================================
  // STEP 3: Create repositories (data access layer)
  // ==========================================================================
  const meetingRepository = new MeetingRepository(rlsPrisma);
  const taskRepository = new TaskRepository(rlsPrisma);
  const prdRepository = new PRDRepository(rlsPrisma);

  // Transcript buffer - batches real-time chunks to avoid per-word DB writes
  const transcriptBuffer = new TranscriptBufferService(meetingRepository, {
    maxChunks: 50,           // Flush every 50 chunks
    flushIntervalMs: 5000,   // Or every 5 seconds
    maxStoredChunks: 100,    // Keep last 100 in DB metadata
  });

  logger.debug('Repositories initialized');

  // ==========================================================================
  // STEP 4: Create external service clients
  // ==========================================================================
  const geminiService = new GeminiService(config.GEMINI_API_KEY);
  const openaiService = new OpenAIService(config.OPENAI_API_KEY);

  // Local LLM provider (Ollama). Disabled until OLLAMA_BASE_URL is set
  // (the `local-llm` Compose profile defaults it to http://ollama:11434).
  // Plan 2: pre-warms the small extraction tier so the first real call
  // doesn't pay cold-load latency. warmModel() logs and swallows when no
  // model is pulled yet, so this is safe on a fresh install.
  const ollamaService = new OllamaService({
    baseUrl: config.OLLAMA_BASE_URL,
    keepAlive: config.OLLAMA_KEEP_ALIVE,
  });
  if (ollamaService.isEnabled()) {
    void ollamaService.warmModel('qwen3.5:8b');
    logger.info('OllamaService enabled (warming qwen3.5:8b)', {
      baseUrl: config.OLLAMA_BASE_URL,
    });
  } else {
    logger.warn('OllamaService disabled (no OLLAMA_BASE_URL set)');
  }

  const aiCouncil = new AICouncil(geminiService, openaiService);

  const jiraService = new JiraService({
    baseUrl: config.JIRA_BASE_URL,
    email: config.JIRA_EMAIL,
    apiToken: config.JIRA_API_TOKEN,
  });

  // Generic BYOK credential vault — used by the in-app integration wizards.
  // Prefers ENCRYPTION_KEY if set; falls back to deriving a key from JWT_SECRET.
  const integrationConnectionService = new IntegrationConnectionService(
    rlsPrisma,
    config.ENCRYPTION_KEY ?? config.JWT_SECRET,
  );

  // Register per-integration testers. Wizards call these on /connect and /test.
  integrationConnectionService.registerTester('jira', async (creds) => {
    try {
      const baseUrl = String(creds.baseUrl ?? '').trim();
      const email = String(creds.email ?? '').trim();
      const apiToken = String(creds.apiToken ?? '').trim();
      if (!baseUrl || !email || !apiToken) {
        return { ok: false, error: 'Jira URL, email, and API token are all required.' };
      }
      const normalizedUrl = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;
      const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
      const res = await fetch(`${normalizedUrl}/rest/api/3/myself`, {
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        return {
          ok: false,
          error:
            res.status === 401
              ? "That token didn't work. Make sure you pasted the full token and your email matches the one you log in to Jira with."
              : `Jira replied ${res.status}. Double-check your Jira address.`,
        };
      }
      const profile = (await res.json()) as { emailAddress?: string; displayName?: string };
      return {
        ok: true,
        metadata: {
          connectedEmail: profile.emailAddress ?? email,
          connectedName: profile.displayName ?? '',
          baseUrl: normalizedUrl,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `We couldn't reach that Jira address. Check for typos — it should look like yourcompany.atlassian.net.`,
      };
    }
  });

  // Linear: BYOK personal API key (prefix lin_api_). We call the viewer
  // query to verify the key and surface the connected user back to the UI.
  integrationConnectionService.registerTester('linear', async (creds) => {
    const apiKey = String(creds.apiKey ?? '').trim();
    if (!apiKey) return { ok: false, error: 'Paste your Linear API key first.' };
    if (!apiKey.startsWith('lin_api_')) {
      return {
        ok: false,
        error: 'That key does not look like a Linear personal API key (should start with lin_api_).',
      };
    }
    const svc = new LinearService({ apiKey });
    const result = await svc.test();
    if (!result.ok) {
      return { ok: false, error: result.message };
    }
    // Pull teams on successful connect so the UI can show the team picker.
    try {
      const teams = await svc.listTeams();
      return {
        ok: true,
        metadata: {
          connectedEmail: result.viewer?.email ?? '',
          connectedName: result.viewer?.name ?? '',
          teams: teams.map((t) => ({ id: t.id, name: t.name, key: t.key })),
        },
      };
    } catch (err) {
      // Key works but teams fetch failed — still surface a partial success.
      return {
        ok: true,
        metadata: {
          connectedEmail: result.viewer?.email ?? '',
          connectedName: result.viewer?.name ?? '',
          teams: [],
          warning: 'Connected, but could not load teams. Retry Refresh Teams in a minute.',
        },
      };
    }
  });

  // Notion: internal integration token (Bearer). We verify the token, then
  // opportunistically list accessible targets so the wizard can show the
  // target picker in one round-trip. Token prefix must be `secret_` or `ntn_`.
  integrationConnectionService.registerTester('notion', async (creds) => {
    const apiKey = String(creds.apiKey ?? '').trim();
    if (!apiKey) return { ok: false, error: 'Paste your Notion integration secret first.' };
    const svc = new NotionService({ apiKey });
    if (!svc.isConfigured()) {
      return {
        ok: false,
        error: 'That does not look like a Notion integration secret (should start with secret_ or ntn_).',
      };
    }
    const result = await svc.test();
    if (!result.ok) {
      return { ok: false, error: result.message };
    }
    return {
      ok: true,
      metadata: {
        connectedName: result.viewer?.name ?? '',
        workspaceName: result.viewer?.workspaceName ?? '',
        targets: (result.targets ?? []).map((t) => ({
          id: t.id,
          title: t.title,
          type: t.type,
          isDatabase: t.isDatabase,
        })),
        // Surface the "no shared targets yet" hint so the UI can show a
        // helpful next-step instead of a silent empty picker.
        needsSharedTarget: (result.targets ?? []).length === 0,
      },
    };
  });

  const googleChatService = new GoogleChatService({
    webhookUrl: config.GCHAT_WEBHOOK_URL,
  });

  // Google Docs service for PRD export
  const googleDocsCredentials = config.GOOGLE_SERVICE_ACCOUNT_KEY
    ? JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_KEY)
    : undefined;

  const googleDocsService = new GoogleDocsService({
    credentials: googleDocsCredentials,
    defaultFolderId: config.GOOGLE_DRIVE_FOLDER_ID,
  });

  if (!googleDocsService.isAvailable()) {
    logger.warn('GoogleDocsService disabled (no credentials configured)');
  } else {
    logger.info('GoogleDocsService available for PRD export');
  }

  logger.debug('External service clients initialized');
  logger.info(`AI Council status: ${JSON.stringify(aiCouncil.getStatus())}`);

  // ==========================================================================
  // STEP 5: Create queue service (for async job processing)
  // ==========================================================================
  const queueService = new QueueService({ redis: bullmqRedis });

  // Wire Prisma so the DLQ can create in-app notifications for tenants
  queueService.setPrisma(rlsPrisma as any);

  logger.debug('Queue service initialized');

  // ==========================================================================
  // STEP 6: Create core business services
  // ==========================================================================
  const meetingService = new MeetingService(
    meetingRepository,
    rlsPrisma,
    queueService as unknown as { addJob: (jobType: unknown, data: unknown, options?: { priority?: number; delay?: number }) => Promise<string> }
  );

  // Hermes III services — build once, reuse everywhere. MUST exist before
  // BAAgentService construction so the production BA flow gets wired.
  const trajectoryService = new TrajectoryService(rlsPrisma);
  const promptPipeline = new PromptPipeline({
    redact: true,
    anthropicCache: true,
    trajectory: trajectoryService,
  });
  const memoryManager = buildMemoryManager(rlsPrisma);

  // BAAgentService uses positional arguments. Hermes III wiring via the
  // trailing options arg makes the production BA flow redact transcripts,
  // prefetch memory, and record trajectory events on every run.
  const baAgentService = new BAAgentService(
    taskRepository,
    prdRepository,
    meetingRepository,
    geminiService,
    jiraService,
    googleChatService,
    aiCouncil,
    googleDocsService,
    prisma,
    {},
    {
      redact: (text: string) => redactSecrets(text).redacted,
      memory: memoryManager,
      trajectory: {
        record: async (event: Record<string, unknown>) => {
          // Adapter: BAAgentService uses a loose Record shape; TrajectoryService
          // expects a typed TrajectoryEvent. Cast through unknown with required
          // field defaults.
          await trajectoryService.record({
            tenantId: String(event.tenantId ?? ''),
            sessionId: String(event.sessionId ?? ''),
            agentName: String(event.agentName ?? 'ba'),
            type: (event.type as any) ?? 'turn_completed',
            payload: (event.payload as Record<string, unknown>) ?? {},
          });
        },
      },
      // M2: Resolve the engagement's goal → short text block the BA
      // prepends to every prompt. Falls back to an empty string when
      // no goal is wired, which keeps legacy (no-goal) flows unchanged.
      goalContext: async (tenantId: string, meetingId: string) => {
        try {
          const engagement = await (rlsPrisma as any).engagement.findFirst({
            where: { tenantId, meetingId },
            select: { id: true, goalId: true, title: true, meetingId: true },
          });
          if (!engagement) return '';
          const goal = await goalService.ensureForEngagement(tenantId, engagement);
          if (!goal) return '';
          return GoalService.renderContextBlock(goal);
        } catch (err) {
          logger.warn('goalContext lookup failed', { error: (err as Error).message });
          return '';
        }
      },
      // M3: Per-role monthly budget gate for the BA role. BA refuses to
      // start processing when its monthly cap is exhausted and writes a
      // user-facing error to the task row.
      budgetGate: (tenantId: string) =>
        usageService.isOverRoleMonthlyBudget(tenantId, 'ba_agent'),
    }
  );

  logger.debug('Business services initialized');

  // ==========================================================================
  // STEP 6.6: Create Twilio Voice service (for dial-in voice bot)
  // ==========================================================================
  const twilioVoiceService = (
    config.TWILIO_ACCOUNT_SID &&
    config.TWILIO_AUTH_TOKEN &&
    config.TWILIO_PHONE_NUMBER &&
    config.WEBHOOK_BASE_URL
  )
    ? new TwilioVoiceService({
        accountSid: config.TWILIO_ACCOUNT_SID,
        authToken: config.TWILIO_AUTH_TOKEN,
        phoneNumber: config.TWILIO_PHONE_NUMBER,
        webhookBaseUrl: config.WEBHOOK_BASE_URL,
        redis,
      })
    : null;

  if (!twilioVoiceService) {
    logger.warn('TwilioVoiceService disabled (Twilio credentials or WEBHOOK_BASE_URL not configured)');
  } else {
    // Reconcile any calls that were active before a server restart
    await twilioVoiceService.reconcileOnStartup();
    logger.info('TwilioVoiceService enabled for dial-in voice bot');
  }

  // ==========================================================================
  // STEP 6.7: Create engagement service (lifecycle state machine)
  // ==========================================================================
  const engagementService = new EngagementService(rlsPrisma);
  // Wire queue service for auto-dispatching agents on phase transitions
  engagementService.setQueueService(queueService as any);
  logger.info('EngagementService initialized with queue dispatch');

  // ==========================================================================
  // STEP 6.8: Create GitHub service (optional — only if token configured)
  // ==========================================================================
  const githubService = config.GITHUB_TOKEN
    ? new GitHubService({
        token: config.GITHUB_TOKEN,
        defaultOwner: config.GITHUB_DEFAULT_OWNER,
        defaultRepo: config.GITHUB_DEFAULT_REPO,
      })
    : null;

  if (!githubService) {
    logger.warn('GitHubService disabled (no GITHUB_TOKEN configured)');
  } else {
    logger.info('GitHubService available for Dev/QA agents');
  }

  // ==========================================================================
  // STEP 6.85: Create memory service and optimizer agent
  // ==========================================================================
  const memoryService = new MemoryService(rlsPrisma, redis);
  logger.info('MemoryService initialized (hot: Redis, warm: PostgreSQL)');

  // SkillLoader for agent skill injection (foundation + learned skills)
  const skillLoader = new SkillLoader(rlsPrisma, redis);
  logger.info('SkillLoader initialized for agent skill injection');

  // ==========================================================================
  // STEP 6.86: Create usage service (AI token & cost metering)
  // ==========================================================================
  const usageService = new UsageService(rlsPrisma);

  // M1: Seed built-in agent roles on boot. Idempotent, safe across restarts.
  // AgentRoleService is the single source of truth for agent types going
  // forward — processors, orchestrator, and UI all resolve via .resolve(slug).
  // (agentRoleService + goalService constructed earlier — see STEP 1 block.)
  logger.info('UsageService initialized for AI token & cost metering');

  // ==========================================================================
  // STEP 6.87: Create WorkOS SSO service
  // ==========================================================================
  const workosService = (config.WORKOS_API_KEY && config.WORKOS_CLIENT_ID)
    ? new WorkOSService(config.WORKOS_API_KEY, config.WORKOS_CLIENT_ID)
    : null;

  // ==========================================================================
  // STEP 6.88: Create audit service
  // ==========================================================================
  const auditService = new AuditService(rlsPrisma);
  const webhookService = new WebhookService(rlsPrisma);

  const sseService = new SSEService();
  logger.info('SSEService initialized for real-time event streaming');

  const agentJobQueue = new AgentJobQueue(rlsPrisma);
  // AgentHub is instantiated here but outcomeObserver, engagementService, and commsRouter
  // are wired below after they're created (they're set as optional constructor params).
  // We create a placeholder and re-assign after all deps are available.
  let agentHub: AgentHub;
  logger.info('AgentHub will be initialized after remaining deps are created');

  // ==========================================================================
  // STEP 6.89: Create meeting ingestion services (Storage, Transcription, Google OAuth)
  // ==========================================================================
  // Storage defaults to local filesystem — no cloud account needed. S3 is
  // opt-in via AWS_S3_BUCKET (or STORAGE_DRIVER=s3 for an explicit override).
  const storagePublicUrl =
    config.WEBHOOK_BASE_URL || config.PUBLIC_URL || `http://${config.HOST}:${config.PORT}`;
  const storageService = createStorageService({
    driver: config.STORAGE_DRIVER,
    awsBucket: config.AWS_S3_BUCKET,
    awsRegion: config.AWS_S3_REGION,
    awsAccessKeyId: config.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    storageRoot: config.STORAGE_ROOT,
    publicUrl: storagePublicUrl,
    jwtSecret: config.JWT_SECRET,
  });
  logger.info('Storage service initialized', { driver: storageService.driver });

  // STTProviderRouter (Plan 2): owns the local-Whisper → OpenAI chain.
  // Each provider stays disabled until its config is set (URL/api key),
  // so wiring the router unconditionally is safe — `isAvailable()` per
  // provider gates real calls.
  const sttChain = config.STT_PROVIDER_CHAIN
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0) as STTProviderId[];
  const sttRouter = new STTProviderRouter(
    [
      new LocalWhisperProvider({
        baseUrl: config.WHISPER_BASE_URL,
        timeoutMult: config.WHISPER_TIMEOUT_MULT,
      }),
      new OpenAIWhisperProvider({ apiKey: config.OPENAI_API_KEY }),
    ],
    sttChain,
  );
  logger.info('STTProviderRouter initialized', {
    chain: sttChain,
    localWhisperConfigured: !!config.WHISPER_BASE_URL,
    openaiConfigured: !!config.OPENAI_API_KEY,
  });

  // TranscriptionService keeps the chunking/merge pipeline; per-chunk
  // single-shot calls now go through the router. The legacy direct path
  // is preserved for the no-key + no-router case (router is always wired,
  // so the legacy path in practice is only used by tests).
  const sttConfigured = !!config.OPENAI_API_KEY || !!config.WHISPER_BASE_URL;
  const transcriptionService = sttConfigured
    ? new TranscriptionService(config.OPENAI_API_KEY ?? '', sttRouter)
    : null;

  if (!transcriptionService) {
    logger.warn('TranscriptionService disabled (no STT provider configured: set OPENAI_API_KEY or WHISPER_BASE_URL)');
  } else {
    logger.info('TranscriptionService enabled (delegates to STTProviderRouter)');
  }

  const googleOAuthService = (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET)
    ? new GoogleOAuthService(
        {
          clientId: config.GOOGLE_CLIENT_ID,
          clientSecret: config.GOOGLE_CLIENT_SECRET,
          redirectUri: config.GOOGLE_REDIRECT_URI || `${config.WEBHOOK_BASE_URL || 'http://localhost:3000'}/api/integrations/google/callback`,
          encryptionKey: config.ENCRYPTION_KEY || config.JWT_SECRET,
        },
        rlsPrisma,
      )
    : null;

  if (!googleOAuthService) {
    logger.warn('GoogleOAuthService disabled (no GOOGLE_CLIENT_ID configured)');
  } else {
    logger.info('GoogleOAuthService enabled for Google Meet integration');
  }

  const memoryOptimizerAgent = config.GEMINI_API_KEY
    ? new MemoryOptimizerAgent(
        promptPipeline.wrap(new GoogleClient({ apiKey: config.GEMINI_API_KEY })),
        rlsPrisma,
        memoryService,
        undefined,
        redis,
      )
    : null;

  if (!memoryOptimizerAgent) {
    logger.warn('MemoryOptimizerAgent disabled (no GEMINI_API_KEY)');
  } else {
    logger.info('MemoryOptimizerAgent available for tenant memory consolidation');
  }

  // ==========================================================================
  // STEP 6.9: Create communication router (multi-channel messaging)
  // ==========================================================================
  // Build channel adapters from configured env vars
  const channelAdapters: ChannelAdapter[] = [];

  // Slack — uses dedicated bot token
  const slackAdapter = new SlackChannel(config.SLACK_BOT_TOKEN);
  if (config.SLACK_BOT_TOKEN) channelAdapters.push(slackAdapter);

  // Email — uses SendGrid API
  const emailAdapter = new EmailChannel({
    apiKey: config.SENDGRID_API_KEY,
    fromEmail: config.EMAIL_FROM,
  });
  channelAdapters.push(emailAdapter); // Always available (stub mode if no key)

  // WhatsApp — reuses Twilio credentials
  if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_PHONE_NUMBER) {
    channelAdapters.push(new WhatsAppChannel({
      accountSid: config.TWILIO_ACCOUNT_SID,
      authToken: config.TWILIO_AUTH_TOKEN,
      fromNumber: config.TWILIO_PHONE_NUMBER,
    }));
  }

  // Microsoft Teams — uses Incoming Webhook
  if (config.TEAMS_WEBHOOK_URL) {
    channelAdapters.push(new TeamsChannel(config.TEAMS_WEBHOOK_URL));
  }

  // SMS — reuses Twilio credentials
  if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_PHONE_NUMBER) {
    channelAdapters.push(new SMSChannel({
      accountSid: config.TWILIO_ACCOUNT_SID,
      authToken: config.TWILIO_AUTH_TOKEN,
      fromNumber: config.TWILIO_PHONE_NUMBER,
    }));
  }

  const communicationRouter = new CommunicationRouter(rlsPrisma, channelAdapters);

  const approvalFanoutService = new ApprovalFanoutService(
    rlsPrisma,
    redis,
    communicationRouter,
    config.PUBLIC_URL ?? 'http://localhost:3001',
    // Optional dispatch hooks so reply-to-approve fires the same dev
    // pipeline the web-UI route does. See task #192.
    engagementService as any,
    ticketService as any,
    queueService as any,
  );

  logger.info('CommunicationRouter initialized', {
    channels: channelAdapters.map(a => a.name),
    count: channelAdapters.length,
  });

  // ==========================================================================
  // STEP 6.10: Create clarification timeout service
  // ==========================================================================
  const clarificationTimeoutService = new ClarificationTimeoutService(
    rlsPrisma as any,
    googleChatService,
    queueService,
  );
  // Schedule periodic check (every 1 hour)
  await clarificationTimeoutService.schedulePeriodicCheck(1);
  logger.info('ClarificationTimeoutService initialized with periodic check');

  // ==========================================================================
  // STEP 6.95: Create OutcomeObserver + finalize AgentHub (needs all optional deps)
  // ==========================================================================
  const outcomeObserver = new OutcomeObserver(rlsPrisma);
  logger.info('OutcomeObserver initialized for task outcome recording');

  agentHub = new AgentHub(rlsPrisma, sseService, agentJobQueue, outcomeObserver, engagementService, communicationRouter);
  logger.info('AgentHub initialized for WebSocket agent connections');

  // M7.4: Chief-of-staff orchestrator with a real LLM planner backed by
  // ModelRegistryService. Planner auto-falls back to the deterministic
  // one-step plan when:
  //   - tenant has no provider credentials configured
  //   - the model call fails for any reason
  //   - model output fails schema validation
  // So every install works out of the box; quality climbs as users add
  // BYOK keys in settings.
  const modelRegistryForPlanner = new ModelRegistryService(rlsPrisma);
  const planner = new LLMPlanner({
    modelRegistry: modelRegistryForPlanner,
    // Budget gate: when the tenant sets monthlyBudgetTokens on the
    // chief_of_staff role, the planner stops calling the LLM once this
    // month's usage hits the cap and ChiefOfStaff runs the
    // deterministic one-step fallback. Turns BYOK into a fixed-cost
    // operation (matches the user's cost-model preference).
    budgetGate: usageService,
    // PG.6: project landmarks in planner prompt when a ticket carries
    // a projectId and we've built a project graph (credits:
    // safishamsi/graphify for the god-nodes concept).
    godNodeProvider: {
      getGodNodeNames: projectGraphService.getGodNodeNames.bind(projectGraphService),
      getGodNodeSnapshot: projectGraphService.getGodNodeSnapshot.bind(projectGraphService),
    },
  });
  const chiefOfStaffService = new ChiefOfStaffService(
    rlsPrisma,
    libraryService,
    ticketService,
    communicationRouter,
    planner,
  );

  // M7.5: EscalationService sits downstream of both Redis + ChiefOfStaff.
  // The setTokenMinter() hook back-wires the dep so ChiefOfStaff can mint
  // reply tokens during escalation without an import cycle.
  const escalationService = new EscalationService(rlsPrisma, redis, chiefOfStaffService);
  chiefOfStaffService.setTokenMinter(escalationService);

  // Subscribe to ticket lifecycle events. A child ticket done → progress
  // ping to Slack; child failed → replan-or-escalate decision. The
  // chief_of_staff only reacts to tickets with a parent (i.e. tickets
  // that are part of an active plan).
  ticketService.events.on('ticket.done', async (ev) => {
    try {
      const child = await (rlsPrisma as any).ticket.findUnique({ where: { id: ev.ticketId } });
      if (!child?.parentTicketId) return;
      await chiefOfStaffService.recordChildDone(child.parentTicketId, child.id, child.title);
    } catch (err) {
      logger.warn('chiefOfStaff.recordChildDone failed', { error: (err as Error).message });
    }
  });
  ticketService.events.on('ticket.failed', async (ev) => {
    try {
      const child = await (rlsPrisma as any).ticket.findUnique({ where: { id: ev.ticketId } });
      if (!child?.parentTicketId) return;
      await chiefOfStaffService.recordChildFailed({
        parentTicketId: child.parentTicketId,
        childTicketId: child.id,
        childTitle: child.title,
        error: ev.error ?? child.error ?? 'unknown failure',
      });
    } catch (err) {
      logger.warn('chiefOfStaff.recordChildFailed handler crashed', { error: (err as Error).message });
    }
  });

  // Hermes self-learning pair — hoisted out of the services literal so the
  // nightly cron processors below can reference the same instances.
  const skillDistillerService = new SkillDistillerService(rlsPrisma, geminiService);
  const skillRankingService = new SkillRankingService(rlsPrisma);

  // ==========================================================================
  // STEP 6.96: Meeting bot router (live-capture provider abstraction)
  // ==========================================================================
  // Build providers; isAvailable() is checked at request time, so even
  // with no Recall key or no Vexa stack we register all three and let
  // the router route around unavailable ones.
  const manualProvider = new ManualProvider();
  const recallProvider = new RecallProvider({
    apiKey: config.RECALL_API_KEY,
    webhookSecret: config.RECALL_WEBHOOK_SECRET,
  });
  const vexaProvider = new VexaProvider({
    baseUrl: config.VEXA_API_URL ?? 'http://vexa-api:18056',
  });

  // Tenant settings adapter — wraps the prisma model in the shape
  // MeetingBotRouter expects. Inline adapter avoids a premature
  // TenantSettingsService extraction.
  const tenantSettingsAdapter = {
    get: async (tenantId: string) => {
      const row = await (rlsPrisma as any).tenantSettings.findUnique({ where: { tenantId } });
      return {
        meetingBotProviderId: (row?.meetingBotProviderId ?? null) as
          | 'vexa'
          | 'recall'
          | 'manual'
          | null,
      };
    },
  };

  const meetingBotRouter = new MeetingBotRouter(
    [vexaProvider, recallProvider, manualProvider],
    tenantSettingsAdapter,
  );
  logger.info('MeetingBotRouter initialized with vexa/recall/manual providers');

  // ==========================================================================
  // STEP 7: Register all services on Fastify instance
  // ==========================================================================
  const services: Services = {
    prisma: rlsPrisma,
    redis,
    meetingRepository,
    taskRepository,
    prdRepository,
    meetingService,
    baAgentService,
    geminiService,
    openaiService,
    ollamaService,
    aiCouncil,
    jiraService,
    googleChatService,
    googleDocsService,
    integrationConnectionService,
    approvalFanoutService,
    agentDispatcherService: (() => new AgentDispatcherService(rlsPrisma))(),
    // Orchestrator uses the same dispatcher instance for its help/fallback
    // branch and calls Gemini when a key is configured.
    conversationOrchestratorService: new ConversationOrchestratorService(
      rlsPrisma,
      new AgentDispatcherService(rlsPrisma),
      geminiService,
      usageService,
      config.LLM_MENTION_CLASSIFIER_ENABLED === 'true',
    ),
    skillDistillerService,
    skillRankingService,
    skillsService: new SkillsService(rlsPrisma),
    trajectoryService,
    promptPipeline,
    subagentSpawner: new SubagentSpawner(),
    cronSchedulerService: new CronSchedulerService(rlsPrisma),
    memoryManager,
    architectService: new ArchitectService(rlsPrisma, geminiService),
    liveCaptureService: (() => {
      const svc = new LiveCaptureService(rlsPrisma, redis, queueService);
      // N6 final: ticket-first primary writer wired after construction
      // to break the TicketService ↔ DI ordering cycle.
      svc.setTicketService(ticketService);
      return svc;
    })(),
    modelRegistry: new ModelRegistryService(rlsPrisma),
    queueService,
    twilioVoiceService,
    transcriptBuffer,
    engagementService,
    clarificationTimeoutService,
    communicationRouter,
    emailChannel: emailAdapter,
    githubService,
    usageService,
    agentRoleService,
    goalService,
    ticketService,
    agentWebhookService,
    projectService,
    projectGraphService,
    prdSymbolLinker,
    libraryService,
    chiefOfStaffService,
    escalationService,
    workosService,
    auditService,
    webhookService,
    sseService,
    storageService,
    transcriptionService,
    sttRouter,
    domainPromptBuilder: new DomainPromptBuilder({
      prisma: rlsPrisma,
      projectGraphService,
    }),
    googleOAuthService,
    agentJobQueue,
    agentHub,
    meetingBotRouter,
    recallWebhookSecret: config.RECALL_WEBHOOK_SECRET,
    config,
    hardwareDetectService: new HardwareDetectService(),
  };

  // Decorate Fastify instance with services
  app.decorate('services', services);

  // ==========================================================================
  // STEP 7.5: Register rate limiting
  // ==========================================================================
  await registerRateLimiting(app, {
    redis,
    enabled: config.NODE_ENV !== 'test', // Disable in test environment
  });

  // ==========================================================================
  // STEP 7.6: Register tenant isolation middleware
  // ==========================================================================
  await registerTenantMiddleware(app, {
    allowHeaderTenant: config.NODE_ENV !== 'production', // Only allow X-Tenant-ID header in dev
    excludedRoutes: ['/health', '/ready', '/metrics', '/api/docs'],
    excludedPrefixes: ['/webhooks/', '/public/', '/api/auth/'],
    // Validate tenant exists in database
    validateTenant: async (tenantId: string) => {
      const tenant = await rlsPrisma.tenant.findUnique({ where: { id: tenantId } });
      return !!tenant;
    },
  });
  await wrapRoutesWithTenantContext(app);
  logger.info('✅ Tenant middleware registered');

  // ==========================================================================
  // STEP 8: Register queue processors and start workers
  // ==========================================================================
  const processors = createProcessors({
    baAgentService: {
      processMeetingTranscript: baAgentService.processMeetingTranscript.bind(baAgentService),
    },
    meetingRepository: {
      findById: meetingRepository.findById.bind(meetingRepository),
    } as any,
    meetingService: {
      getMeetingWithTranscript: async (meetingId: string) => {
        const meeting = await meetingRepository.findById(meetingId);
        if (!meeting) return null;
        // Load transcript from Prisma relation
        const fullMeeting = await rlsPrisma.meeting.findUnique({
          where: { id: meetingId },
          include: { transcript: true },
        });
        return {
          id: meeting.id,
          tenantId: meeting.tenantId,
          transcript: fullMeeting?.transcript
            ? { id: fullMeeting.transcript.id, fullText: fullMeeting.transcript.fullText || '' }
            : undefined,
        };
      },
    } as any,
    googleChatService: {
      // Adapter: map generic sendNotification to GoogleChatService methods
      sendNotification: async (params: {
        tenantId: string;
        type: string;
        title: string;
        message: string;
        metadata?: Record<string, unknown>;
      }) => {
        if (params.type === 'error' || params.type === 'warning') {
          await googleChatService.sendCard({
            header: { title: params.title, subtitle: params.type.toUpperCase() },
            sections: [{
              widgets: [{ type: 'textParagraph', data: { text: params.message } }],
            }],
          });
        } else {
          await googleChatService.sendText({ text: `*${params.title}*\n${params.message}` });
        }
      },
    },
    jiraService: {
      createIssue: jiraService.createIssue.bind(jiraService),
    },
    prdRepository: {
      updateTicketExternalKey: prdRepository.updateTicketExternalKey.bind(prdRepository),
      // Needed by the DEV_AGENT_PROCESS processor to read the approved PRD
      // before dispatching to the agent hub. Earlier wrapper only exposed
      // updateTicketExternalKey, which caused findById?.(...) to return
      // undefined → "PRD not found or not approved".
      findById: prdRepository.findById.bind(prdRepository),
      findByIdWithTickets: prdRepository.findByIdWithTickets.bind(prdRepository),
      // Several processor branches do `prdRepository.prisma?.agentTask.update(...)`
      // for best-effort status bumps. Expose the underlying client so
      // those calls don't silently no-op.
      prisma: rlsPrisma,
    } as any,
    taskRepository: {
      createTask: taskRepository.createTask.bind(taskRepository),
    },
    // N6 final: ticket-first primary write path for MEETING_PROCESS.
    // When wired, processors.ts creates a Ticket AND a reverse-mirror
    // AgentTask in one call; the legacy taskRepository.createTask
    // path deprecates silently.
    ticketService: {
      createAsNewWork: ticketService.createAsNewWork.bind(ticketService),
    },
    logger,
    githubService: githubService ?? undefined,
    geminiService: geminiService
      ? { generateContent: async (prompt: string) => {
          // Use Gemini's model directly for general-purpose content generation
          const result = await (geminiService as any).model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
          return result.response?.text?.() || '';
        }}
      : undefined,
    clarificationTimeoutService,
    engagementService: {
      create: engagementService.create.bind(engagementService),
      advancePhase: engagementService.advancePhase.bind(engagementService),
    },
    queueService: {
      addJob: queueService.addJob.bind(queueService),
    },
    memoryOptimizerAgent: memoryOptimizerAgent ?? undefined,
    communicationRouter: {
      send: communicationRouter.send.bind(communicationRouter),
    },
    storageService,
    transcriptionService: transcriptionService ?? undefined,
    prisma: rlsPrisma,
    skillLoader,
    outcomeObserver,
    agentHub,
    emailChannel: emailAdapter,
    prismaForDigest: rlsPrisma,
    skillDistillerService,
    skillRankingService,
  } as any);

  // Register each processor with the queue service
  queueService.registerProcessor(JobType.MEETING_PROCESS, processors[JobType.MEETING_PROCESS] as any);
  queueService.registerProcessor(JobType.BA_AGENT_PROCESS, processors[JobType.BA_AGENT_PROCESS] as any);
  queueService.registerProcessor(JobType.JIRA_SYNC, processors[JobType.JIRA_SYNC] as any);
  queueService.registerProcessor(JobType.NOTIFICATION, processors[JobType.NOTIFICATION]);
  queueService.registerProcessor(JobType.DEV_AGENT_PROCESS, processors[JobType.DEV_AGENT_PROCESS] as any);
  queueService.registerProcessor(JobType.QA_AGENT_PROCESS, processors[JobType.QA_AGENT_PROCESS] as any);
  queueService.registerProcessor(JobType.CLARIFICATION_TIMEOUT, processors[JobType.CLARIFICATION_TIMEOUT] as any);
  queueService.registerProcessor(JobType.CLARIFICATION_REMINDER, processors[JobType.CLARIFICATION_REMINDER] as any);
  queueService.registerProcessor(JobType.MEMORY_OPTIMIZER, processors[JobType.MEMORY_OPTIMIZER] as any);
  queueService.registerProcessor(JobType.MEETING_TRANSCRIBE, processors[JobType.MEETING_TRANSCRIBE] as any);
  queueService.registerProcessor(JobType.EMAIL_DIGEST, processors[JobType.EMAIL_DIGEST] as any);
  queueService.registerProcessor(JobType.SKILL_DISTILL, processors[JobType.SKILL_DISTILL] as any);
  queueService.registerProcessor(JobType.SKILL_RERANK, processors[JobType.SKILL_RERANK] as any);

  // Start queue workers
  await queueService.start();
  logger.info('✅ Queue workers started');

  // ==========================================================================
  // STEP 8.1: Schedule daily email digest (8 AM UTC, every day)
  // ==========================================================================
  queueService.addJob(
    JobType.EMAIL_DIGEST,
    {} as any,
    {
      jobId: 'daily-email-digest',
      repeat: { pattern: '0 8 * * *' },
    },
  ).catch((err) => {
    logger.warn('Failed to schedule daily email digest cron', { error: (err as Error).message });
  });

  // ==========================================================================
  // STEP 8.2: Schedule Hermes self-learning crons
  // ==========================================================================
  // Distillation runs at 02:00 UTC every day — reads the last 30 days of
  // approved agent outcomes and drops candidate LearnedSkill rows for
  // admin review. Ranking runs at 03:00 UTC — pulls the last 14 days of
  // outcomes per agent type and nudges each active skill's confidence up
  // or down, auto-demoting anything that drops below threshold. Both are
  // idempotent on no-op (Gemini missing, no outcomes to scan, etc.) so
  // it's safe to run them unconditionally.
  queueService.addJob(
    JobType.SKILL_DISTILL,
    {} as any,
    {
      jobId: 'hermes-skill-distill',
      repeat: { pattern: '0 2 * * *' },
    },
  ).catch((err) => {
    logger.warn('Failed to schedule Hermes skill-distill cron', { error: (err as Error).message });
  });

  queueService.addJob(
    JobType.SKILL_RERANK,
    {} as any,
    {
      jobId: 'hermes-skill-rerank',
      repeat: { pattern: '0 3 * * *' },
    },
  ).catch((err) => {
    logger.warn('Failed to schedule Hermes skill-rerank cron', { error: (err as Error).message });
  });

  // ==========================================================================
  // STEP 9: Setup cleanup on shutdown
  // ==========================================================================
  app.addHook('onClose', async () => {
    logger.info('Closing connections and stopping services...');

    // End all active Twilio calls
    if (twilioVoiceService) {
      await twilioVoiceService.endAllCalls();
    }

    // Close all SSE connections and stop heartbeat
    sseService.destroy();

    // Flush all buffered transcript chunks before shutdown
    await transcriptBuffer.shutdown();

    // Release storage driver handles (noop for local, closes S3 client for s3)
    storageService.shutdown();

    // Stop queue workers first (needs Redis still alive for in-progress jobs)
    await queueService.stop();

    await prisma.$disconnect();
    await pool.end();
    await redis.quit();
    await bullmqRedis.quit();
    logger.info('All connections closed');
  });

  logger.info('✅ Dependency injection container ready');
}
