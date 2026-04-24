# Agent Setup UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add agent management UI to the Settings page — guided setup wizard when no agents connected, dashboard view with token management and live agent status after connection.

**Architecture:** Two new React components (wizard + dashboard) conditionally rendered on the Settings page based on agent connection status. API client methods call the existing REST endpoints. SSE events provide real-time job updates. Backend gets a one-line fix for the `limit` query param.

**Tech Stack:** Next.js 16, React, Radix UI (Dialog, AlertDialog), Tailwind CSS v4, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-20-agent-setup-ui-design.md`

---

## File Structure

### New Files

```
frontend/src/components/agent-setup-wizard.tsx    # State 1: guided 3-step setup
frontend/src/components/agent-dashboard.tsx        # State 2: connected agents + tokens + jobs
```

### Modified Files

```
frontend/src/lib/api.ts                            # Add agent API methods + types
frontend/src/app/(dashboard)/settings/page.tsx     # Add Agent section switching between states
mvp/src/routes/agent-hub.routes.ts                 # Add limit query param to GET /jobs
```

---

## Task 1: Backend Fix — Add limit Query Param

**Files:**
- Modify: `mvp/src/routes/agent-hub.routes.ts`

- [ ] **Step 1: Read the GET /jobs endpoint and add limit support**

Find the `GET /jobs` handler. Currently it hardcodes `take: 50`. Change to read `limit` from query:

```typescript
const limit = Math.min(parseInt((request.query as any).limit || '50', 10), 100);
// ... in findMany:
take: limit,
```

- [ ] **Step 2: Verify backend builds**

Run: `cd mvp && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add mvp/src/routes/agent-hub.routes.ts
git commit -m "fix: add limit query param to GET /agents/jobs endpoint"
```

---

## Task 2: Frontend API Methods + Types

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Read existing api.ts to understand patterns**

Look for how other methods are structured (e.g., `getMeetings`, `getSettings`). Follow the same `this.get<T>()` / `this.post<T>()` pattern.

- [ ] **Step 2: Add types at the top of the file (or in the types section)**

```typescript
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
  status: string;
  targetRepo: string;
  result: any;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
```

- [ ] **Step 3: Add API methods to the ApiClient class**

```typescript
// Agent tokens
async createAgentToken(name: string) {
  return this.post<{ token: string; tokenHint: string; name: string; id: string }>("/api/agents/tokens", { name });
}

async listAgentTokens() {
  return this.get<{ tokens: AgentToken[] }>("/api/agents/tokens");
}

async revokeAgentToken(id: string) {
  return this.delete<{ message: string }>(`/api/agents/tokens/${id}`);
}

// Agent status
async getAgentStatus() {
  return this.get<{ agents: AgentStatusInfo[]; connected: number }>("/api/agents/status");
}

