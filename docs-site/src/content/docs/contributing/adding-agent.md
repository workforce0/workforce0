---
title: Adding an agent role
description: Recipe for introducing a new specialist role (e.g. security_agent, compliance_agent).
---

## When to add a new role

- The existing roles (BA, architect, dev, QA, memory optimizer)
  don't cover the specialist work you want.
- You have a clear, narrow job description for the new role.
- You're OK with ~1 day of implementation + test work.

When in doubt, don't add a role — use **subagents** (see
[Skills & subagents](/features/skills-subagents/)) instead. A
subagent extends an existing role's behaviour for specific tickets
without a new queue / consumer.

## The recipe

### 1. Define the role

Pick a slug (`security_agent`, `compliance_agent`). Write down:

- **Purpose**: one-line description.
- **System prompt**: how the role thinks about its work.
- **Default model** (frontier / local / any).
- **Skills the role can use**.
- **Subagents it can delegate to**.

### 2. Seed the role

Add it to the seed script `backend/scripts/seed-roles.ts` (or write a
migration that inserts a row).

```ts
await prisma.agentRole.upsert({
  where: { tenantId_slug: { tenantId: null, slug: 'security_agent' } },
  update: {},
  create: {
    tenantId: null,                  // global
    slug: 'security_agent',
    description: 'Security review specialist',
    systemPrompt: `…`,
    allowedSkills: ['security-best-practices'],
    preferredModel: 'claude-sonnet-4-6',
  },
});
```

### 3. Register a queue

In `backend/src/queues/index.ts`, register a new queue and worker:

```ts
export const securityQueue = new Queue('queue:security', { connection });
```

### 4. (Optional) Add a service class

If the role just needs to call an LLM, no class needed — the generic
`SpecialistConsumer` handles it.

If the role needs to call integrations, produce structured artifacts,
or maintain state, write a subclass of `BaseConsultant`:

```ts
class SecurityAgentService extends BaseConsultant {
  protected roleSlug = 'security_agent';

  async handleTicket(ticket: Ticket): Promise<TicketResult> {
    // 1. assemble context
    // 2. call LLM via modelRegistry
    // 3. return structured result
  }
}
```

Place in `backend/src/services/agents/security-agent.service.ts`.

### 5. Wire into DI

`backend/src/lib/di-container.ts`:

```ts
const securityAgentService = new SecurityAgentService(
  rlsPrisma, libraryService, modelRegistry, logger,
);
container.register('securityAgentService', securityAgentService);
```

And register a worker:

```ts
new Worker('queue:security', async (job) => {
  return securityAgentService.handleJob(job.data);
}, { connection });
```

### 6. Update the chief-of-staff prompt

The chief-of-staff's list of available roles lives in the planner
system prompt. Add your new slug so it shows up when decomposing:

```ts
// backend/src/services/chief-of-staff/planner-llm.ts
const AVAILABLE_ROLES = [
  'ba_agent', 'architect', 'dev_agent', 'qa_agent',
  'memory_optimizer', 'security_agent',                    // new
];
```

### 7. Add a Prisma migration (if needed)

If your role needs a new table (e.g. security findings), add it
under `backend/prisma/schema.prisma` and run
`npx prisma migrate dev`.

### 8. Test

```ts
// backend/src/services/agents/__tests__/security-agent.service.test.ts
describe('SecurityAgentService', () => {
  it('produces a finding when the diff introduces a SQL injection', async () => {
    const svc = new SecurityAgentService(mockPrisma, …);
    const result = await svc.handleTicket(ticket);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
```

Cover happy + failure paths.

### 9. Surface in the UI

The **Activity** page auto-surfaces any new role without code
changes — it reads `roleSlug` off ticket rows.

The **Settings → Roles** page lists all roles and lets the user
edit prompts / budgets. Your role is listed automatically.

If you have role-specific output that needs its own UI view (e.g. a
Security Findings dashboard), add a new page under
`frontend/src/app/(dashboard)/`.

### 10. Document it

Update:

- `docs-site/src/content/docs/features/specialist-agents.md` — add
  your role to the table.
- `docs-site/src/content/docs/reference/glossary.md` — define the
  role.
- `docs/DEFERRED.md` if there's follow-up work.

## Anti-patterns

- **"Mega-role."** One role that does everything. Specialists are
  specialists. If the system prompt is 2k words, split.
- **Untested fallbacks.** If the role's LLM call fails, what
  happens? Make sure the generic failure path (ticket → `failed`)
  still works.
- **Leaking role-specific schema into generic Ticket shape.**
  Payload field is an `unknown` bucket for role-specific extras.

## A worked example

`memory_optimizer` was added as a role specifically to handle
context-budget rollups for long ticket histories. Its system prompt
is ~15 lines; its service class is ~80 lines; its test file is ~200
lines. That's about the expected ratio — if your role is more code
than tests, question the scope.
