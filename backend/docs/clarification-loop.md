# PRD Clarification Loop Architecture

## Overview

The Clarification Loop is a core feature of Workforce0's BA Agent that enables **human-in-the-loop feedback** when the AI-generated PRD has open questions or low confidence. This creates an iterative refinement process where stakeholders can provide answers via Google Chat, and the PRD is automatically updated.

## Why This Matters

1. **AI Limitations**: AI cannot always extract all requirements from a meeting transcript
2. **Missing Context**: Some decisions require human judgment or business knowledge
3. **Quality Assurance**: Human review ensures PRDs meet business needs
4. **Iterative Refinement**: Multiple rounds improve PRD quality

## System Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLARIFICATION LOOP FLOW                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐    │
│  │  Meeting     │────>│  BA Agent    │────>│  PRD Generated       │    │
│  │  Transcript  │     │  Processes   │     │  (with open          │    │
│  └──────────────┘     └──────────────┘     │   questions)         │    │
│                                            └──────────┬───────────┘    │
│                                                       │                 │
│                                                       ▼                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  IF openQuestions.length > 0 OR confidence < 70%                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐    │
│  │  Google Chat │<────│  Notify      │<────│  Create Clarification│    │
│  │  Space       │     │  Stakeholders│     │  Request             │    │
│  └──────────────┘     └──────────────┘     └──────────────────────┘    │
│         │                                                               │
│         │  User replies: "Q1: Use OAuth2 for auth"                     │
│         ▼                                                               │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐    │
│  │  Webhook     │────>│  Parse       │────>│  Store Answer        │    │
│  │  Receives    │     │  Response    │     │  in Database         │    │
│  └──────────────┘     └──────────────┘     └──────────────────────┘    │
│                                                       │                 │
│                                                       ▼                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐    │
│  │  Updated     │<────│  AI Council  │<────│  Regenerate PRD      │    │
│  │  Google Doc  │     │  Reviews     │     │  with Answers        │    │
│  └──────────────┘     └──────────────┘     └──────────────────────┘    │
│                                                       │                 │
│                                                       ▼                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  IF more questions remain → LOOP BACK                            │  │
│  │  ELSE → Mark PRD as "approved" or "review"                       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Participant Routing

Questions are routed to the right meeting participant based on their role/persona.

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PARTICIPANT ROUTING                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Meeting Participants              Question Analysis                         │
│  ───────────────────              ──────────────────                         │
│  • Alice (PM) ──────────────┐                                               │
│  • Bob (Tech Lead) ─────┐   │     Q1: "Which auth method?"                  │
│  • Carol (Designer) ─┐  │   │         → Product question → Alice (PM)       │
│                      │  │   │                                                │
│                      │  │   │     Q2: "Database performance target?"        │
│                      │  │   └───→ Technical question → Bob (Tech Lead)      │
│                      │  │                                                    │
│                      │  │         Q3: "Login screen layout?"                │
│                      │  └───────→ Design question → Carol (Designer)        │
│                      │                                                       │
│                      └─────────→ (fallback if no match)                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Role Detection

Roles are inferred from multiple sources:

| Source | Example | Priority |
|--------|---------|----------|
| **Manual mapping** | `"alice@co.com": "product_lead"` | Highest |
| **Job title keywords** | "Product Manager" → `product_lead` | High |
| **Name patterns** | "John (PM)" → `product_lead` | Medium |
| **AI inference** | Speaking about requirements → `product_lead` | Low |

### Supported Personas

| Persona | Routes To | Example Keywords |
|---------|-----------|------------------|
| `product_lead` | Product Manager, PO | priority, requirements, scope, timeline |
| `tech_lead` | Tech Lead, Architect | architecture, API, database, performance |
| `engineering` | Developers | implementation, code, build |
| `design` | UX/UI Designers | UI, UX, mockup, layout, visual |
| `qa` | QA Engineers | test, validation, edge case |
| `executive` | VP, C-level | budget, strategy, approval |
| `stakeholder` | Default fallback | general questions |

### Configuring Role Mappings

Per-tenant role mappings in `tenant.settings`:

```typescript
{
  "roleMappings": {
    // Explicit email → role mappings
    "emailToRole": {
      "alice@company.com": "product_lead",
      "bob@company.com": "tech_lead",
      "carol@company.com": "design"
    },
    // Additional title keywords
    "titleKeywords": {
      "scrum master": "product_lead",
      "devops": "engineering"
    },
    // Default for unknown participants
    "defaultRole": "stakeholder"
  }
}
```

### Chat Message Format

Questions are grouped by target:

