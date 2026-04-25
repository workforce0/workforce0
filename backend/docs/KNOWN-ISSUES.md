# Known Issues & Technical Debt

Issues identified but not yet addressed. Prioritize before production deployment.

---

## Critical

### 1. Webhook Status Mapping Mismatch
**Files:** `webhooks.routes.ts:142`, `index.ts:59`

**Problem:** Webhook writes `in_meeting` status, but valid `MeetingStatus` enum uses `in_progress`. Causes unexpected status values and breaks queries/filters.

**Fix:** Update webhook handler to use correct status values:
```typescript
// Change from:
status: 'in_meeting'
// To:
status: 'in_progress'
```

---

### 2. Transcripts Never Persisted ✅ FIXED
**Files:** `meeting.service.ts`

**Problem:**
- Status updates go straight to repository (no completion handler)
- `handleTranscriptionChunk` didn't exist
- Transcript was fetched but never stored

**Solution Applied:**
- Added `handleTranscriptionChunk()` to accumulate real-time chunks in meeting metadata
- Added `handleStatusUpdate()` to handle status changes and trigger completion
- Updated `handleMeetingCompleted()` to:
  1. Fetch transcript from the configured `MeetingBotProvider` (Vexa BYO or Manual)
  2. Create `Transcript` record in database with segments, fullText, speakers
  3. Queue BA Agent processing via `MEETING_PROCESS` job
- Updated di-container to pass `prisma` and `queueService` to MeetingService

> **Historical note:** This issue originally documented a fix in the now-removed Recall.ai integration. The fix is preserved here because the same pattern applies to the current Vexa-via-`MeetingBotProvider` flow.

---

## High

### 3. Queue Workers Not Started
**Files:** `di-container.ts:240`, `index.ts:92`

**Problem:** `QueueService` is created but `registerProcessor()` and `start()` are never called. Jobs are enqueued but never consumed.

**Impact:** `/agents/ba/process` enqueues jobs that sit forever.

**Fix:** In application startup:
```typescript
// Register processors
queueService.registerProcessor(JobType.BA_AGENT_PROCESS, baAgentProcessor);
queueService.registerProcessor(JobType.NOTIFICATION, notificationProcessor);
// ... etc

// Start workers
await queueService.start();
```

---

### 4. Queue Processor Field Mismatches
**Files:** `processors.ts:76`, `processors.ts:200`, `ba-agent.service.ts:180`

**Problem:**
- Processors expect `requiresReview` / `clarificationNeeded`
- BA Agent returns `needsClarification`
- Processors dereference `result.prd.id` but `prd` can be omitted

**Impact:** Jobs will throw errors or misroute.

**Fix:** Align field names between BA Agent output and processor expectations.

---

## Medium

### 5. Webhook Signature Verification Skipped ✅ FIXED
**Files:** `webhooks.routes.ts:243`, `index.ts:149`

**Problem:** Signature verification depends on `rawBody`, but Fastify registration doesn't enable raw body capture. Verification is silently skipped.

**Impact:** Webhooks accept unverified requests (security risk).

**Solution Applied:**
Added custom content type parser in `index.ts` that preserves rawBody:
```typescript
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body: string, done) => {
  (req as any).rawBody = body;
  done(null, JSON.parse(body));
});
```

---

### 6. Agent Type Query Filter Mismatch ✅ FIXED
**Files:** `agents.routes.ts:173`

**Problem:**
- Query param uses: `ba`, `dev`, `qa`
- Database stores: `ba_agent`, `dev_agent`, `qa_agent`

**Impact:** Filtering by agent type returns no results.

**Solution Applied:**
Updated enum in `agents.routes.ts:173` to match database values:
```typescript
agentType: { type: 'string', enum: ['ba_agent', 'dev_agent', 'qa_agent', 'sales_agent', 'marketing_agent'] }
```

---

### 7. Google Chat Webhook Routing Issue ✅ FIXED
**Files:** `routes/webhooks/gchat-webhook.handler.ts`, `routes/index.ts`

