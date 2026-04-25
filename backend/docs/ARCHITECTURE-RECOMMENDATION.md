# Architecture Recommendation: DDD Monorepo

**Status:** Proposed
**Date:** 2026-01-25
**Author:** Architecture Review

---

## Executive Summary

For a project of this magnitude—an Autonomous AI Operating System with multi-tenancy, custom MCPs, and complex orchestration—a standard MVC or tiered architecture will collapse under its own weight.

**Recommendation:** Domain-Driven Design (DDD) Monorepo structure.

---

## Why This Pattern?

### 1. Tenant Isolation
Enforce boundaries at the library level (e.g., `packages/security` handles all PII redaction) so developers can't accidentally leak data.

### 2. Shared Types
The Truth object, PRD schema, and AgentContext need to be identical across the frontend, backend, and 6 different agents.

### 3. Independent Scaling
The "Dev Agent" (heavy compute) needs different K8s resources than the "Concierge" (lightweight I/O). A monorepo allows you to deploy them as separate microservices from one codebase.

---

## Recommended Folder Structure

```
/workforce0
├── /apps                          # Deployable Services (The "Runtime")
│   ├── /web-dashboard             # React/Next.js + Shadcn/ui (User Interface)
│   ├── /api-gateway               # Fastify/NestJS (Auth, Rate Limiting, Request Routing)
│   ├── /extension                 # Browser Extension (in-tab capture fallback)
│   │
│   # --- The Agent Microservices ---
│   ├── /agent-ba                  # Business Analyst Agent Service
│   ├── /agent-dev                 # Developer Agent Service (Heavy Logic)
│   ├── /agent-concierge           # Notification & Routing Service
│   └── /agent-meeting-bot         # Real-time audio processing service
│
├── /packages                      # Shared Libraries (The "Glue")
│   ├── /types                     # Zod/TypeScript definitions (SSOT for all Data Models)
│   ├── /database                  # Prisma Schema & Migrations (The Truth Ledger)
│   ├── /security                  # PII Redaction, Tenant Isolation Middleware
│   ├── /mcp-sdk                   # Custom wrapper for Model Context Protocol tools
│   ├── /logger                    # Structured logging (Winston/Pino) with Tenant Context
│   └── /ui-kit                    # Shared React components
│
├── /services                      # Core Platform Logic (Not Agents)
│   ├── /orchestrator              # The Saga Coordinator (State Machine)
│   ├── /rag-pipeline              # Qdrant + NotebookLM abstraction layer
│   └── /integration-hub           # CASB Pattern (Jira/GitHub/Salesforce Connectors)
│
├── /infrastructure                # Infrastructure as Code (IaC)
│   ├── /k8s                       # Kubernetes Manifests / Helm Charts
│   │   ├── /base                  # Base configs (Ingress, Cert-Manager)
│   │   ├── /tenants               # Tenant Namespace Templates
│   │   └── /agents                # Agent Deployment configs
│   ├── /terraform                 # AWS/GCP provisioning (EKS, RDS, Redis)
│   └── /docker                    # Multi-stage Dockerfiles for apps
│
├── /tools                         # DevEx & Testing
│   ├── /prompt-regression         # The "Shadow Testing" suite for LLMs
│   ├── /seed-scripts              # Scripts to populate dev DB
│   └── /generators                # Scaffolding scripts (e.g., "new-agent")
│
├── /docs                          # Architecture Decision Records (ADRs) & PRDs
├── turbo.json                     # Monorepo build pipeline config
└── package.json                   # Root dependencies
```

---

## Key Design Decisions Explained

### 1. `apps/` vs. `services/`

| Folder | Purpose | Deployment |
|--------|---------|------------|
| `apps/` | Containers that actually run | Have Dockerfiles, deployed to K8s |
| `services/` | Logical groupings of business logic | Imported by apps OR run as separate microservices |

**Why separate?** Keeping `orchestrator` separate ensures you don't tightly couple your state machine to your HTTP API.

### 2. The `packages/types` Module