```
*Clarification Needed: User Authentication PRD*

The following questions need input from meeting participants:

*For Alice* (product_lead):
  Q1. Which authentication method should we use?
  Q3. What is the priority of SSO integration?

*For Bob* (tech_lead):
  Q2. What is the target response time for auth requests?
  Q4. Should we support WebAuthn?

*For all participants*:
  Q5. Any compliance requirements we should consider?

─────────────────────────────────
Reply with: "Q1: [your answer]"

View PRD: https://docs.google.com/document/d/xxx
```

## Components

### 1. Clarification Request (BA Agent → Google Chat)

When a PRD has open questions, the BA Agent sends a notification to Google Chat:

```typescript
// Example: Sending clarification request
await gchatService.sendClarificationQuestions({
  prdId: 'prd-123',
  title: 'User Authentication Feature',
  questions: [
    { id: 'Q1', text: 'Which authentication method should we use?' },
    { id: 'Q2', text: 'What is the target response time for auth requests?' },
  ],
  documentUrl: 'https://docs.google.com/document/d/xxx',
  threadKey: 'prd-clarify-123',
});
```

**Google Chat Message Format:**

```
╔══════════════════════════════════════════════════════════════╗
║  🔔 Clarification Needed: User Authentication Feature        ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  The following questions need your input:                    ║
║                                                              ║
║  Q1. Which authentication method should we use?              ║
║  Q2. What is the target response time for auth requests?     ║
║                                                              ║
║  ───────────────────────────────────────────────────────────║
║  📝 How to respond:                                          ║
║  Reply to this thread with "Q1: [your answer]"               ║
║                                                              ║
║  [View PRD]  [View Document]                                 ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### 2. Response Collection (Google Chat → Webhook)

Stakeholders reply in the Google Chat thread:

```
User: Q1: Use OAuth2 with JWT tokens. Support Google and Microsoft SSO.
User: Q2: Target 200ms for 95th percentile.
```

The webhook handler parses these responses:

```typescript
// POST /api/webhooks/gchat
{
  "type": "MESSAGE",
  "message": {
    "text": "Q1: Use OAuth2 with JWT tokens. Support Google and Microsoft SSO.",
    "thread": { "name": "prd-clarify-123" },
    "sender": { "email": "pm@company.com" }
  }
}
```

### 3. Answer Storage (Database)

Answers are stored and linked to the PRD:

```sql
-- Table: clarification_responses
| id       | prd_id   | question_id | answer                              | answered_by         | answered_at         |
|----------|----------|-------------|-------------------------------------|---------------------|---------------------|
| resp-1   | prd-123  | Q1          | Use OAuth2 with JWT tokens. Supp... | pm@company.com      | 2024-01-15 10:30:00 |
| resp-2   | prd-123  | Q2          | Target 200ms for 95th percentile.   | pm@company.com      | 2024-01-15 10:32:00 |
```

### 4. PRD Regeneration (BA Agent)

Once answers are received, the BA Agent regenerates the PRD:

```typescript
// Regeneration prompt includes original transcript + answers
const revisedPRD = await baAgent.revisePRDWithAnswers(prdId, {
  answers: [
    { questionId: 'Q1', answer: 'Use OAuth2 with JWT tokens...' },
    { questionId: 'Q2', answer: 'Target 200ms for 95th percentile.' },
  ],
});
```

The AI receives context like:

```
ORIGINAL TRANSCRIPT:
[Meeting discussion about authentication...]

CLARIFICATION ANSWERS PROVIDED BY STAKEHOLDERS:

Q1: Which authentication method should we use?
ANSWER: Use OAuth2 with JWT tokens. Support Google and Microsoft SSO.

Q2: What is the target response time for auth requests?
ANSWER: Target 200ms for 95th percentile.

Please regenerate the PRD incorporating these answers.
```

### 5. Google Doc Update

The updated PRD is either:
- **Option A**: Update the existing Google Doc (track changes)
- **Option B**: Create a new version with "v2" suffix

```typescript
// Update existing document
await googleDocsService.updatePRDDocument(documentId, revisedPRD);

// The open questions section now shows answered questions:
// Q1. Which authentication method? ✅ OAuth2 with JWT tokens
// Q2. Target response time? ✅ 200ms for 95th percentile
```

## Database Schema

### Table: `clarification_requests`

Tracks open clarification requests:

```sql
CREATE TABLE clarification_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prd_id          UUID REFERENCES prds(id),
  thread_key      VARCHAR(255) NOT NULL,
  questions       JSONB NOT NULL,  -- [{id: 'Q1', text: '...'}]
  status          VARCHAR(50) DEFAULT 'pending',  -- pending, partial, complete
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

### Table: `clarification_responses`

Stores individual answers:

```sql
CREATE TABLE clarification_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      UUID REFERENCES clarification_requests(id),
  question_id     VARCHAR(50) NOT NULL,
  answer          TEXT NOT NULL,
  answered_by     VARCHAR(255),  -- email or user identifier
  answered_at     TIMESTAMP DEFAULT NOW()
);
```