**Problem:**
- Handler registered routes at `/api/webhooks/gchat`
- But was mounted under `/webhooks` prefix
- Resulting endpoint: `/webhooks/api/webhooks/gchat` (unreachable)
- Also used incorrect DI pattern: `app.diContainer?.get()`

**Impact:** Google Chat clarification responses couldn't be received.

**Solution Applied:**
1. Changed route from `/api/webhooks/gchat` to `/gchat` (now at `/webhooks/gchat`)
2. Changed health route from `/api/webhooks/gchat/health` to `/gchat/health`
3. Fixed DI access: `app.services?.queueService` instead of `app.diContainer?.get()`

---

### 8. Tenant Isolation Not Enforced ✅ FIXED (Partial)
**Files:** `prisma-rls.middleware.ts`, `di-container.ts`, `tenant.middleware.ts`, `routes/index.ts`

**Problem:** Tenant middleware and Prisma RLS exist but aren't wired into the application.

**Impact:** Multi-tenant data isolation is not enforced - tenants can potentially see each other's data.

**Solution Applied:**
1. ✅ Tenant context middleware registered in `di-container.ts`
2. ✅ RLS middleware applied (but non-functional due to Prisma 7)
3. ✅ Tenant middleware extracts `tenantId` from `X-Tenant-ID` header (development mode)
4. ✅ Removed duplicate tenant extraction from `routes/index.ts` (was conflicting)
5. ✅ Sets `request.tenantId` on all non-excluded routes

**Current Tenant Identification:**
- **Development:** `X-Tenant-ID` header (when `allowHeaderTenant: true`)
- **Production:** JWT token extraction (NOT YET IMPLEMENTED - needs @fastify/jwt)
- **Excluded routes:** `/health`, `/ready`, `/metrics`, `/webhooks/*`, `/public/*`

**Important Limitations:**
1. JWT-based tenant extraction is **not implemented** - code is placeholder (lines 105-110 in tenant.middleware.ts)
2. Prisma 7 removed `$use()` middleware API, so automatic RLS query injection is **disabled**
3. Tenant isolation relies on route handlers passing `tenantId` explicitly to repositories

**TODO for Production:**
- Implement JWT authentication using `@fastify/jwt`
- Extract `tenantId` from JWT payload in `extractTenantId()` function
- Implement RLS using Prisma client extensions (`$extends`) for automatic filtering
- Or use database-level RLS (PostgreSQL Row-Level Security policies)

---

### 9. TypeScript Build Errors (Pre-existing)
**Files:** Multiple files across codebase

**Problem:** `npm run build` fails with ~300 TypeScript errors due to:
1. Pino logger call signature mismatch (`logger.info(msg, obj)` vs `logger.info(obj, msg)`)
2. FastifyInstance generic type mismatch with custom pino logger

**Impact:** Cannot compile to JavaScript. App still works with `tsx` runtime.

**Workarounds:**
- Use `tsx` for development: `npx tsx src/index.ts`
- Use `npm run dev` which uses tsx
- Tests run via tsx

**Fix Required:**
1. Update all logger calls to use correct pino signature: `logger.info({ data }, 'message')`
2. Or configure logger with correct Fastify type generics

---

## Checklist

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | Critical | Webhook status mapping | ✅ DONE |
| 2 | Critical | Transcripts not persisted | ✅ DONE |
| 3 | High | Queue workers not started | ✅ DONE |
| 4 | High | Queue processor field mismatch | ✅ DONE |
| 5 | Medium | Webhook signature skipped | ✅ DONE |
| 6 | Medium | Agent type filter mismatch | ✅ DONE |
| 7 | Medium | Google Chat webhook routing | ✅ DONE |
| 8 | Medium | Tenant isolation not enforced | ✅ DONE (partial - see notes) |
| 9 | Low | TypeScript build errors | ⬜ Pre-existing |

---

## Notes

These issues were identified during code review. Address Critical and High issues before any production testing.

Last updated: 2026-01-26
