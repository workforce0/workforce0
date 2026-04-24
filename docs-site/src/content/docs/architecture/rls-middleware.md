---
title: RLS middleware
description: Prisma middleware enforces tenant scope on every read and write. The defense against horizontal privilege escalation.
---

## The goal

Every tenant-scoped table has a `tenantId` column. Every Prisma query
should filter by that column. Forgetting to filter is a horizontal
privilege escalation vulnerability.

The RLS middleware forces the filter on every query, regardless of
what the service layer wrote. A service that forgets `tenantId` in a
`where` clause is still safe.

## How it works

`backend/src/lib/rls-prisma.ts` applies a Prisma client extension:

```ts
prisma.$extends({
  query: {
    $allOperations({ model, args, query }) {
      if (!TENANT_SCOPED_MODELS.has(model)) return query(args);
      args.where = { ...args.where, tenantId: currentTenantId() };
      return query(args);
    },
  },
});
```

`currentTenantId()` reads from an AsyncLocalStorage bound by the
auth middleware at request start.

## What's covered

28 models at time of writing:

`Project`, `Goal`, `Meeting`, `Transcript`, `PRD`, `Ticket`,
`ExecutionPlan`, `ProjectGraph`, `PRDSymbolLink`, `AgentRole`,
`AgentTask`, `AgentJob`, `AgentToken`, `AgentWebhook`,
`IntegrationConnection`, `User` (reads), `Invitation`, `AuditLog`,
`GoogleOAuthToken`, `ScheduledJob`, `Notification`, `Skill`,
`Approval`, `NotificationSubscription`, `ApiUsage`,
`CredentialVault`, `WhisperTranscription`, `ChannelRoute`.

## What's NOT covered

Two classes of model opt out:

1. **Nullable-tenantId globals.** `SkillPackage`,
   `SubagentDefinition` — these have `tenantId String?` because a
   row may be a global (tenantId null) or a tenant override. The
   service layer handles the OR clause:
   `{ OR: [{ tenantId }, { tenantId: null }] }`.
2. **Administrative tables.** `Tenant` itself. User-management routes
   that need to see all tenants (superadmin).

See [DEFERRED.md](https://github.com/workforce0/workforce0/blob/main/docs/DEFERRED.md)
for the "missing from RLS" audit list.

## Adding a new tenant-scoped model

1. Add `tenantId String` to the Prisma model with a relation.
2. Add to the `TENANT_SCOPED_MODELS` set in `rls-prisma.ts`.
3. Add a test case in `src/lib/__tests__/tenant-prisma.test.ts` that
   proves cross-tenant reads return nothing.
4. Verify no code path passes `tenantId: undefined` (it would match
   on null).

## Project scope (second level)

On top of RLS, list endpoints filter by the active project. The
frontend sends `X-Project-Id`; the backend's middleware scopes list
operations accordingly:

- Pagination endpoints: `where.projectId = currentProjectId`.
- Single-record reads: no project filter — allowed cross-project
  within the same tenant (a deep-linked URL shouldn't 404 because
  the user is on a different active project).

## Testing

`src/lib/__tests__/tenant-prisma.test.ts` has a battery of tests for:

- Reads with the middleware return only tenant rows.
- Writes auto-tag `tenantId`.
- Tenant spoofing via `where.tenantId = <other>` is ignored.
- Aggregations respect the filter.

Add a case whenever you add a new model.

## Bypassing the middleware (rare)

Some queries legitimately need cross-tenant visibility:

- Super-admin queries.
- Backups / data exports.
- The RLS middleware tests themselves.

Use the `unscoped` accessor:

```ts
const allUsers = await unscopedPrisma.user.findMany({});
```

`unscopedPrisma` is exposed only to code that imports it explicitly.
Don't import it from business-logic services.

## What it's not

- **Not** database-layer RLS (Postgres row-level-security policies).
  We don't use Postgres RLS — the Prisma middleware is the only
  gate. If you go directly to `psql`, you bypass.
- **Not** SaaS-grade isolation. Two tenants in the same Postgres
  still share the DB's resources, query plans, indexes.
- **Not** rate limiting / quotas. Those are separate concerns.

For a self-hosted single-org deployment (our primary audience) the
middleware is overkill — you have one tenant — but it costs nothing
and means we're ready for a hosted tier someday.

## Common mistakes

- **`where.tenantId = undefined`.** Treats as no filter, which the
  middleware re-adds. Works, but unclear.
- **Using raw SQL.** `$executeRaw` bypasses the middleware. Prefer
  Prisma for any tenant-scoped query.
- **Forgetting to tag the model.** A new model without the
  `TENANT_SCOPED_MODELS` addition is cross-tenant-leaky. The test
  file is where to catch this.