**This is your Holy Grail.**

**Why:** If the BA Agent generates a PRD JSON, and the Frontend tries to render it, they MUST agree on the schema.

**How:** Define your `TruthEntity`, `RevertPayload`, and `AgentContext` interfaces here. Import this package into every app.

```typescript
// packages/types/src/prd.ts
export interface PRDSchema {
  id: string;
  title: string;
  requirements: Requirement[];
  confidence: number;
  // ... shared across all apps
}
```

### 3. `infrastructure/k8s/tenants`

**Crucial for Tenant Isolation requirement.**

Contains Helm charts or Kustomize files that generate:
- Unique Namespace per customer
- ResourceQuotas
- NetworkPolicies

**Pattern:** Use an "Operator" pattern where a new customer signup triggers a K8s job to apply these manifests, creating their isolated sandbox dynamically.

### 4. `services/integration-hub` (The CASB Pattern)

**Do NOT put Jira logic inside the BA Agent.**

Put it here. This folder implements the **Strategy Pattern**.

```typescript
// services/integration-hub/src/providers/task-provider.ts
interface TaskProvider {
  createTicket(data: TicketData): Promise<TicketResult>;
  updateTicket(key: string, data: Partial<TicketData>): Promise<TicketResult>;
  getTicket(key: string): Promise<Ticket>;
}

// services/integration-hub/src/adapters/jira-adapter.ts
class JiraAdapter implements TaskProvider { ... }

// services/integration-hub/src/adapters/linear-adapter.ts
class LinearAdapter implements TaskProvider { ... }
```

The Agent just calls `TaskProvider.createTicket()`, and this service figures out which tool the tenant uses.

### 5. `tools/prompt-regression`

**This is where your "Shadow Testing" lives.**

Not just unit tests—a dedicated suite that runs prompts against 50 historical inputs to ensure `gpt-4o-mini` didn't break your output schema.

```typescript
// tools/prompt-regression/tests/prd-generation.test.ts
describe('PRD Generation Regression', () => {
  const historicalInputs = loadHistoricalTranscripts();

  historicalInputs.forEach((input, i) => {
    it(`should generate valid PRD for transcript ${i}`, async () => {
      const result = await baAgent.generatePRD(input);
      expect(result).toMatchSchema(PRDSchema);
      expect(result.confidence).toBeGreaterThan(0.5);
    });
  });
});
```

---

## Migration Strategy

### Phase 1: MVP (Current State)
Keep everything in `mvp/` folder for rapid iteration.

### Phase 2: Monorepo Setup
1. Initialize Turborepo/Nx at root
2. Extract `packages/types` first (most value)
3. Extract `packages/database` (Prisma schema)
4. Extract `packages/logger`

### Phase 3: Agent Separation
1. Extract `apps/agent-ba` from services
2. Extract `apps/agent-meeting-bot`
3. Add independent scaling configs

### Phase 4: Full Architecture
1. Add `apps/web-dashboard`
2. Add `services/integration-hub`
3. Add `infrastructure/k8s`

---

## Day 1 Recommendation

> **Start with the Monorepo setup (using Turborepo or Nx) immediately.**
>
> Moving code into shared packages later is painful. Even if `agent-dev` is just one file right now, give it its own folder in `apps/` so it's ready to grow.

---

## Tools Comparison

| Tool | Pros | Cons | Recommendation |
|------|------|------|----------------|
| **Turborepo** | Fast, Vercel-backed, simple | Less features | Best for starting out |
| **Nx** | Feature-rich, great DX | More complex | Better for large teams |
| **Lerna** | Mature | Slower, less maintained | Avoid |

**Recommendation:** Start with Turborepo, migrate to Nx if needed.

---

## Related Documents

- [MVP Implementation Guide](./MVP-Implementation-Guide.md)
- [DEMO Implementation Plan](./DEMO-Implementation-Plan.md)
- [PRD v2.8](../../docs/PRD.md)

---

*This document should be reviewed and updated as the architecture evolves.*