## API Endpoints

### Webhook Endpoint

```
POST /api/webhooks/gchat
```

Receives Google Chat messages and routes them to appropriate handlers.

**Request Body (from Google Chat):**
```json
{
  "type": "MESSAGE",
  "message": {
    "name": "spaces/xxx/messages/yyy",
    "text": "Q1: Use OAuth2 with JWT tokens",
    "thread": {
      "name": "spaces/xxx/threads/prd-clarify-123"
    },
    "sender": {
      "name": "users/123456",
      "displayName": "John PM",
      "email": "john@company.com"
    }
  }
}
```

### Submit Answer Endpoint

For programmatic answer submission (alternative to chat):

```
POST /api/agents/prds/:prdId/clarify
```

**Request Body:**
```json
{
  "answers": [
    { "questionId": "Q1", "answer": "Use OAuth2 with JWT tokens" },
    { "questionId": "Q2", "answer": "200ms target" }
  ]
}
```

## Response Parsing

The webhook parses various response formats:

| Format | Example | Parsed As |
|--------|---------|-----------|
| `Q1: answer` | `Q1: Use OAuth2` | Question Q1 = "Use OAuth2" |
| `Q1 - answer` | `Q1 - Use OAuth2` | Question Q1 = "Use OAuth2" |
| `1. answer` | `1. Use OAuth2` | Question Q1 = "Use OAuth2" |
| Free text | `The auth should use OAuth2` | Best-effort match or prompt for clarification |

## Configuration

### Environment Variables

```bash
# Google Chat webhook for RECEIVING messages (set up in Google Cloud)
GCHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/xxx/messages?key=xxx

# Webhook verification token (for incoming webhook security)
GCHAT_WEBHOOK_VERIFY_TOKEN=your-secret-token

# Auto-regenerate PRD when all questions answered
AUTO_REGENERATE_ON_COMPLETE=true

# Maximum clarification iterations before requiring human review
MAX_CLARIFICATION_ITERATIONS=3
```

## Status Flow

```
PRD Status Flow with Clarification:

  ┌─────────────┐
  │   draft     │  Initial PRD generated
  └──────┬──────┘
         │
         ▼
  ┌─────────────────────┐
  │ needs_clarification │  Open questions exist
  └──────────┬──────────┘
             │
   ┌─────────┴─────────┐
   │                   │
   ▼                   ▼
┌──────┐         ┌──────────┐
│review│         │clarifying│  Answers being collected
└───┬──┘         └────┬─────┘
    │                 │
    │    ┌────────────┘
    │    │  (answers received, PRD regenerated)
    │    ▼
    │  ┌─────────────┐
    │  │   review    │  Regenerated PRD pending review
    │  └──────┬──────┘
    │         │
    └────┬────┘
         │
         ▼
  ┌─────────────┐
  │  approved   │  Final PRD
  └─────────────┘
```

## Timeout & Escalation

What happens if a stakeholder doesn't respond to clarification requests?

### Timeout Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLARIFICATION TIMEOUT FLOW                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Hour 0       Hour 24         Hour 48           Hour 72                     │
│    │             │               │                 │                         │
│    ▼             ▼               ▼                 ▼                         │
│  ┌───┐       ┌───────┐      ┌──────────┐     ┌─────────────┐               │
│  │NEW│──────>│REMIND │─────>│ REMIND   │────>│ EXPIRE OR   │               │
│  │   │       │  #1   │      │ #2 +     │     │ AUTO-APPROVE│               │
│  └───┘       └───────┘      │ ESCALATE │     └─────────────┘               │
│    │                        └──────────┘                                    │
│    │                              │                                          │
│    └──────────[User Responds]─────┘                                         │
│                    │                                                         │
│                    ▼                                                         │
│              ┌───────────┐                                                  │
│              │ REGENERATE│                                                  │
│              │    PRD    │                                                  │
│              └───────────┘                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Default Timeline

| Time | Action | Description |
|------|--------|-------------|
| 0h | **Create** | Clarification request created, sent to Google Chat |
| 24h | **Reminder #1** | Gentle reminder in the same thread |
| 48h | **Reminder #2 + Escalate** | Urgent reminder, escalate to manager/backup |
| 72h | **Expire or Auto-Approve** | Based on tenant configuration |

### Configuration Options

Timeout behavior is configurable per tenant via settings:

```typescript
// Tenant settings (stored in tenant.settings JSON)
{
  "clarificationTimeout": {
    "reminderIntervalHours": 24,     // Hours between reminders (default: 24)
    "maxReminders": 2,               // Maximum reminder count (default: 2)
    "escalateAfterHours": 48,        // When to escalate (default: 48)
    "autoApproveAfterHours": 72,     // Auto-approve threshold (null = disabled)
    "escalationEmail": "manager@co", // Who to escalate to
    "proceedWithAssumptions": false  // If true, proceed with AI assumptions
  }
}
```

