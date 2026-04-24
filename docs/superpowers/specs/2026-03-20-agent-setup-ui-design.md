# Agent Setup UI + Onboarding

**Date:** 2026-03-20
**Status:** Approved
**Sub-project:** 4 of 4 (Agent Architecture Rebuild)

## Overview

Add agent management UI to the Settings page and update the onboarding wizard. Uses a hybrid approach: guided setup wizard when no agents are connected, dashboard view once agents are online.

## Two UI States

### State 1: No Agent Connected (Guided Setup)

A 3-step wizard card:

1. **Generate Token** — button creates a token, shows it with copy button. Token displayed once (masked after page reload).
2. **Install Agent** — shows the `npx workforce0-agent` command pre-filled with the generated token.
3. **Waiting for Connection** — polls agent status, auto-transitions to State 2 when agent connects. Shows a subtle loading spinner.

### State 2: Agent Connected (Dashboard)

Two sections:

**Connected Agents:**
- List of connected agents with green/gray status dots
- Each shows: name, repos, capabilities, active jobs count, connected time
- Data from `GET /api/agents/status`

**Agent Tokens:**
- List of tokens (hint only, never raw)
- Create new token button
- Revoke button per token
- Last used timestamp
- Data from `GET /api/agents/tokens`

**Recent Jobs** (optional footer):
- Last 5 jobs with status badges (done/running/failed)
- Action, title, time ago
- Data from `GET /api/agents/jobs?limit=5`

## Files to Create/Modify

### New Files
```
frontend/src/components/agent-setup-wizard.tsx      # State 1: guided 3-step setup
frontend/src/components/agent-dashboard.tsx          # State 2: connected agents + tokens + jobs
```

### Modified Files
```
frontend/src/app/(dashboard)/settings/page.tsx      # Add Agent section (switches between states)
frontend/src/lib/api.ts                              # Add agent API methods
frontend/src/components/onboarding-wizard.tsx        # Update step 4 (connect tools) to mention agent setup
```

## API Methods to Add (frontend/src/lib/api.ts)

```typescript
// Agent tokens
async createAgentToken(name: string) {
  return this.post<{ token: string; tokenHint: string; name: string }>('/api/agents/tokens', { name });
}
async listAgentTokens() {
  return this.get<{ tokens: AgentToken[] }>('/api/agents/tokens');
  // Response: { success: true, data: { tokens: [...] } }
  // Revoked tokens included (revokedAt !== null) — show with "Revoked" badge, hide revoke button
}
async revokeAgentToken(id: string) {
  return this.delete<{ message: string }>(`/api/agents/tokens/${id}`);
}

// Agent status
async getAgentStatus() {
  return this.get<{ agents: AgentStatusInfo[]; connected: number }>('/api/agents/status');
}

// Agent jobs (NOTE: backend needs limit param added — hardcoded to 50 currently)
async getAgentJobs(params?: { status?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.limit) query.set('limit', String(params.limit));
  return this.get<AgentJob[]>(`/api/agents/jobs?${query}`);
}

// Types
interface AgentToken {
  id: string;
  name: string;
  tokenHint: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface AgentStatusInfo {
  agentId: string;
  repos: string[];
  capabilities: string[];
  activeJobs: number;
  maxActiveJobs: number;
  connectedAt: string;
  lastPingAt: string;
}

interface AgentJob {
  id: string;
  action: string;
  status: string;  // pending, dispatched, in_progress, done, failed
  targetRepo: string;
  result: any;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
```

**Backend fix required:** Add `limit` query param support to `GET /api/agents/jobs` in `agent-hub.routes.ts` (currently hardcoded to 50). This is a one-line change.

## SSE Integration

The settings page subscribes to SSE events for real-time updates:
- `agent_job.status_changed` — update job status badges without polling
- Poll `GET /api/agents/status` every 30 seconds for agent connection changes (WebSocket status is not directly available via SSE)

## Onboarding Wizard Update

Step 4 ("Connect More Tools") already exists. Add an "AI Agent" option alongside the existing integration cards:

```
Connect your tools:
☐ Google Meet — auto-detect recordings
☐ Jira — sync tickets from briefs
☐ AI Agent — connect your coding agent  ← NEW
```

Clicking "AI Agent" opens the setup wizard inline (same component as State 1 in Settings).

## Error + Loading States

### Wizard (State 1)
- **Token creation fails:** Toast error with retry. Button stays enabled.
- **Waiting for connection (Step 3):** Poll `GET /api/agents/status` every 5 seconds. After 5 minutes with no connection, show: "Agent not detected. Check the terminal where you ran the command. [Try Again] [Skip for now]"
- **Network error during polling:** Show inline warning, keep polling.

### Dashboard (State 2)
- **Loading:** Each section loads independently with a skeleton card (same pattern as existing Settings cards).
- **Agent status fetch fails:** Show "Unable to load agent status" with retry button.
- **Token revocation:** Confirmation dialog (Radix AlertDialog): "Revoke token '{name}'? Any agent using this token will be immediately disconnected." [Cancel] [Revoke]
- **Revoked tokens:** Show in the list with dimmed style, "Revoked" badge, no revoke button.

### Empty States
- **No agents, no tokens:** Shows State 1 (wizard)
- **Agents connected, no jobs:** "No jobs yet — jobs will appear here once your agent starts working."

## Accessibility

- Status dots (green/gray) include `aria-label="Connected"` / `aria-label="Disconnected"`
- Wizard steps use `aria-current="step"` for screen readers
- All buttons have descriptive labels
- Token copy button announces "Copied to clipboard" via `aria-live="polite"`

## Design Patterns

Follow existing Settings page patterns:
- Card-based layout with CardHeader/CardContent
- Integration cards with status badges
- Radix UI components (Dialog for token creation, Button, Input)
- Toast notifications for success/error
- Same color palette (accent, ink-tertiary, emerald for success, rose for errors)

## What This Sub-Project Does NOT Include

- Real-time WebSocket status in browser (uses polling + SSE instead)
- Agent log streaming
- Job detail page (just status badges in the list)
- Token rotation/expiry policies
