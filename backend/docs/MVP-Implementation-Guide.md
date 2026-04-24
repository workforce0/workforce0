# MVP Implementation Guide
## Workforce0: Meeting → PRD → Jira Flow

| Field | Value |
|-------|-------|
| **Version** | 1.0 |
| **Date** | 2026-01-25 |
| **Branch** | `mvp/ba-agent-flow` |
| **Author** | Workforce0 Maintainers |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [MVP Scope Definition](#2-mvp-scope-definition)
3. [Current State Assessment](#3-current-state-assessment)
4. [Architecture Overview](#4-architecture-overview)
5. [Implementation Phases](#5-implementation-phases)
6. [Technical Specifications](#6-technical-specifications)
7. [API Contracts](#7-api-contracts)
8. [Testing Strategy](#8-testing-strategy)
9. [Environment Setup](#9-environment-setup)
10. [Deployment Plan](#10-deployment-plan)
11. [Success Criteria](#11-success-criteria)
12. [Risk Register](#12-risk-register)

---

## 1. Executive Summary

### What We're Building

The MVP is a **working end-to-end pipeline** that:

1. **Joins a meeting** via Recall.ai when given a meeting URL
2. **Transcribes the meeting** in real-time using Whisper
3. **Processes the transcript** with the BA Agent using Gemini 2.0 Flash
4. **Generates a structured PRD** with confidence scoring
5. **Creates Jira tickets** from PRD requirements
6. **Notifies users** via Google Chat

### Why This Matters

```
TODAY (Manual Process):
Meeting → Notes (2 hrs) → PRD (1-2 days) → Jira (hours) → Clarifications (days)
Total: 1-2 weeks

WITH MVP:
Meeting → Auto-transcript → PRD (minutes) → Jira (instant) → Clarify via Chat
Total: < 4 hours
```

### Key Metrics

| Metric | Target |
|--------|--------|
| Meeting to PRD | < 30 minutes after meeting ends |
| PRD to Jira | < 5 minutes after approval |
| PRD confidence | > 75% average |
| API latency (p95) | < 500ms |
| Uptime | 99% |

---

## 2. MVP Scope Definition

### In Scope (Must Have)

| Feature | Description | Priority |
|---------|-------------|----------|
| Meeting Bot Deploy | Deploy Recall.ai bot to Google Meet | P0 |
| Real-time Transcription | Webhook handler for transcript chunks | P0 |
| BA Agent Processing | Generate PRD from transcript | P0 |
| Confidence Scoring | Score PRD quality 0-1 | P0 |
| Jira Integration | Create tickets from requirements | P0 |
| Google Chat Notifications | Notify on PRD ready, approval needed | P0 |
| Basic API | REST endpoints for meeting/PRD CRUD | P0 |
| Webhook Handlers | Recall.ai event processing | P0 |
| Queue Workers | BullMQ background processing | P0 |

### In Scope (Should Have)

| Feature | Description | Priority |
|---------|-------------|----------|
| Clarification Requests | Ask questions when confidence < 0.5 | P1 |
| PRD Approval Flow | Human review for confidence 0.5-0.9 | P1 |
| Voice Module (Passive) | Stream audio to Gemini Live (listen-only) | P1 |
| Dashboard Health Check | `/health` and `/metrics` endpoints | P1 |

### Out of Scope (Phase 2+)

| Feature | Reason for Deferral |
|---------|---------------------|
| Active Voice Participation | Requires more tuning of VAD/turn-taking |
| Dev Agent | Focus on BA Agent first |
| Multi-model Consensus | Single model (Gemini) first |
| React Dashboard | CLI/API first, UI later |
| Enterprise SSO | Not needed for pilot |

---

## 3. Current State Assessment

### What's Already Built

```
src/
├── config/index.ts          ✅ Complete - Zod validation, env loading
├── lib/
│   ├── logger.ts            ✅ Complete - Pino logger
│   ├── di-container.ts      ✅ Complete - Fastify DI
│   ├── error-handler.ts     ✅ Complete - AppError class
│   └── graceful-shutdown.ts ✅ Complete - Signal handlers
├── repositories/
│   ├── base.repository.ts   ⚠️ Partial - Interface only
│   ├── meeting.repository.ts ⚠️ Partial - Needs Prisma impl
│   ├── task.repository.ts   ⚠️ Partial - Needs Prisma impl
│   └── prd.repository.ts    ⚠️ Partial - Needs Prisma impl
├── services/
│   ├── agent/
│   │   └── ba-agent.service.ts  ⚠️ Partial - Logic done, needs wiring
│   ├── ai/
│   │   ├── gemini.service.ts    ⚠️ Partial - Needs generatePRD impl
│   │   └── prompts.ts           🔴 Empty - Needs prompts
│   ├── meeting/
│   │   ├── meeting.service.ts   ⚠️ Partial - Orchestration logic
│   │   └── recall.service.ts    ✅ Complete - API client done
│   ├── integrations/
│   │   ├── jira.service.ts      ✅ Complete - API client done
│   │   └── gchat.service.ts     🔴 Empty - Needs implementation
│   └── queue/
│       └── queue.service.ts     ⚠️ Partial - BullMQ setup
├── routes/
│   ├── meetings.routes.ts   ⚠️ Partial - Needs handlers
│   ├── agents.routes.ts     ⚠️ Partial - Needs handlers
│   ├── webhooks.routes.ts   🔴 Empty - Critical for Recall.ai
│   └── index.ts             ✅ Complete - Route registration
├── voice/                   ✅ NEW - Gemini Live API
│   ├── config.ts
│   ├── gemini-live.ts
│   ├── meeting-session.ts
│   ├── audio-bridge.ts
│   └── index.ts
└── types/index.ts           ⚠️ Partial - Needs more types

prisma/
└── schema.prisma            ✅ Complete - All models defined
```

### Legend

- ✅ Complete - Ready to use
- ⚠️ Partial - Structure exists, needs implementation
- 🔴 Empty - Needs to be built from scratch

### What Needs Work

| Component | Status | Effort | Notes |
|-----------|--------|--------|-------|
| Repositories (Prisma) | Partial | Medium | Convert interfaces to Prisma calls |
| Webhooks Routes | Empty | High | Critical path for Recall.ai events |
| GChat Service | Empty | Medium | Google Chat API integration |
| Gemini PRD Generation | Partial | High | Core AI logic with prompts |
| Queue Workers | Partial | Medium | BullMQ worker registration |
| Prompts | Empty | High | PRD generation prompts |

---

## 4. Architecture Overview

### High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MVP ARCHITECTURE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  USER                                                                        │
│    │                                                                         │
│    │ POST /api/meetings                                                      │
│    ▼                                                                         │
│  ┌──────────────┐                                                            │
│  │   Fastify    │                                                            │
│  │   API        │                                                            │
│  └──────┬───────┘                                                            │
│         │                                                                    │
│         ▼                                                                    │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   Meeting    │───▶│   Recall.ai  │───▶│ Google Meet  │                   │
│  │   Service    │    │   API        │    │  (Meeting)   │                   │
│  └──────┬───────┘    └──────────────┘    └──────────────┘                   │
│         │                                       │                            │
│         │                                       │ Webhook Events             │
│         │                                       ▼                            │
│         │            ┌──────────────────────────────────────┐               │
│         │            │ POST /webhooks/recall                 │               │
│         │            │ - bot.status_change                   │               │
│         │            │ - bot.transcription                   │               │
│         │            │ - bot.recording_ready                 │               │
│         │            └──────────────┬───────────────────────┘               │
│         │                           │                                        │
│         │                           ▼                                        │
│         │            ┌──────────────────────────────────────┐               │
│         ▼            │                                       │               │
│  ┌──────────────┐    │      BullMQ Queue                    │               │
│  │  PostgreSQL  │◀───│      - transcript-processing          │               │
│  │  (Prisma)    │    │      - prd-generation                │               │
│  └──────────────┘    │      - jira-sync                     │               │
│         ▲            │      - notification                   │               │
│         │            └──────────────┬───────────────────────┘               │
│         │                           │                                        │
│         │                           ▼                                        │
│         │            ┌──────────────────────────────────────┐               │
│         │            │           BA Agent                    │               │
│         │            │                                       │               │
│         │            │   ┌────────────────┐                 │               │
│         └────────────│───│ Gemini 2.0     │                 │               │
│                      │   │ Flash API      │                 │               │
│                      │   └────────────────┘                 │               │
│                      │           │                           │               │
│                      │           ▼                           │               │
│                      │   ┌────────────────┐                 │               │
│                      │   │ PRD Generated  │                 │               │
│                      │   │ + Confidence   │                 │               │
│                      │   └───────┬────────┘                 │               │
│                      └───────────┼───────────────────────────┘               │
│                                  │                                           │
│         ┌────────────────────────┼────────────────────────┐                 │
│         │                        │                        │                 │
│         ▼                        ▼                        ▼                 │
│  ┌────────────┐          ┌────────────┐          ┌────────────┐            │
│  │ confidence │          │ 0.5 < c <  │          │ confidence │            │
│  │   >= 0.9   │          │    0.9     │          │   < 0.5    │            │
│  │ AUTO APPROVE│          │ HUMAN REV  │          │ CLARIFY    │            │
│  └──────┬─────┘          └──────┬─────┘          └──────┬─────┘            │
│         │                       │                       │                   │
│         ▼                       ▼                       ▼                   │
│  ┌────────────┐          ┌────────────┐          ┌────────────┐            │
│  │   Jira     │          │ Google Chat│          │ Google Chat│            │
│  │  Tickets   │          │ Approval   │          │ Clarify    │            │
│  │  Created   │          │ Request    │          │ Question   │            │
│  └────────────┘          └────────────┘          └────────────┘            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **API** | Fastify + TypeScript | HTTP server, routing |
| **Database** | PostgreSQL + Prisma | Data persistence |
| **Queue** | BullMQ + Redis | Async job processing |
| **Meeting Bot** | Recall.ai | Universal meeting support |
| **AI Model** | Gemini 2.0 Flash | PRD generation |
| **Notifications** | Google Chat API | User notifications |
| **Project Mgmt** | Jira Cloud API | Ticket creation |
| **Real-time Voice** | Gemini Live API | Future: Active participation |

---

## 5. Implementation Phases

### Phase 1: Foundation (Days 1-2)

**Goal:** Working server with database and queues

| Task | Description | Files |
|------|-------------|-------|
| 1.1 | Set up .env with all required variables | `.env` |
| 1.2 | Run Prisma migrations | `prisma/schema.prisma` |
| 1.3 | Implement repositories with Prisma | `src/repositories/*.ts` |
| 1.4 | Wire up DI container properly | `src/lib/di-container.ts` |
| 1.5 | Set up BullMQ workers | `src/services/queue/*.ts` |
| 1.6 | Add health check endpoint | `src/routes/health.routes.ts` |

**Verification:**
```bash
npm run dev
curl http://localhost:3000/health
# Should return: { "status": "ok", "db": "connected", "redis": "connected" }
```

### Phase 2: Recall.ai Integration (Days 3-4)

**Goal:** Deploy bot to meeting and receive webhooks

| Task | Description | Files |
|------|-------------|-------|
| 2.1 | Implement webhook routes | `src/routes/webhooks.routes.ts` |
| 2.2 | Add webhook signature verification | `src/services/meeting/recall.service.ts` |
| 2.3 | Handle `bot.status_change` events | `src/services/meeting/meeting.service.ts` |
| 2.4 | Handle `bot.transcription` events | `src/services/meeting/meeting.service.ts` |
| 2.5 | Queue transcript processing | `src/services/queue/queue.service.ts` |

**Verification:**
```bash
# Create a test meeting
curl -X POST http://localhost:3000/api/meetings \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "https://meet.google.com/test", "title": "Test"}'

# Check bot was deployed
# Verify webhooks received via logs
```

### Phase 3: BA Agent & PRD Generation (Days 5-7)

**Goal:** Generate PRD from transcript using Gemini

| Task | Description | Files |
|------|-------------|-------|
| 3.1 | Create PRD generation prompts | `src/services/ai/prompts.ts` |
| 3.2 | Implement `generatePRD` method | `src/services/ai/gemini.service.ts` |
| 3.3 | Add confidence scoring logic | `src/services/agent/ba-agent.service.ts` |
| 3.4 | Implement PRD repository methods | `src/repositories/prd.repository.ts` |
| 3.5 | Wire up BA Agent worker | `src/services/queue/workers/ba-agent.worker.ts` |

**Verification:**
```bash
# Process a test transcript
curl -X POST http://localhost:3000/api/agents/ba/process \
  -H "Content-Type: application/json" \
  -d '{"transcript": "Discussion about user authentication..."}'

# Check PRD was generated
curl http://localhost:3000/api/prds/{prdId}
```

### Phase 4: Jira & Notifications (Days 8-9)

**Goal:** Create Jira tickets and send Google Chat notifications

| Task | Description | Files |
|------|-------------|-------|
| 4.1 | Implement Google Chat service | `src/services/integrations/gchat.service.ts` |
| 4.2 | Add notification worker | `src/services/queue/workers/notification.worker.ts` |
| 4.3 | Implement Jira sync worker | `src/services/queue/workers/jira.worker.ts` |
| 4.4 | Add approval routes | `src/routes/agents.routes.ts` |
| 4.5 | Create clarification flow | `src/services/agent/ba-agent.service.ts` |

**Verification:**
```bash
# Approve a PRD
curl -X POST http://localhost:3000/api/prds/{prdId}/approve \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_123"}'

# Check Jira tickets created
# Check Google Chat notification received
```

### Phase 5: Testing & Polish (Days 10-12)

**Goal:** E2E tests and production readiness

| Task | Description | Files |
|------|-------------|-------|
| 5.1 | Write unit tests for services | `tests/unit/*.test.ts` |
| 5.2 | Write integration tests | `tests/integration/*.test.ts` |
| 5.3 | Add E2E test for full flow | `tests/e2e/meeting-to-jira.test.ts` |
| 5.4 | Add metrics endpoint | `src/routes/metrics.routes.ts` |
| 5.5 | Documentation review | `docs/*.md` |

---

## 6. Technical Specifications

### 6.1 PRD Generation Prompt

The core prompt that transforms transcripts into PRDs:

```typescript
// src/services/ai/prompts.ts

export const PRD_GENERATION_PROMPT = `You are a senior Business Analyst at a software company.

Your task is to analyze a meeting transcript and generate a structured Product Requirements Document (PRD).

## Input
You will receive a meeting transcript with timestamps and speaker labels.

## Output
Generate a PRD with the following structure:

{
  "title": "string - Clear, descriptive title for the project",
  "summary": "string - 2-3 sentence executive summary",
  "objectives": ["string[] - 3-5 key objectives"],
  "requirements": [
    {
      "id": "string - e.g., REQ-001",
      "title": "string - Brief requirement title",
      "description": "string - Detailed description",
      "priority": "critical | high | medium | low",
      "type": "functional | non_functional | technical",
      "acceptanceCriteria": ["string[] - Specific, testable criteria"]
    }
  ],
  "acceptanceCriteria": ["string[] - Overall project acceptance criteria"],
  "outOfScope": ["string[] - Explicitly excluded items"],
  "assumptions": ["string[] - Assumptions made"],
  "risks": [
    {
      "description": "string",
      "impact": "high | medium | low",
      "mitigation": "string"
    }
  ],
  "timeline": "string - Estimated timeline if mentioned",
  "confidence": 0.0-1.0
}

## Confidence Scoring
Set confidence based on:
- 0.9-1.0: Clear requirements, specific details, no ambiguity
- 0.7-0.9: Most requirements clear, some details missing
- 0.5-0.7: Multiple ambiguous points, needs clarification
- 0.0-0.5: Insufficient information, requires significant clarification

## Guidelines
1. Extract ONLY what was discussed - do not invent requirements
2. If something is unclear, note it in assumptions
3. Use the EXACT terminology from the meeting
4. Prioritize based on emphasis and urgency in discussion
5. Each requirement must have testable acceptance criteria

## Transcript:
{transcript}
`;
```

### 6.2 Webhook Payload Schemas

```typescript
// Recall.ai webhook payloads

interface BotStatusChangeEvent {
  event: 'bot.status_change';
  data: {
    bot_id: string;
    status: 'joining' | 'in_meeting' | 'transcribing' | 'done' | 'error';
    joined_at?: string;
    left_at?: string;
    error?: {
      code: string;
      message: string;
    };
  };
}

interface BotTranscriptionEvent {
  event: 'bot.transcription';
  data: {
    bot_id: string;
    transcript: {
      words: Array<{
        text: string;
        start: number;
        end: number;
        speaker?: string;
        confidence: number;
      }>;
    };
    is_final: boolean;
  };
}

interface BotRecordingReadyEvent {
  event: 'bot.recording_ready';
  data: {
    bot_id: string;
    recording_url: string;
    duration_seconds: number;
  };
}
```

### 6.3 Queue Job Definitions

```typescript
// BullMQ job definitions

interface TranscriptProcessingJob {
  type: 'transcript-processing';
  data: {
    meetingId: string;
    tenantId: string;
    botId: string;
    transcriptChunk?: {
      words: Array<WordData>;
      isFinal: boolean;
    };
  };
}

interface PRDGenerationJob {
  type: 'prd-generation';
  data: {
    taskId: string;
    meetingId: string;
    tenantId: string;
    transcript: string;
  };
}

interface JiraSyncJob {
  type: 'jira-sync';
  data: {
    prdId: string;
    tenantId: string;
    ticketIds: string[];
  };
}

interface NotificationJob {
  type: 'notification';
  data: {
    tenantId: string;
    channel: 'gchat' | 'slack' | 'email';
    type: 'prd_ready' | 'approval_needed' | 'clarification_needed';
    payload: Record<string, unknown>;
  };
}
```

---

## 7. API Contracts

### 7.1 Meeting APIs

```yaml
# POST /api/meetings
# Create a meeting and deploy bot
Request:
  meetingUrl: string (required) # Google Meet URL
  title: string (optional)
  tenantId: string (from auth)

Response: 201
  id: string
  botId: string
  status: "scheduled" | "joining"
  meetingUrl: string

---

# GET /api/meetings/:id
# Get meeting details
Response: 200
  id: string
  title: string
  status: string
  startTime: string
  endTime: string | null
  transcript: { fullText: string, wordCount: number } | null
  prds: Array<{ id: string, title: string, confidence: number }>

---

# DELETE /api/meetings/:id
# Cancel meeting / remove bot
Response: 204
```

### 7.2 PRD APIs

```yaml
# GET /api/prds/:id
# Get PRD details
Response: 200
  id: string
  title: string
  summary: string
  objectives: string[]
  requirements: Requirement[]
  acceptanceCriteria: string[]
  outOfScope: string[]
  assumptions: string[]
  risks: Risk[]
  confidence: number
  status: "draft" | "pending_approval" | "approved" | "rejected"
  tickets: JiraTicket[]

---

# POST /api/prds/:id/approve
# Approve a PRD (triggers Jira sync)
Request:
  userId: string
  comment?: string

Response: 200
  id: string
  status: "approved"
  tickets: JiraTicket[] # Newly created tickets

---

# POST /api/prds/:id/reject
# Reject a PRD with feedback
Request:
  userId: string
  reason: string

Response: 200
  id: string
  status: "rejected"
```

### 7.3 Webhook APIs

```yaml
# POST /webhooks/recall
# Recall.ai webhook handler
Request:
  Headers:
    X-Recall-Signature: string
  Body:
    event: string
    data: object

Response: 200
  received: true

---

# POST /webhooks/gchat
# Google Chat webhook handler (for clarification responses)
Request:
  message:
    text: string
    sender: { email: string }
  space: { name: string }

Response: 200
  text: string # Response message
```

---

## 8. Testing Strategy

### Unit Tests

| Module | Test Coverage |
|--------|---------------|
| BA Agent Service | PRD validation, confidence calculation, routing logic |
| Gemini Service | Prompt formatting, response parsing |
| Recall Service | Request building, error handling |
| Jira Service | Payload building, ADF conversion |

### Integration Tests

| Test | Description |
|------|-------------|
| Recall Webhook Flow | Mock webhook → DB update |
| PRD Generation Flow | Transcript → Gemini → PRD |
| Jira Sync Flow | PRD → Tickets in DB |
| Notification Flow | Event → Google Chat call |

### E2E Tests

```typescript
// tests/e2e/meeting-to-jira.test.ts

describe('Meeting to Jira E2E', () => {
  it('should process meeting and create Jira tickets', async () => {
    // 1. Create meeting
    const meeting = await api.post('/api/meetings', {
      meetingUrl: 'https://meet.google.com/test-meeting',
      title: 'Feature Planning'
    });

    // 2. Simulate Recall webhook with transcript
    await api.post('/webhooks/recall', mockTranscriptWebhook);

    // 3. Wait for processing
    await waitForJob('prd-generation');

    // 4. Verify PRD created
    const prds = await api.get(`/api/meetings/${meeting.id}/prds`);
    expect(prds.length).toBe(1);
    expect(prds[0].confidence).toBeGreaterThan(0.7);

    // 5. Approve PRD
    await api.post(`/api/prds/${prds[0].id}/approve`, { userId: 'test' });

    // 6. Verify Jira tickets
    const prd = await api.get(`/api/prds/${prds[0].id}`);
    expect(prd.tickets.length).toBeGreaterThan(0);
  });
});
```

---

## 9. Environment Setup

### Required Environment Variables

```bash
# .env

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/workforce0

# Redis (for BullMQ)
REDIS_URL=redis://localhost:6379

# Recall.ai
RECALL_API_KEY=your_recall_api_key
RECALL_WEBHOOK_SECRET=your_webhook_secret

# Google AI (Gemini)
GEMINI_API_KEY=your_gemini_api_key

# Jira
JIRA_BASE_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=bot@yourcompany.com
JIRA_API_TOKEN=your_jira_api_token
JIRA_PROJECT_KEY=WF0

# Google Chat
GCHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/...
# OR for full API access:
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
GCHAT_SPACE_ID=spaces/AAAA...

# Optional: Voice (for future active participation)
GEMINI_VOICE_ENABLED=false
```

### Local Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL and Redis
docker-compose up -d postgres redis

# 3. Run migrations
npx prisma migrate dev

# 4. Generate Prisma client
npx prisma generate

# 5. Start development server
npm run dev

# 6. (Optional) Expose webhooks for testing
npx ngrok http 3000
```

### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: workforce0
      POSTGRES_PASSWORD: workforce0
      POSTGRES_DB: workforce0
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

---

## 10. Deployment Plan

### MVP Deployment Options

| Option | Pros | Cons | Cost |
|--------|------|------|------|
| Railway | Simple, auto-deploy | Limited customization | ~$20/mo |
| Render | Good free tier, easy | Cold starts on free | $0-25/mo |
| AWS EC2 + RDS | Full control | More setup | ~$50/mo |
| Fly.io | Edge deployment | Learning curve | ~$15/mo |

### Recommended: Railway

```bash
# Deploy to Railway
railway login
railway init
railway add
railway up
```

### Production Checklist

- [ ] Environment variables set
- [ ] Database migrations run
- [ ] Webhook URL configured in Recall.ai dashboard
- [ ] Google Chat webhook configured
- [ ] Jira connection tested
- [ ] Health check responding
- [ ] Logging working
- [ ] Error monitoring (Sentry optional)

---

## 11. Success Criteria

### MVP Launch Criteria

| Criterion | Measurement | Target |
|-----------|-------------|--------|
| Core flow works | End-to-end test passes | 100% |
| API latency | p95 response time | < 500ms |
| PRD quality | Average confidence score | > 0.7 |
| Uptime | Health check success rate | > 99% |
| Jira sync | Tickets created within | < 5 min |

### User Acceptance Criteria

| Criterion | Definition |
|-----------|------------|
| Meeting Join | Bot successfully joins Google Meet |
| Transcription | Full transcript captured with speaker labels |
| PRD Generation | Structured PRD generated from transcript |
| Jira Creation | All requirements become Jira tickets |
| Notifications | User notified on PRD ready/approval needed |

---

## 12. Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Recall.ai outage | Low | High | Queue jobs, retry logic, manual fallback |
| Gemini rate limits | Medium | Medium | Exponential backoff, request queuing |
| Poor PRD quality | Medium | High | Human review for confidence < 0.9, feedback loop |
| Jira API changes | Low | Medium | Version pinning, integration tests |
| Webhook delivery failures | Low | High | Retry queue, idempotency keys |

---

## Next Steps

1. **Review this document** - Confirm scope and approach
2. **Set up environment** - Get all API keys and credentials
3. **Start Phase 1** - Foundation implementation
4. **Daily standups** - Track progress against phases

---

*Document maintained by: Engineering Team*
*Last updated: 2026-01-25*