// Agent jobs
async getAgentJobs(params?: { status?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return this.get<AgentJob[]>(`/api/agents/jobs${qs ? `?${qs}` : ""}`);
}
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd frontend && npx next build 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add agent token, status, and job API methods to frontend client"
```

---

## Task 3: Agent Setup Wizard Component (State 1)

**Files:**
- Create: `frontend/src/components/agent-setup-wizard.tsx`

- [ ] **Step 1: Create the wizard component**

A "use client" component that renders a 3-step guided setup:

**Props:**
```typescript
interface AgentSetupWizardProps {
  onAgentConnected: () => void;  // Called when polling detects an agent
}
```

**Step 1 — Generate Token:**
- Button "Generate Token"
- On click: calls `api.createAgentToken('Default Agent')`
- Shows the raw token in a code block with copy button
- Warning: "This token is shown once. Copy it now."
- On error: toast with retry

**Step 2 — Install Agent:**
- Shows pre-formatted command:
  ```
  export WF0_TOKEN=wf0_xxx
  npx workforce0-agent --repos your-org/repo:/path/to/repo
  ```
- Copy button for the whole block
- Small note: "Run this on any machine with your code repo and Claude CLI"

**Step 3 — Waiting for Connection:**
- Spinner with "Waiting for agent to connect..."
- Polls `api.getAgentStatus()` every 5 seconds
- When `connected > 0`: calls `onAgentConnected()`
- After 5 minutes (60 polls): shows timeout message with "Try Again" and "Skip for now" buttons

**Layout:** Follows existing card patterns — Card with CardContent, numbered steps with colored circles (active step = accent color, completed = green check, pending = gray).

**Accessibility:** Steps use `aria-current="step"`, copy button announces via `aria-live`.

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx next build 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/agent-setup-wizard.tsx
git commit -m "feat: add agent setup wizard component (3-step guided setup)"
```

---

## Task 4: Agent Dashboard Component (State 2)

**Files:**
- Create: `frontend/src/components/agent-dashboard.tsx`

- [ ] **Step 1: Create the dashboard component**

A "use client" component that renders 3 sections:

**Props:**
```typescript
interface AgentDashboardProps {
  onDisconnected: () => void;  // Called when all agents disconnect (switch back to wizard)
}
```

**Section 1 — Connected Agents:**
- Fetches `api.getAgentStatus()` on mount and every 30 seconds (with jitter: 25-35s)
- Renders a list of agent cards, each showing:
  - Green/gray dot with `aria-label="Connected"/"Disconnected"`
  - Agent repos (comma-separated)
  - Capabilities badges
  - Active jobs count / max
  - "Connected X ago" via timeAgo utility
- If `connected === 0`: calls `onDisconnected()`
- Header: "Connected Agents" with green badge "N Online"

**Section 2 — Agent Tokens:**
- Fetches `api.listAgentTokens()` on mount
- List with: name, hint (wf0_•••xxxx), last used, created date
- Revoked tokens shown dimmed with "Revoked" badge, no revoke button
- Active tokens have a "Revoke" button → AlertDialog confirmation: "Revoke token '{name}'? Any agent using this token will be immediately disconnected."
- "+ New Token" button → Dialog with name input → creates token → shows raw token once
- On revoke: calls `api.revokeAgentToken(id)`, refreshes list

**Section 3 — Recent Jobs:**
- Fetches `api.getAgentJobs({ limit: 5 })` on mount
- Status badges: done (green), running (yellow), failed (red), pending (gray)
- Shows: action, targetRepo, time ago
- Empty state: "No jobs yet — jobs will appear here once your agent starts working."

**Loading states:** Each section loads independently with skeleton cards.

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx next build 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/agent-dashboard.tsx
git commit -m "feat: add agent dashboard component (live agents, tokens, recent jobs)"
```

---

## Task 5: Wire Into Settings Page

**Files:**
- Modify: `frontend/src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Read the existing settings page**

Understand the current layout — it has integration cards for Google Meet, Jira, etc. We're adding a new section.

- [ ] **Step 2: Add the Agent section**

After the existing integrations section, add:

```tsx
import { AgentSetupWizard } from "@/components/agent-setup-wizard";
import { AgentDashboard } from "@/components/agent-dashboard";

// Inside the component:
const [agentConnected, setAgentConnected] = useState(false);
const [checkingAgent, setCheckingAgent] = useState(true);

// On mount, check if any agents are connected
useEffect(() => {
  api.getAgentStatus().then(res => {
    setAgentConnected((res.data?.connected || 0) > 0);
    setCheckingAgent(false);
  }).catch(() => setCheckingAgent(false));
}, []);

// In the JSX, after existing sections:
<div className="space-y-6">
  <div>
    <h2 className="text-lg font-semibold text-ink mb-1">AI Agent</h2>
    <p className="text-sm text-ink-tertiary mb-4">
      Connect an AI agent to automatically build features from approved briefs.
    </p>
  </div>

  {checkingAgent ? (
    <Card><CardContent className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-ink-faint" /></CardContent></Card>
  ) : agentConnected ? (
    <AgentDashboard onDisconnected={() => setAgentConnected(false)} />
  ) : (
    <AgentSetupWizard onAgentConnected={() => setAgentConnected(true)} />
  )}
</div>
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npx next build 2>&1 | tail -5`

- [ ] **Step 4: Manual test**

Start both servers and navigate to http://localhost:4000/settings. You should see the Agent Setup Wizard (State 1) at the bottom of the page since no agents are connected.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat: add agent setup section to settings page (hybrid wizard/dashboard)"
```