### Reminder Notifications

**First Reminder (24h):**
```
⏰ *Reminder*

Your input is needed for *User Authentication Feature*.
_Waiting for 1 day_

*Question:*
Which authentication method should we use?

Reply with your answer: "Q1: [your response]"
```

**Second Reminder + Escalation (48h):**
```
🚨 *URGENT REMINDER*

Your input is needed for *User Authentication Feature*.
_Waiting for 2 days_

*Question:*
Which authentication method should we use?

Reply with your answer: "Q1: [your response]"

_This will be escalated if not answered soon._
```

**Escalation Card:**
```
╔═══════════════════════════════════════════════════════════════╗
║  🚨 Escalation: Clarification Needed                          ║
╠═══════════════════════════════════════════════════════════════╣
║                                                                ║
║  A clarification request has been waiting for *2 days*        ║
║  without response.                                             ║
║                                                                ║
║  Question:                                                     ║
║  Which authentication method should we use?                    ║
║                                                                ║
║  Originally Assigned To: product_lead                          ║
║                                                                ║
║  _Please respond or assign to the appropriate person._         ║
╚═══════════════════════════════════════════════════════════════╝
```

### Auto-Approve with Assumptions

If `proceedWithAssumptions: true` and `autoApproveAfterHours` is set:

1. The clarification request is marked as "expired"
2. A system note is added: `[AUTO-ASSUMED] No response received after 3 days`
3. The PRD proceeds with AI-generated assumptions
4. Stakeholders are notified to review the assumptions

```
╔═══════════════════════════════════════════════════════════════╗
║  ⚡ PRD Auto-Approved                                          ║
║  User Authentication Feature                                    ║
╠═══════════════════════════════════════════════════════════════╣
║                                                                ║
║  The PRD has been auto-approved with AI-generated assumptions  ║
║  after *3 days* without clarification.                        ║
║                                                                ║
║  _Please review the document to verify assumptions._           ║
║                                                                ║
║  Unanswered Question:                                          ║
║  Which authentication method should we use?                    ║
║                                                                ║
╚═══════════════════════════════════════════════════════════════╝
```

### Expiration (No Auto-Approve)

If `proceedWithAssumptions: false`:

1. The clarification request is marked as "expired"
2. The PRD remains in "draft" status
3. Requires manual intervention to proceed

```
⚠️ *Clarification Request Expired*

The clarification request for *User Authentication Feature* has
expired without a response.

The PRD will remain in draft status until manually reviewed.
```

### API for Manual Override

Admins can manually expire, extend, or reassign clarification requests:

```
POST /api/agents/clarifications/:id/extend
{ "additionalHours": 48 }

POST /api/agents/clarifications/:id/reassign
{ "assignTo": "other-pm@company.com" }

POST /api/agents/clarifications/:id/expire
{ "reason": "Stakeholder on vacation" }
```

## Security Considerations

1. **Webhook Verification**: Verify incoming webhooks are from Google Chat
2. **Thread Isolation**: Only accept answers for the specific thread
3. **User Authorization**: Verify respondent has permission to answer
4. **Rate Limiting**: Prevent spam answers
5. **Input Validation**: Sanitize all user input before storing

## Error Handling

| Error | Handling |
|-------|----------|
| Unrecognized question format | Send help message with format examples |
| Invalid PRD/thread | Log and ignore |
| Webhook timeout | Retry with exponential backoff |
| AI regeneration fails | Keep existing PRD, notify admin |
| All iterations exhausted | Move to manual review |

## Monitoring & Logging

Key metrics to track:

- Clarification requests sent per PRD
- Average response time (request → first answer)
- Questions answered vs. unanswered ratio
- Regeneration success rate
- User engagement (who answers, how often)

## Future Enhancements

1. **Slack Integration**: Support Slack as alternative to Google Chat
2. **Email Fallback**: Send questions via email if chat unavailable
3. **Smart Suggestions**: AI suggests likely answers based on context
4. **Batch Questions**: Combine related questions to reduce noise
5. **Approval Workflow**: Require multiple stakeholders to agree

## Code References

- Clarification sending: [gchat.service.ts](../src/services/integrations/gchat.service.ts)
- Response handling: [gchat-webhook.handler.ts](../src/routes/webhooks/gchat-webhook.handler.ts)
- PRD revision: [ba-agent.service.ts](../src/services/agent/ba-agent.service.ts)
- Google Docs update: [gdocs.service.ts](../src/services/integrations/gdocs.service.ts)
