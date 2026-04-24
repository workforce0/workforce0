# Workforce0 - Agent Implementation Guide

**Version:** 1.0
**Date:** 2026-01-23
**Status:** Planning

This document defines the specific tools, MCPs, models, and frameworks used to implement each agent in the Workforce0 platform.

---

## Table of Contents

1. [Meeting Intelligence Bot](#1-meeting-intelligence-bot)
2. [BA Agent](#2-ba-agent)
3. [Dev Agent](#3-dev-agent)
4. [Sales Agent](#4-sales-agent)
5. [Marketing Agent](#5-marketing-agent)
6. [Shared Infrastructure](#6-shared-infrastructure)
7. [Model Selection Strategy](#7-model-selection-strategy)

---

## 1. Meeting Intelligence Bot

### Purpose
Joins meetings, transcribes in real-time, asks clarifying questions, and extracts requirements.

### Core Components

| Component | Technology | Notes |
|-----------|------------|-------|
| **Meeting Platform** | Google Meet SDK | First-party, requires Workspace Enterprise |
| **Speech-to-Text** | AWS Transcribe Streaming | Real-time, speaker diarization |
| **Text-to-Speech** | Amazon Polly Neural | AI voice for questions |
| **Meeting Analysis** | Gemini 2.0 Flash | Fast real-time analysis |
| **Question Generation** | Claude 3.5 Sonnet | Better reasoning for clarifying Qs |

### MCP Servers

```yaml
meeting-intelligence:
  mcps:
    - name: google-calendar-mcp
      purpose: Access meeting schedules, join meetings
      repo: https://github.com/anthropic/google-calendar-mcp

    - name: google-meet-mcp
      purpose: Meet SDK integration (custom)
      implementation: Custom - wraps Google Meet SDK

    - name: aws-transcribe-mcp
      purpose: Real-time transcription streaming
      implementation: Custom - WebSocket to Transcribe
```

### Data Flow

```
Google Meet → Meet SDK → Audio Stream → AWS Transcribe
                                              ↓
                                        Transcript
                                              ↓
                                    Gemini (Analysis)
                                              ↓
                                   Claude (Questions)
                                              ↓
                                    Amazon Polly (Voice)
                                              ↓
                                    Google Meet (Audio Out)
```

---

## 2. BA Agent

### Purpose
Creates PRDs, user stories, acceptance criteria, and Jira tickets from meeting requirements.

### Core Components

| Component | Technology | Notes |
|-----------|------------|-------|
| **Primary Model** | Gemini 2.0 Flash Thinking | Reasoning for structured doc generation |
| **Critique Model** | GPT-4o | Adversarial review of PRDs |
| **Document Storage** | Notion / Confluence | Customer's choice |
| **Ticket System** | Jira / Linear | Customer's choice |

### MCP Servers

```yaml
ba-agent:
  mcps:
    - name: jira-mcp
      purpose: Create/update Jira issues, epics, stories
      repo: https://github.com/anthropic/jira-mcp
      capabilities:
        - Create epic
        - Create story with acceptance criteria
        - Link stories to epics
        - Update story status
        - Add comments

    - name: notion-mcp
      purpose: Create PRD documents in Notion
      repo: https://github.com/anthropic/notion-mcp
      capabilities:
        - Create page
        - Update page content
        - Create database entries
        - Link pages

    - name: confluence-mcp
      purpose: Alternative to Notion for enterprise
      repo: https://github.com/anthropic/confluence-mcp
      capabilities:
        - Create/update pages
        - Manage spaces
        - Attach files

    - name: linear-mcp
      purpose: Alternative to Jira
      repo: https://github.com/anthropic/linear-mcp
```

### Prompt Templates

```markdown
## PRD Generation Prompt
Given the following meeting transcript and extracted requirements:
{requirements}

Generate a Product Requirements Document with:
1. Executive Summary
2. Problem Statement
3. User Personas
4. Functional Requirements (numbered)
5. Non-Functional Requirements
6. Acceptance Criteria (Given/When/Then format)
7. Out of Scope
8. Open Questions

## User Story Prompt
Convert this requirement into a user story:
{requirement}

Format:
- Title: [Action-oriented title]
- As a [persona]
- I want [feature]
- So that [benefit]
- Acceptance Criteria:
  - Given [context]
  - When [action]
  - Then [expected result]
- Story Points: [1/2/3/5/8]
```

---

## 3. Dev Agent

### Purpose
Writes production code, creates GitHub PRs, runs tests, and deploys to staging.

### Core Components

| Component | Technology | Notes |
|-----------|------------|-------|
| **Primary Model** | Claude 3.5 Sonnet | Best code generation |
| **Review Models** | Gemini 2.0 Flash Thinking + GPT-4o | Triple-model consensus |
| **Architecture** | Claude + GPT-4o | Cross-questioning validation |
| **Code Execution** | Claude Code (CLI) | Agentic coding with tool use |
| **Version Control** | GitHub | PRs, code review |
| **Testing** | Playwright, Jest, pytest | Based on project stack |
| **CI/CD** | GitHub Actions | Automated pipelines |
| **Containerization** | Docker | Consistent environments |

### MCP Servers

```yaml
dev-agent:
  mcps:
    - name: github-mcp
      purpose: Full GitHub SDK access (Octokit)
      repo: https://github.com/anthropic/github-mcp
      capabilities:
        - Create/manage branches
        - Create pull requests
        - Review code
        - Merge PRs
        - Manage issues
        - Trigger workflows

    - name: filesystem-mcp
      purpose: Read/write project files
      repo: https://github.com/anthropic/filesystem-mcp
      capabilities:
        - Read files
        - Write files
        - Create directories
        - Search codebase

    - name: docker-mcp
      purpose: Build and run containers
      implementation: Custom
      capabilities:
        - Build images
        - Run containers
        - View logs
        - Manage networks

    - name: playwright-mcp
      purpose: E2E testing
      repo: https://github.com/anthropic/playwright-mcp
      capabilities:
        - Run tests
        - Take screenshots
        - Record traces
        - Generate test reports
```

### Claude Code Integration

```yaml
dev-agent-workflow:
  tool: Claude Code CLI
  mode: Agentic (autonomous with checkpoints)

  capabilities:
    - Read existing codebase
    - Understand project structure
    - Write new code following patterns
    - Run tests (npm test, pytest, etc.)
    - Fix failing tests
    - Create commits with proper messages
    - Push branches and create PRs

  safety_controls:
    - Never push to main/master
    - Always create feature branch
    - Run tests before PR
    - Require human approval for merge

  example_workflow:
    1. Receive user story from BA Agent
    2. Analyze codebase for patterns
    3. Create feature branch
    4. Implement feature
    5. Write unit tests
    6. Run test suite
    7. Fix any failures
    8. Create PR with description
    9. Request human review
```

### Testing Framework Selection

| Project Type | Unit Tests | Integration Tests | E2E Tests |
|--------------|------------|-------------------|-----------|
| React/Next.js | Jest + RTL | Jest | Playwright |
| Node.js API | Jest/Vitest | Supertest | Playwright |
| Python | pytest | pytest | Playwright |
| Python API | pytest | pytest + httpx | Playwright |

### Playwright Configuration

```typescript
// playwright.config.ts for Dev Agent
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results.json' }]
  ],
  use: {
    baseURL: process.env.STAGING_URL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
});
```

---

## 4. Sales Agent

### Purpose
Creates outreach emails, updates CRM, generates proposals, and manages sales pipeline.

### Core Components

| Component | Technology | Notes |
|-----------|------------|-------|
| **Primary Model** | Gemini 2.0 Flash Thinking | Persuasive writing & outreach |
| **Review Model** | GPT-4o | Tone & messaging validation |
| **CRM** | Salesforce / HubSpot | Customer's choice |
| **Email** | Gmail SDK / Outlook SDK | Via Google Workspace |
| **Documents** | Google Docs | Proposals, decks |

### MCP Servers

```yaml
sales-agent:
  mcps:
    - name: salesforce-mcp
      purpose: CRM operations
      repo: https://github.com/anthropic/salesforce-mcp
      capabilities:
        - Create/update contacts
        - Create/update opportunities
        - Log activities
        - Update pipeline stages
        - Generate reports

    - name: hubspot-mcp
      purpose: Alternative CRM
      repo: https://github.com/anthropic/hubspot-mcp
      capabilities:
        - Manage contacts
        - Manage deals
        - Send sequences
        - Track engagement

    - name: gmail-mcp
      purpose: Email operations
      repo: https://github.com/anthropic/gmail-mcp
      capabilities:
        - Send emails
        - Read emails
        - Create drafts
        - Manage labels

    - name: google-docs-mcp
      purpose: Proposal creation
      repo: https://github.com/anthropic/google-docs-mcp
      capabilities:
        - Create documents
        - Update content
        - Export to PDF
        - Share documents

    - name: google-slides-mcp
      purpose: Sales deck updates
      repo: https://github.com/anthropic/google-slides-mcp
```

### Email Templates

```markdown
## Feature Announcement Email
Subject: {feature_name} is now live - {company_benefit}

Hi {first_name},

Quick update: We just shipped {feature_name} based on feedback from teams like yours.

What it does:
- {benefit_1}
- {benefit_2}
- {benefit_3}

{personalized_note_based_on_their_use_case}

Want a quick walkthrough? [Calendar link]

Best,
{sender_name}
```

### CRM Automation Rules

```yaml
crm_triggers:
  - event: feature_shipped
    action: update_opportunities
    filter: opportunities with feature in notes
    update:
      - Add activity: "Feature {name} shipped"
      - Update stage if blocking

  - event: meeting_completed
    action: log_activity
    update:
      - Create activity with summary
      - Update next steps
      - Set follow-up task
```

---

## 5. Marketing Agent

### Purpose
Creates blog posts, social content, landing pages, and manages content calendar.

### Core Components

| Component | Technology | Notes |
|-----------|------------|-------|
| **Primary Model** | Gemini 2.0 Flash Thinking | Long-form content creation |
| **Review Model** | GPT-4o | SEO & engagement optimization |
| **Image Generation** | DALL-E 3 / Midjourney | Blog images, social graphics |
| **CMS** | WordPress / Webflow | Customer's choice |
| **Social** | Buffer / Hootsuite | Scheduling |
| **Design** | Figma | Templates |

### MCP Servers

```yaml
marketing-agent:
  mcps:
    - name: wordpress-mcp
      purpose: Blog management
      repo: https://github.com/anthropic/wordpress-mcp
      capabilities:
        - Create posts
        - Update posts
        - Manage categories/tags
        - Upload media
        - Schedule publishing

    - name: buffer-mcp
      purpose: Social media scheduling
      implementation: Custom via Buffer SDK
      capabilities:
        - Schedule posts
        - Multi-platform (LinkedIn, Twitter, Facebook)
        - Analytics retrieval

    - name: linkedin-mcp
      purpose: Direct LinkedIn posting
      implementation: Custom via LinkedIn SDK
      capabilities:
        - Create posts
        - Create articles
        - Manage company page

    - name: figma-mcp
      purpose: Design asset generation
      repo: https://github.com/anthropic/figma-mcp
      capabilities:
        - Read templates
        - Update text/images
        - Export assets

    - name: canva-mcp
      purpose: Alternative to Figma
      implementation: Custom via Canva SDK
```

### Content Templates

```markdown
## Blog Post Structure
1. Hook (problem statement)
2. Context (why this matters now)
3. Solution (our approach)
4. How it works (technical but accessible)
5. Results/Benefits
6. CTA

## LinkedIn Post Structure
- Hook line (pattern interrupt)
- 3-5 bullet points or short paragraphs
- CTA or question
- 3-5 relevant hashtags

## Feature Launch Sequence
Day 0: Teaser post
Day 1: Full announcement blog + LinkedIn
Day 2: Technical deep-dive (if applicable)
Day 3: Customer use case angle
Day 7: Results/early adoption post
```

---

## 6. Shared Infrastructure

### Memory & Context

```yaml
memory_layers:
  working_memory:
    technology: Redis
    ttl: 30 minutes
    use: Active task context

  short_term:
    technology: PostgreSQL
    ttl: 7 days
    use: Recent conversations, decisions

  long_term:
    technology: Qdrant
    ttl: 90 days
    use: Semantic search, similar tasks

  permanent:
    technology: S3
    ttl: Forever
    use: Artifacts, documents, code
```

### Shared Workspace

```yaml
workspace:
  artifacts:
    storage: S3
    types:
      - PRDs (Markdown/PDF)
      - Code (Git repos)
      - Designs (Figma exports)
      - Proposals (Google Docs)

  context:
    storage: Qdrant
    embeddings: text-embedding-3-large
    use: Semantic search across all artifacts

  task_graph:
    storage: PostgreSQL
    schema:
      - Tasks (id, type, status, agent, parent_task)
      - Dependencies (task_id, depends_on)
      - Artifacts (task_id, artifact_url, type)
```

### Agent Communication

```yaml
message_bus:
  technology: Amazon SQS + EventBridge

  events:
    - meeting.completed
    - prd.created
    - story.created
    - pr.created
    - pr.merged
    - feature.shipped
    - email.sent
    - content.published

  routing:
    meeting.completed → BA Agent (create PRD)
    prd.approved → Dev Agent (implement stories)
    pr.merged → Sales Agent (notify prospects)
    feature.shipped → Marketing Agent (announce)
```

### Agent Clarification System (Google Chat)

```yaml
clarification_system:
  purpose: Allow agents to ask employees/leadership for clarification when blocked
  channel: Google Chat SDK

  mcps:
    - name: google-chat-mcp
      purpose: Send/receive messages to team members
      repo: https://github.com/anthropic/google-chat-mcp
      capabilities:
        - Send direct messages
        - Create threaded conversations
        - Receive replies via webhook
        - Format rich messages with buttons

  triggers:
    - ambiguous_requirements: "Multiple valid interpretations detected"
    - missing_context: "Required information not in workspace"
    - conflicting_info: "Meeting notes contradict documentation"
    - high_risk_decision: "Confidence < 70% on critical path"
    - approval_needed: "Blocked waiting for human sign-off"

  smart_routing:
    technical_questions:
      recipients: [tech_lead, senior_dev]
      examples:
        - "Should OAuth use PKCE or implicit flow?"
        - "Is Redis Cluster or single-node preferred?"
    business_questions:
      recipients: [product_lead, ba_lead]
      examples:
        - "Should free tier include feature X?"
        - "Priority: mobile-first or desktop-first?"
    critical_decisions:
      recipients: [ceo, cto]
      examples:
        - "Budget approval for enterprise integration"
        - "Strategic pivot on product direction"

  message_format:
    template: |
      🤖 *{agent_name} needs your input*

      **Context:** {brief_context}
      **Question:** {specific_question}

      **Options:**
      A) {option_a}
      B) {option_b}

      _Reply with A, B, or your custom answer_
      _Task paused until response received_

    urgency_levels:
      - low: "No deadline, async response OK"
      - medium: "Blocking current task, 4h response preferred"
      - high: "Critical path blocker, immediate response needed"

  response_handling:
    - Parse human reply
    - Update task context with new information
    - Log decision with attribution
    - Resume agent workflow
    - Send confirmation: "Thanks! Resuming with your input."

  escalation:
    - after_4h: Send reminder
    - after_24h: Escalate to manager
    - after_48h: Auto-escalate to CEO with summary
```

### Memory Optimization Agent

```yaml
memory_optimizer:
  purpose: Continuously clean, compress, and optimize memory to prevent accumulation
  schedule: Every 6 hours + on-demand triggers
  model: Claude 3.5 Haiku  # Fast and cheap for summarization

  operations:
    - name: working_memory_cleanup
      target: Redis
      actions:
        - Expire stale sessions (no activity > 30 min)
        - Merge duplicate context entries
        - Compress verbose task states

    - name: short_term_compaction
      target: PostgreSQL
      actions:
        - Identify conversations older than 24h
        - Summarize verbose entries (50K → 2K tokens)
        - Archive raw data to S3
        - Keep summary + S3 reference

    - name: semantic_deduplication
      target: Qdrant
      actions:
        - Find near-duplicate vectors (cosine > 0.95)
        - Merge duplicates, keep highest quality
        - Update references to merged entries
        - Recompute embeddings for merged content

    - name: progressive_summarization
      target: All layers
      pipeline:
        - Level 1: 50K tokens → 2K (detailed summary)
        - Level 2: 2K → 500 (key points)
        - Level 3: 500 → 100 (headline)
        - Level 4: 100 → 20 (tags/keywords)
      retention:
        - L1: 7 days
        - L2: 30 days
        - L3: 90 days
        - L4: Forever

  triggers:
    - scheduled: "0 */6 * * *"  # Every 6 hours
    - memory_pressure: "> 80% capacity"
    - task_completion: "After major task chains complete"
    - manual: "Admin-triggered cleanup"

  safety_controls:
    - Never delete without backup to S3
    - Maintain audit trail of all compressions
    - Allow restoration from any compression level
    - Preserve all human decisions verbatim
    - Keep full context for active tasks

  metrics:
    - memory_saved_mb: Total MB reclaimed
    - compression_ratio: Original vs compressed size
    - retrieval_accuracy: Can we still answer questions?
    - restoration_success: Backup restore tests
```

### Memory Restoration Flow

```yaml
restoration:
  purpose: Recover full context when needed for complex tasks

  flow:
    1. Query arrives requiring deep context
    2. Check current memory level (L1-L4)
    3. If insufficient:
       - Fetch S3 backup reference
       - Restore to appropriate level
       - Cache in Redis for session
    4. Execute task with full context
    5. Re-compress after task completion

  smart_prefetch:
    - Predict context needs based on task type
    - Pre-load related summaries
    - Warm cache before agent handoffs

  example:
    trigger: "Dev Agent needs full PRD context"
    steps:
      - Check Qdrant for PRD summary (L2)
      - Insufficient for code generation
      - Fetch full PRD from S3 (L1)
      - Load into Redis for session
      - Dev Agent completes implementation
      - Compress back to L2 after PR merged
```

### Smart Caching (Minimize Restoration Costs)

```yaml
smart_caching:
  purpose: Avoid compression/restoration cycle for active workstreams

  access_pattern_analysis:
    # Track which tasks frequently need full context
    always_needs_L1:
      - code_generation
      - architecture_review
      - security_audit
      - complex_debugging
    L2_sufficient:
      - meeting_summary
      - email_drafting
      - status_updates
      - simple_queries

  adaptive_ttl:
    rules:
      - if access_count > 3 in 24h: extend_ttl to 7 days
      - if task_type == "development": skip_compression
      - if linked_to_open_pr: keep_L1 until merged
      - if active_sprint_item: never_compress
      - if no_access_30_days: eligible_for_compression

  predictive_prefetch:
    events:
      - before_standup: load all active project contexts
      - before_sprint_planning: load all epics from Jira
      - on_pr_review_request: load full PRD + related code
      - on_meeting_scheduled: load participant context + agenda items

  batch_restoration:
    purpose: Reduce S3 costs by grouping related fetches
    strategy:
      - group contexts by project_id
      - single S3 fetch for project bundle
      - restore to Redis as unit
      - cost_savings: ~40% vs individual fetches

  compression_rules:
    compress_aggressively:
      - completed_projects: "> 30 days inactive"
      - meeting_transcripts: "after PRD approved"
      - chat_logs: "after task marked done"
      - email_threads: "after reply sent"
    never_compress:
      - active_sprint_context
      - open_pr_discussions
      - unresolved_questions
      - pending_approvals

  cost_monitoring:
    metrics:
      - restoration_frequency_per_context
      - compression_to_restoration_ratio
      - cache_hit_rate
    alerts:
      - if restoration_rate > 3x/day: "Consider keeping at L1"
      - if cache_hit_rate < 70%: "Increase prefetch scope"
```

---

## 7. Model Selection Strategy

### Primary Model Assignments

| Agent | Primary Model | Secondary/Review Model | Reason |
|-------|---------------|------------------------|--------|
| Meeting Intelligence | Gemini 2.0 Flash | - | Fast real-time analysis |
| Question Generation | Claude 3.5 Sonnet | - | Better reasoning |
| BA Agent | Gemini 2.0 Flash Thinking | GPT-4o (critique) | Fast structured output + adversarial review |
| Dev Agent | Claude 3.5 Sonnet + Gemini 2.0 Flash Thinking + GPT-4o | All three (consensus) | Triple-model validation for code |
| Architecture Review | Claude 3.5 Sonnet | GPT-4o (cross-questioning) | Architecture validation |
| Sales Agent | Gemini 2.0 Flash Thinking | GPT-4o (refinement) | Persuasive writing + tone validation |
| Marketing Agent | Gemini 2.0 Flash Thinking | GPT-4o (optimization) | Content creation + SEO/engagement review |
| Memory Optimizer | Claude 3.5 Haiku | - | Fast, cheap summarization at scale |

### Validation Model

| Task Type | Validation Model | Cost Multiplier |
|-----------|------------------|-----------------|
| Low-risk (summaries) | None | 1.0x |
| Medium-risk (PRDs, code) | GPT-4o | 1.3x |
| High-risk (external comms) | GPT-4o + Gemini 2.0 | 2.5x |

### Fallback Chain

```yaml
fallback_chain:
  primary: Claude 3.5 Sonnet
  fallback_1: GPT-4o
  fallback_2: Gemini 2.0 Flash Thinking
  fallback_3: Claude 3.5 Haiku (degraded)

  triggers:
    - rate_limit_exceeded
    - api_error
    - latency > 30s
```

### Cost Optimization

```yaml
cost_rules:
  - task: simple_classification
    model: Claude 3.5 Haiku
    reason: Fast, cheap, accurate for simple tasks

  - task: code_generation
    model: Claude 3.5 Sonnet
    reason: Best quality, worth the cost

  - task: long_document_analysis
    model: Gemini 2.0 Flash Thinking
    reason: 1M context, cheaper for long docs

  - task: validation
    model: GPT-4o
    reason: Different perspective, catches issues
```

---

## 8. Implementation Priority

### Phase 1 (Weeks 1-8): Meeting Intelligence
- [ ] Google Meet SDK integration
- [ ] AWS Transcribe streaming
- [ ] Basic question generation
- [ ] Amazon Polly voice output

### Phase 2 (Weeks 9-16): BA + Dev Agents
- [ ] Jira MCP integration
- [ ] Claude Code integration
- [ ] GitHub MCP integration
- [ ] Playwright testing setup
- [ ] Google Chat MCP (agent clarification system)
- [ ] Memory Optimizer agent

### Phase 3 (Weeks 17-24): Sales + Marketing
- [ ] Salesforce/HubSpot MCP
- [ ] Gmail MCP
- [ ] WordPress MCP
- [ ] Buffer/LinkedIn MCP

### Phase 4 (Weeks 25-32): Optimization
- [ ] Multi-model consensus
- [ ] Cost optimization
- [ ] Confidence-based handoffs
- [ ] Full workflow automation

---

## 9. Secrets & Customer Keys Storage

### Storage Architecture

| Secret Type | Storage Location | Encryption | Access Method |
|------------|------------------|------------|---------------|
| AWS Access Keys | AWS Secrets Manager | AES-256 | IAM role assumption |
| OAuth Tokens (Google, Slack) | Encrypted DB + Secrets Manager | Per-tenant key | Token refresh service |
| API Keys (OpenAI, Anthropic) | AWS Secrets Manager | AES-256 | IAM-based access |
| Database Credentials | AWS Secrets Manager | AES-256 | Environment injection |
| Customer MCP Configs | Tenant-isolated PostgreSQL | Per-tenant encryption | Service auth only |

### Security Principles

```yaml
secrets_management:
  storage:
    primary: AWS Secrets Manager
    backup: HashiCorp Vault (enterprise option)

  encryption:
    at_rest: AES-256-GCM
    in_transit: TLS 1.3
    key_derivation: PBKDF2 with tenant-specific salt

  access_controls:
    - IAM roles with least privilege
    - No static credentials in code
    - Audit logging on every access
    - Time-limited session tokens

  tenant_isolation:
    method: Separate encryption keys per tenant
    key_storage: AWS KMS (customer-managed keys option)
    rotation: Automatic every 90 days

  rotation_policy:
    oauth_tokens: Auto-refresh before expiry
    api_keys: 90-day rotation with grace period
    database_creds: 30-day rotation

  audit_trail:
    storage: CloudWatch Logs + S3 (immutable)
    retention: 2 years
    alerts:
      - Unusual access patterns
      - Access from new IP ranges
      - Failed authentication attempts
```

### Environment Injection Pattern

```python
# Secrets are never in code - always injected at runtime
class SecretsLoader:
    def __init__(self, tenant_id: str):
        self.secrets_client = boto3.client('secretsmanager')
        self.tenant_id = tenant_id

    async def get_api_key(self, service: str) -> str:
        """Get API key for a service - never cached in memory long-term"""
        secret_id = f"workforce0/{self.tenant_id}/{service}"
        response = await self.secrets_client.get_secret_value(SecretId=secret_id)
        return response['SecretString']

    async def get_oauth_token(self, integration: str) -> str:
        """Get OAuth token, auto-refresh if near expiry"""
        token_data = await self._get_secret(f"oauth/{integration}")
        if self._is_near_expiry(token_data):
            token_data = await self._refresh_token(integration, token_data)
        return token_data['access_token']
```

### Zero-Trust Agent Credentials

```yaml
agent_credentials:
  principle: Agents never hold permanent credentials

  flow:
    1. Agent requests access to customer resource
    2. Control plane validates agent identity + task scope
    3. Issue short-lived credential (15-60 min TTL)
    4. Agent uses credential for specific operation
    5. Credential auto-expires
    6. All actions logged with agent + task ID

  scope_limitations:
    - Credentials scoped to specific resources
    - Read-only unless task requires write
    - IP/region restrictions where supported
    - Rate limits per credential
```

---

## 10. Cost Estimation & Deployment Approval

Before executing any deployment or infrastructure changes, agents MUST:
1. Calculate estimated costs
2. Present breakdown to user
3. Request explicit approval

See [Cost Estimation Guide](./cost-estimation-guide.md) for full details.

### Quick Reference: Approval Thresholds

| Monthly Cost | Approval Level |
|-------------|----------------|
| < $25 | Auto-approve (notification only) |
| $25 - $100 | Standard chat approval |
| $100 - $500 | Detailed breakdown required |
| > $500 | Manager approval + justification |

### Integration with Agent Clarification System

```yaml
cost_approval_flow:
  trigger: deployment_request

  steps:
    1. Agent analyzes infrastructure requirements
    2. Query AWS Pricing API for current rates
    3. Calculate monthly + first-month estimate
    4. Check against tenant budget limits
    5. Generate approval message via Google Chat
    6. Wait for user response
    7. Execute or modify based on response

  message_template: |
    📊 **Deployment Cost Estimate**

    I've analyzed your deployment requirements:

    **Infrastructure:**
    {component_breakdown}

    **Estimated Monthly Cost: ${monthly_total}**
    **First Month (incl. setup): ${first_month_total}**

    Do you want me to proceed?
    ✅ Yes, deploy
    🔧 Modify resources
    ❌ Cancel

  budget_exceeded_template: |
    🚫 **Budget Limit Exceeded**

    This deployment would cost **${estimate}/month**
    Your budget limit is **${limit}/month**

    Options:
    1. Increase budget in settings
    2. Choose smaller configuration (~${alternative}/mo)

    What would you like to do?
```

---

## 11. Integration Settings

Customers configure which SaaS tools agents use through the integration settings system. This allows customers to choose their preferred providers (e.g., Zoom vs Google Meet, Slack vs Google Chat).

See [Integration Settings Guide](./integration-settings-guide.md) for full details.

### Quick Reference: Supported Providers

| Category | Providers |
|----------|-----------|
| Meetings | Google Meet, Zoom, Teams, Webex |
| Communication | Slack, Google Chat, Teams |
| Project Management | Jira, Linear, Asana, Monday |
| Documentation | Confluence, Notion, Coda |
| Code Repos | GitHub, GitLab, Bitbucket |
| Email/Calendar | Google Workspace, Microsoft 365 |
| CRM | Salesforce, HubSpot, Pipedrive |

### How Agents Use Integration Settings

```python
# Agents NEVER call SaaS APIs directly
# They use the ConnectorRouter which reads tenant settings

class BaseAgent:
    def __init__(self, tenant_id: str, connector_router: ConnectorRouter):
        self.tenant_id = tenant_id
        self.router = connector_router

    async def send_notification(self, message: str):
        # Router checks tenant settings and routes to Slack/GChat/Teams
        await self.router.send_notification(
            tenant_id=self.tenant_id,
            message=message,
            channel_type="notifications"
        )

    async def create_task(self, title: str, description: str):
        # Router checks tenant settings and routes to Jira/Linear/Asana
        await self.router.create_task(
            tenant_id=self.tenant_id,
            title=title,
            description=description
        )
```

### Configuration Methods

1. **Admin Dashboard** - Web UI at Settings → Integrations
2. **Config-as-Code** - `.workforce0/integrations.yaml` in repo
3. **API** - `PATCH /api/v1/tenants/{id}/integrations`

---

## Appendix: MCP Server Status

| MCP | Status | Notes |
|-----|--------|-------|
| github-mcp | Available | Official Anthropic |
| filesystem-mcp | Available | Official Anthropic |
| google-calendar-mcp | Available | Community |
| google-chat-mcp | Build | Agent clarification system |
| jira-mcp | Available | Community |
| notion-mcp | Available | Community |
| playwright-mcp | Available | Official Anthropic |
| salesforce-mcp | Build | Need to implement |
| hubspot-mcp | Build | Need to implement |
| gmail-mcp | Available | Community |
| wordpress-mcp | Build | Need to implement |
| buffer-mcp | Build | Need to implement |
| google-meet-mcp | Build | Custom implementation |
| aws-transcribe-mcp | Build | Custom implementation |
