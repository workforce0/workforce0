# Plan 1 — Meeting Bot Abstraction + Vexa Bundle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abstract meeting-bot integrations behind a `MeetingBotProvider` interface with three implementations (Vexa bundled, Recall.ai BYOK, Manual), so the existing `/api/meetings/schedule` route can route to whichever the tenant picked instead of returning HTTP 410.

**Architecture:** One interface, three concrete providers, one router with deterministic fallback (`vexa → recall → manual`). Router lives behind `fastify.services.meetingBotRouter` and is called from `meetings.routes.ts`. Vexa runs as an opt-in `meeting-bot` Compose profile alongside a `docker-socket-proxy` container that whitelists only `containers.{create,start,stop,inspect}` calls. No raw socket mounts to bot-manager.

**Tech Stack:** TypeScript ESM, Fastify, Vitest, Prisma 7, Docker Compose. New deps: none (uses native `fetch`, native `crypto` for HMAC).

**Spec:** `docs/superpowers/specs/2026-04-25-step-0-local-everything-bundle-design.md` §6 + §7.

---

## File Structure

```
backend/
├── prisma/
│   └── schema.prisma                                          modified (additive: tenantSettings field)
├── src/
│   ├── lib/
│   │   └── di-container.ts                                    modified (wire router + providers)
│   ├── routes/
│   │   ├── meetings.routes.ts                                 modified (replace 410 stub)
│   │   └── webhooks/
│   │       └── meeting-bot-recall.routes.ts                   NEW (HMAC-validated webhook)
│   └── services/
│       └── meeting-bot/                                       NEW
│           ├── meeting-bot-provider.types.ts                  NEW (interface + DTOs)
│           ├── meeting-bot-router.service.ts                  NEW (fallback chain)
│           ├── meeting-bot-router.service.test.ts             NEW
│           ├── providers/
│           │   ├── manual.provider.ts                         NEW
│           │   ├── manual.provider.test.ts                    NEW
│           │   ├── recall.provider.ts                         NEW
│           │   ├── recall.provider.test.ts                    NEW
│           │   ├── vexa.provider.ts                           NEW
│           │   └── vexa.provider.test.ts                      NEW
│           └── index.ts                                       NEW (barrel exports)
docker-compose.prod.yml                                        modified (4 new services under meeting-bot profile)
docs-site/src/content/docs/integrations/meeting-bot.md         NEW
```

Each file has one clear responsibility. Provider implementations are siblings; the router is the only thing that knows about all three.

---

## Task 1: Provider interface and shared types

**Files:**
- Create: `backend/src/services/meeting-bot/meeting-bot-provider.types.ts`

- [ ] **Step 1: Create the types file**

Create `backend/src/services/meeting-bot/meeting-bot-provider.types.ts`:

```ts
/**
 * MeetingBotProvider — abstracts live-meeting capture across Vexa
 * (bundled), Recall.ai (BYOK), and Manual (always-available fallback).
 *
 * @module services/meeting-bot/meeting-bot-provider.types
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

export type ProviderId = 'vexa' | 'recall' | 'manual';

export interface ScheduleBotInput {
  /** The meeting URL (Google Meet / Zoom / Teams). */
  meetingUrl: string;
  /** Workforce0 meeting row ID (created upstream by route). */
  meetingId: string;
  /** Tenant scope. Required for routing + telemetry. */
  tenantId: string;
  /** Display name for the bot in the meeting (default: "Workforce0 Bot"). */
  botName?: string;
}

export interface ScheduleBotResult {
  /** Provider-side bot identifier; opaque to Workforce0. */
  botId: string;
  status: 'scheduled' | 'joining' | 'failed';
  /** ISO8601 estimated join time, if the provider knows. */
  estimatedJoinTime?: string;
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
}

export interface MeetingTranscript {
  segments: TranscriptSegment[];
  durationSec: number;
  participants: string[];
  /** ISO 639-1 language code (e.g. "en", "es"). */
  language: string;
}

export class ProviderNotSchedulableError extends Error {
  constructor(providerId: ProviderId) {
    super(`Provider '${providerId}' does not support scheduleBot`);
    this.name = 'ProviderNotSchedulableError';
  }
}

export interface MeetingBotProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  /** Returns false if keys/services aren't configured. */
  isAvailable(): Promise<boolean>;

  /** Schedule a bot to join a live meeting. `manual` always throws ProviderNotSchedulableError. */
  scheduleBot(input: ScheduleBotInput): Promise<ScheduleBotResult>;

  /** Cancel a scheduled bot (best-effort; OK if already left). */
  cancelBot(botId: string): Promise<void>;

  /** Fetch the transcript when the bot reports done. Returns null if not ready. */
  getTranscript(botId: string): Promise<MeetingTranscript | null>;

  /** Optional: provider-specific webhook handler. Mounted at /webhooks/meeting-bot/<id>. */
  handleWebhook?(req: FastifyRequest, reply: FastifyReply): Promise<void>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend && npm run typecheck
```
Expected: zero errors. The file uses Fastify's existing types and exports interfaces only — no runtime code to fail.

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/services/meeting-bot/meeting-bot-provider.types.ts
git commit -m "feat(meeting-bot): add MeetingBotProvider interface and shared DTOs"
```

---

## Task 2: ManualProvider (always-available terminal fallback)

**Files:**
- Create: `backend/src/services/meeting-bot/providers/manual.provider.ts`
- Test: `backend/src/services/meeting-bot/providers/manual.provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/meeting-bot/providers/manual.provider.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ManualProvider } from './manual.provider.js';
import { ProviderNotSchedulableError } from '../meeting-bot-provider.types.js';

describe('ManualProvider', () => {
  const provider = new ManualProvider();

  it('reports id "manual" and a display name', () => {
    expect(provider.id).toBe('manual');
    expect(provider.displayName.length).toBeGreaterThan(0);
  });

  it('is always available', async () => {
    await expect(provider.isAvailable()).resolves.toBe(true);
  });

  it('throws ProviderNotSchedulableError on scheduleBot', async () => {
    await expect(
      provider.scheduleBot({
        meetingUrl: 'https://meet.google.com/x',
        meetingId: 'm1',
        tenantId: 't1',
      }),
    ).rejects.toThrow(ProviderNotSchedulableError);
  });

  it('cancelBot is a no-op', async () => {
    await expect(provider.cancelBot('any-id')).resolves.toBeUndefined();
  });

  it('returns null transcript', async () => {
    await expect(provider.getTranscript('any-id')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx vitest run src/services/meeting-bot/providers/manual.provider.test.ts
```
Expected: FAIL with "Cannot find module './manual.provider.js'".

- [ ] **Step 3: Implement ManualProvider**

Create `backend/src/services/meeting-bot/providers/manual.provider.ts`:

```ts
/**
 * ManualProvider — always-available terminal fallback.
 *
 * Returned by the router when no other provider can schedule a bot.
 * scheduleBot deliberately throws so callers can branch into the
 * "ask the user to upload after the meeting" path.
 *
 * @module services/meeting-bot/providers/manual
 */

import {
  type MeetingBotProvider,
  type MeetingTranscript,
  type ProviderId,
  type ScheduleBotInput,
  type ScheduleBotResult,
  ProviderNotSchedulableError,
} from '../meeting-bot-provider.types.js';

export class ManualProvider implements MeetingBotProvider {
  readonly id: ProviderId = 'manual';
  readonly displayName = 'Manual upload';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async scheduleBot(_input: ScheduleBotInput): Promise<ScheduleBotResult> {
    throw new ProviderNotSchedulableError(this.id);
  }

  async cancelBot(_botId: string): Promise<void> {
    // No-op — there's nothing to cancel.
  }

  async getTranscript(_botId: string): Promise<MeetingTranscript | null> {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx vitest run src/services/meeting-bot/providers/manual.provider.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/services/meeting-bot/providers/manual.provider.ts src/services/meeting-bot/providers/manual.provider.test.ts
git commit -m "feat(meeting-bot): ManualProvider as always-available terminal fallback"
```

---

## Task 3: Add `tenantSettings.meetingBotProviderId` to Prisma schema

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Find the existing `tenantSettings` model**

```bash
cd backend && grep -n "model TenantSettings" prisma/schema.prisma
```
Expected: exact line number where the model starts. (If the model is named differently, e.g. `Tenant`, use that.) The next steps assume `TenantSettings` exists; if it doesn't, look for the closest equivalent and adjust.

- [ ] **Step 2: Add the field**

In `backend/prisma/schema.prisma`, locate the `TenantSettings` model and add:

```prisma
model TenantSettings {
  // ... existing fields ...
  meetingBotProviderId String? // 'vexa' | 'recall' | 'manual'; null = use router default
  // ... existing fields ...
}
```

If `TenantSettings` doesn't exist, add the field to whatever per-tenant settings model is in use (search `grep -n "tenantId.*@unique" prisma/schema.prisma` to find single-tenant-row models). If no per-tenant settings model exists at all, *stop here and create the model*:

```prisma
model TenantSettings {
  id                    String   @id @default(uuid())
  tenantId              String   @unique
  meetingBotProviderId  String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}
```

- [ ] **Step 3: Generate migration**

```bash
cd backend && npx prisma migrate dev --name add_meeting_bot_provider_id --create-only
```
Expected: a new file at `backend/prisma/migrations/<timestamp>_add_meeting_bot_provider_id/migration.sql` containing an `ALTER TABLE` (or `CREATE TABLE` if you added the model). Inspect it; it should be additive only (no `DROP`, no `NOT NULL` without default).

- [ ] **Step 4: Apply the migration**

```bash
cd backend && npm run db:migrate
```
Expected: migration applies, `prisma generate` runs, no errors.

- [ ] **Step 5: Run typecheck**

```bash
cd backend && npm run typecheck
```
Expected: zero errors. Generated client now has the new field.

- [ ] **Step 6: Commit**

```bash
cd backend
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add tenantSettings.meetingBotProviderId for provider routing"
```

---

## Task 4: MeetingBotRouter (fallback chain)

**Files:**
- Create: `backend/src/services/meeting-bot/meeting-bot-router.service.ts`
- Test: `backend/src/services/meeting-bot/meeting-bot-router.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/meeting-bot/meeting-bot-router.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeetingBotRouter } from './meeting-bot-router.service.js';
import { ManualProvider } from './providers/manual.provider.js';
import type { MeetingBotProvider, ProviderId } from './meeting-bot-provider.types.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

function fakeProvider(id: ProviderId, available: boolean): MeetingBotProvider {
  return {
    id,
    displayName: id,
    isAvailable: vi.fn().mockResolvedValue(available),
    scheduleBot: vi.fn(),
    cancelBot: vi.fn(),
    getTranscript: vi.fn(),
  };
}

interface FakeTenantSettings {
  get(tenantId: string): Promise<{ meetingBotProviderId: ProviderId | null }>;
}

const settings = (preferred: ProviderId | null): FakeTenantSettings => ({
  get: vi.fn().mockResolvedValue({ meetingBotProviderId: preferred }),
});

describe('MeetingBotRouter', () => {
  let manual: ManualProvider;
  beforeEach(() => { manual = new ManualProvider(); });

  it('returns the preferred provider when available', async () => {
    const vexa = fakeProvider('vexa', true);
    const recall = fakeProvider('recall', true);
    const router = new MeetingBotRouter([vexa, recall, manual], settings('vexa'));
    const p = await router.resolveProvider('t1');
    expect(p.id).toBe('vexa');
  });

  it('falls through to next when preferred is unavailable', async () => {
    const vexa = fakeProvider('vexa', false);
    const recall = fakeProvider('recall', true);
    const router = new MeetingBotRouter([vexa, recall, manual], settings('vexa'));
    const p = await router.resolveProvider('t1');
    expect(p.id).toBe('recall');
  });

  it('returns manual as terminal fallback', async () => {
    const vexa = fakeProvider('vexa', false);
    const recall = fakeProvider('recall', false);
    const router = new MeetingBotRouter([vexa, recall, manual], settings('vexa'));
    const p = await router.resolveProvider('t1');
    expect(p.id).toBe('manual');
  });

  it('uses default order when tenant has no preference', async () => {
    const vexa = fakeProvider('vexa', true);
    const recall = fakeProvider('recall', true);
    const router = new MeetingBotRouter([vexa, recall, manual], settings(null));
    const p = await router.resolveProvider('t1');
    expect(p.id).toBe('vexa');  // first in default order
  });

  it('skips a missing provider entry gracefully', async () => {
    // Only vexa registered; tenant prefers recall
    const vexa = fakeProvider('vexa', true);
    const router = new MeetingBotRouter([vexa, manual], settings('recall'));
    const p = await router.resolveProvider('t1');
    expect(p.id).toBe('vexa');  // recall not registered, falls to next in default order
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx vitest run src/services/meeting-bot/meeting-bot-router.service.test.ts
```
Expected: FAIL with "Cannot find module './meeting-bot-router.service.js'".

- [ ] **Step 3: Implement MeetingBotRouter**

Create `backend/src/services/meeting-bot/meeting-bot-router.service.ts`:

```ts
/**
 * MeetingBotRouter — picks a MeetingBotProvider for a given tenant.
 *
 * Resolution order:
 *   1. Tenant's preferred provider (if registered AND available)
 *   2. Default fallback order: vexa → recall → manual
 *   3. Manual (always available, terminal fallback)
 *
 * @module services/meeting-bot/meeting-bot-router.service
 */

import { createChildLogger } from '../../lib/logger.js';
import type { MeetingBotProvider, ProviderId } from './meeting-bot-provider.types.js';

const logger = createChildLogger({ service: 'MeetingBotRouter' });

interface TenantSettingsLike {
  get(tenantId: string): Promise<{ meetingBotProviderId: ProviderId | null }>;
}

const DEFAULT_ORDER: ProviderId[] = ['vexa', 'recall', 'manual'];

export class MeetingBotRouter {
  private readonly providers: Map<ProviderId, MeetingBotProvider>;

  constructor(
    providers: MeetingBotProvider[],
    private readonly tenantSettings: TenantSettingsLike,
  ) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
    if (!this.providers.has('manual')) {
      throw new Error('MeetingBotRouter requires a ManualProvider as terminal fallback');
    }
  }

  async resolveProvider(tenantId: string): Promise<MeetingBotProvider> {
    const settings = await this.tenantSettings.get(tenantId);
    const preferred = settings.meetingBotProviderId;

    const order: ProviderId[] = preferred
      ? [preferred, ...DEFAULT_ORDER.filter((x) => x !== preferred)]
      : [...DEFAULT_ORDER];

    for (const id of order) {
      const provider = this.providers.get(id);
      if (!provider) continue;
      try {
        if (await provider.isAvailable()) {
          logger.debug({ tenantId, picked: id, preferred }, 'Provider resolved');
          return provider;
        }
      } catch (err) {
        logger.warn({ tenantId, providerId: id, err: (err as Error).message }, 'Provider availability check threw; skipping');
      }
    }

    // Manual is always available — but the loop above already returns it
    // on the last pass. This is a defence-in-depth safety net.
    return this.providers.get('manual')!;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx vitest run src/services/meeting-bot/meeting-bot-router.service.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/services/meeting-bot/meeting-bot-router.service.ts src/services/meeting-bot/meeting-bot-router.service.test.ts
git commit -m "feat(meeting-bot): router with deterministic fallback chain"
```

---

## Task 5: RecallProvider (BYOK Recall.ai)

**Files:**
- Create: `backend/src/services/meeting-bot/providers/recall.provider.ts`
- Test: `backend/src/services/meeting-bot/providers/recall.provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/meeting-bot/providers/recall.provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecallProvider } from './recall.provider.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => mockFetch.mockReset());

describe('RecallProvider', () => {
  it('isAvailable returns false when no API key', async () => {
    const p = new RecallProvider({ apiKey: undefined, webhookSecret: undefined });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('isAvailable returns true when API key is set and /v1/bot returns 200', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const p = new RecallProvider({ apiKey: 'test-key', webhookSecret: 'sec' });
    await expect(p.isAvailable()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.recall.ai/api/v1/bot/?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Token test-key' }),
      }),
    );
  });

  it('scheduleBot calls Recall API with auth header', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'bot-abc', status_changes: [] }), { status: 201 }),
    );
    const p = new RecallProvider({ apiKey: 'k', webhookSecret: 's' });
    const result = await p.scheduleBot({
      meetingUrl: 'https://meet.google.com/x',
      meetingId: 'm1',
      tenantId: 't1',
      botName: 'Workforce0',
    });
    expect(result.botId).toBe('bot-abc');
    expect(result.status).toBe('scheduled');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.recall.ai/api/v1/bot/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Token k' }),
      }),
    );
  });

  it('scheduleBot throws when API returns 4xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"bad"}', { status: 400 }));
    const p = new RecallProvider({ apiKey: 'k', webhookSecret: 's' });
    await expect(
      p.scheduleBot({ meetingUrl: 'x', meetingId: 'm', tenantId: 't' }),
    ).rejects.toThrow(/Recall scheduleBot failed: 400/);
  });

  it('cancelBot calls DELETE on the bot', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 204 }));
    const p = new RecallProvider({ apiKey: 'k', webhookSecret: 's' });
    await p.cancelBot('bot-xyz');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.recall.ai/api/v1/bot/bot-xyz/leave_call/',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('getTranscript returns null when bot has no transcript yet', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'bot-abc', media_retention_end: null, transcript: null }), { status: 200 }),
    );
    const p = new RecallProvider({ apiKey: 'k', webhookSecret: 's' });
    await expect(p.getTranscript('bot-abc')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx vitest run src/services/meeting-bot/providers/recall.provider.test.ts
```
Expected: FAIL with "Cannot find module './recall.provider.js'".

- [ ] **Step 3: Implement RecallProvider**

Create `backend/src/services/meeting-bot/providers/recall.provider.ts`:

```ts
/**
 * RecallProvider — BYOK integration with Recall.ai.
 *
 * Requires RECALL_API_KEY in env. RECALL_WEBHOOK_SECRET is used by the
 * route handler in routes/webhooks/meeting-bot-recall.routes.ts to
 * verify HMAC signatures on incoming events.
 *
 * @module services/meeting-bot/providers/recall
 */

import { createChildLogger } from '../../../lib/logger.js';
import type {
  MeetingBotProvider,
  MeetingTranscript,
  ProviderId,
  ScheduleBotInput,
  ScheduleBotResult,
  TranscriptSegment,
} from '../meeting-bot-provider.types.js';

const logger = createChildLogger({ service: 'RecallProvider' });
const RECALL_API_BASE = 'https://api.recall.ai/api/v1';

export interface RecallProviderConfig {
  apiKey: string | undefined;
  webhookSecret: string | undefined;
}

export class RecallProvider implements MeetingBotProvider {
  readonly id: ProviderId = 'recall';
  readonly displayName = 'Recall.ai';

  constructor(private readonly config: RecallProviderConfig) {}

  async isAvailable(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      const res = await fetch(`${RECALL_API_BASE}/bot/?limit=1`, {
        headers: { Authorization: `Token ${this.config.apiKey}` },
      });
      return res.ok;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Recall availability check failed');
      return false;
    }
  }

  async scheduleBot(input: ScheduleBotInput): Promise<ScheduleBotResult> {
    const res = await fetch(`${RECALL_API_BASE}/bot/`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.requireKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        meeting_url: input.meetingUrl,
        bot_name: input.botName ?? 'Workforce0 Bot',
        // Recall expects metadata as a flat object of strings.
        metadata: { tenantId: input.tenantId, meetingId: input.meetingId },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Recall scheduleBot failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { id: string };
    return { botId: data.id, status: 'scheduled' };
  }

  async cancelBot(botId: string): Promise<void> {
    const res = await fetch(`${RECALL_API_BASE}/bot/${botId}/leave_call/`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.requireKey()}` },
    });
    // 204 = success; 404 = bot already gone, treat as success.
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new Error(`Recall cancelBot failed: ${res.status} ${body}`);
    }
  }

  async getTranscript(botId: string): Promise<MeetingTranscript | null> {
    const res = await fetch(`${RECALL_API_BASE}/bot/${botId}/`, {
      headers: { Authorization: `Token ${this.requireKey()}` },
    });
    if (!res.ok) {
      throw new Error(`Recall getTranscript failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      transcript?: Array<{ speaker: string; words: Array<{ text: string; start_timestamp: { relative: number }; end_timestamp: { relative: number } }> }>;
    };
    if (!data.transcript || data.transcript.length === 0) return null;

    const segments: TranscriptSegment[] = data.transcript.flatMap((entry) =>
      entry.words.map((w) => ({
        speaker: entry.speaker,
        text: w.text,
        startSec: w.start_timestamp.relative,
        endSec: w.end_timestamp.relative,
      })),
    );

    const lastSeg = segments[segments.length - 1];
    return {
      segments,
      durationSec: lastSeg ? lastSeg.endSec : 0,
      participants: [...new Set(data.transcript.map((e) => e.speaker))],
      language: 'en',  // Recall doesn't return language in this payload shape; default en for now.
    };
  }

  private requireKey(): string {
    if (!this.config.apiKey) throw new Error('RecallProvider: RECALL_API_KEY not set');
    return this.config.apiKey;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx vitest run src/services/meeting-bot/providers/recall.provider.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/services/meeting-bot/providers/recall.provider.ts src/services/meeting-bot/providers/recall.provider.test.ts
git commit -m "feat(meeting-bot): RecallProvider for BYOK Recall.ai integration"
```

---

## Task 6: VexaProvider (bundled local bot)

**Files:**
- Create: `backend/src/services/meeting-bot/providers/vexa.provider.ts`
- Test: `backend/src/services/meeting-bot/providers/vexa.provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/meeting-bot/providers/vexa.provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VexaProvider } from './vexa.provider.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;
beforeEach(() => mockFetch.mockReset());

describe('VexaProvider', () => {
  const baseUrl = 'http://vexa-api:18056';

  it('isAvailable returns false when /health is not 200', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 503 }));
    const p = new VexaProvider({ baseUrl });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('isAvailable returns true when /health returns 200', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    const p = new VexaProvider({ baseUrl });
    await expect(p.isAvailable()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/health`, expect.any(Object));
  });

  it('scheduleBot POSTs to /bots and returns botId', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'vbot-1', status: 'scheduled' }), { status: 201 }));
    const p = new VexaProvider({ baseUrl });
    const r = await p.scheduleBot({ meetingUrl: 'https://meet.google.com/x', meetingId: 'm', tenantId: 't' });
    expect(r.botId).toBe('vbot-1');
    expect(r.status).toBe('scheduled');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/bots`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('cancelBot DELETEs the bot', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 204 }));
    const p = new VexaProvider({ baseUrl });
    await p.cancelBot('vbot-1');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/bots/vbot-1`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('getTranscript returns null when bot has no transcript', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'in_progress', segments: [] }), { status: 200 }),
    );
    const p = new VexaProvider({ baseUrl });
    await expect(p.getTranscript('vbot-1')).resolves.toBeNull();
  });

  it('getTranscript maps segments when ready', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: 'completed',
        duration: 600,
        language: 'en',
        participants: ['Alice', 'Bob'],
        segments: [
          { speaker: 'Alice', text: 'hi', start: 0, end: 1.2 },
          { speaker: 'Bob', text: 'hello', start: 1.5, end: 2.7 },
        ],
      }), { status: 200 }),
    );
    const p = new VexaProvider({ baseUrl });
    const t = await p.getTranscript('vbot-1');
    expect(t).not.toBeNull();
    expect(t!.segments).toHaveLength(2);
    expect(t!.participants).toEqual(['Alice', 'Bob']);
    expect(t!.durationSec).toBe(600);
    expect(t!.language).toBe('en');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx vitest run src/services/meeting-bot/providers/vexa.provider.test.ts
```
Expected: FAIL with "Cannot find module './vexa.provider.js'".

- [ ] **Step 3: Implement VexaProvider**

Create `backend/src/services/meeting-bot/providers/vexa.provider.ts`:

```ts
/**
 * VexaProvider — bundled local meeting bot via Vexa Compose stack.
 *
 * Talks to vexa-api over the internal Docker network (default
 * http://vexa-api:18056). When the meeting-bot Compose profile is off,
 * isAvailable() returns false and the router falls through.
 *
 * @module services/meeting-bot/providers/vexa
 */

import { createChildLogger } from '../../../lib/logger.js';
import type {
  MeetingBotProvider,
  MeetingTranscript,
  ProviderId,
  ScheduleBotInput,
  ScheduleBotResult,
  TranscriptSegment,
} from '../meeting-bot-provider.types.js';

const logger = createChildLogger({ service: 'VexaProvider' });

export interface VexaProviderConfig {
  /** Base URL of the bundled vexa-api service. */
  baseUrl: string;
}

interface VexaBotStatusBody {
  status: 'queued' | 'joining' | 'in_progress' | 'completed' | 'failed';
  duration?: number;
  language?: string;
  participants?: string[];
  segments?: Array<{ speaker: string; text: string; start: number; end: number }>;
}

export class VexaProvider implements MeetingBotProvider {
  readonly id: ProviderId = 'vexa';
  readonly displayName = 'Vexa (bundled)';

  constructor(private readonly config: VexaProviderConfig) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok;
    } catch (err) {
      logger.debug({ err: (err as Error).message }, 'Vexa health check failed');
      return false;
    }
  }

  async scheduleBot(input: ScheduleBotInput): Promise<ScheduleBotResult> {
    const res = await fetch(`${this.config.baseUrl}/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_url: input.meetingUrl,
        bot_name: input.botName ?? 'Workforce0 Bot',
        metadata: { tenantId: input.tenantId, meetingId: input.meetingId },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Vexa scheduleBot failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { id: string; status?: string };
    return { botId: data.id, status: (data.status as ScheduleBotResult['status']) ?? 'scheduled' };
  }

  async cancelBot(botId: string): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/bots/${botId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Vexa cancelBot failed: ${res.status}`);
    }
  }

  async getTranscript(botId: string): Promise<MeetingTranscript | null> {
    const res = await fetch(`${this.config.baseUrl}/bots/${botId}/transcript`);
    if (!res.ok) {
      throw new Error(`Vexa getTranscript failed: ${res.status}`);
    }
    const data = (await res.json()) as VexaBotStatusBody;
    if (data.status !== 'completed' || !data.segments || data.segments.length === 0) return null;

    const segments: TranscriptSegment[] = data.segments.map((s) => ({
      speaker: s.speaker,
      text: s.text,
      startSec: s.start,
      endSec: s.end,
    }));
    return {
      segments,
      durationSec: data.duration ?? 0,
      participants: data.participants ?? [...new Set(segments.map((s) => s.speaker))],
      language: data.language ?? 'en',
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx vitest run src/services/meeting-bot/providers/vexa.provider.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/services/meeting-bot/providers/vexa.provider.ts src/services/meeting-bot/providers/vexa.provider.test.ts
git commit -m "feat(meeting-bot): VexaProvider for bundled meeting bot"
```

---

## Task 7: Barrel exports and DI wiring

**Files:**
- Create: `backend/src/services/meeting-bot/index.ts`
- Modify: `backend/src/lib/di-container.ts`

- [ ] **Step 1: Create the barrel export**

Create `backend/src/services/meeting-bot/index.ts`:

```ts
export * from './meeting-bot-provider.types.js';
export { MeetingBotRouter } from './meeting-bot-router.service.js';
export { ManualProvider } from './providers/manual.provider.js';
export { RecallProvider, type RecallProviderConfig } from './providers/recall.provider.js';
export { VexaProvider, type VexaProviderConfig } from './providers/vexa.provider.js';
```

- [ ] **Step 2: Read existing di-container.ts service-creation section**

```bash
cd backend && grep -n "fastify.services" src/lib/di-container.ts | head -20
```
Expected: line numbers where services are decorated. Use these to find where to insert the new wiring.

- [ ] **Step 3: Add imports and wiring**

In `backend/src/lib/di-container.ts`, add near the other service imports (around line 100):

```ts
// Meeting bot abstraction (Step 0 — §6 + §7)
import {
  MeetingBotRouter,
  ManualProvider,
  RecallProvider,
  VexaProvider,
} from '../services/meeting-bot/index.js';
```

Find the section where services are constructed and added to `fastify.services`, and add:

```ts
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
// MeetingBotRouter expects. Using a thin inline adapter avoids a
// premature TenantSettingsService extraction.
const tenantSettingsAdapter = {
  get: async (tenantId: string) => {
    const row = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    return { meetingBotProviderId: (row?.meetingBotProviderId ?? null) as 'vexa' | 'recall' | 'manual' | null };
  },
};

const meetingBotRouter = new MeetingBotRouter(
  [vexaProvider, recallProvider, manualProvider],
  tenantSettingsAdapter,
);

// Expose on fastify.services. Keep webhookSecret as a top-level field
// (rather than exposing the whole RecallProvider instance) so the
// webhook route doesn't depend on provider implementation details.
fastify.decorate('services', {
  ...fastify.services,
  meetingBotRouter,
  recallWebhookSecret: config.RECALL_WEBHOOK_SECRET,
});
```

(If `fastify.decorate` is already called once with a single object literal, merge these into that literal instead of decorating twice.)

- [ ] **Step 4: Add new env keys to config**

Find `backend/src/config/index.ts`. Add:

```ts
RECALL_API_KEY: z.string().optional().transform((v) => (v && v.length > 0 ? v : undefined)),
RECALL_WEBHOOK_SECRET: z.string().optional().transform((v) => (v && v.length > 0 ? v : undefined)),
VEXA_API_URL: z.string().optional().transform((v) => (v && v.length > 0 ? v : undefined)),
```

(Match the existing Zod schema style in that file. The empty-string-to-undefined transform is the codebase convention from CLAUDE.md.)

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd backend && npm run typecheck
```
Expected: zero errors. If `fastify.services` types need extension, look at how existing services declare their type augmentation (typically `declare module 'fastify' { interface FastifyInstance { services: { ... } } }`) and add `meetingBotRouter: MeetingBotRouter` and `recallProvider: RecallProvider` there.

- [ ] **Step 6: Run all backend tests**

```bash
cd backend && npx vitest run
```
Expected: all existing tests still pass; the 17 new tests from Tasks 2/4/5/6 also pass.

- [ ] **Step 7: Commit**

```bash
cd backend
git add src/services/meeting-bot/index.ts src/lib/di-container.ts src/config/index.ts
git commit -m "feat(di): wire meeting-bot router and providers into Fastify services"
```

---

## Task 8: Replace 410 stub in `/api/meetings/schedule`

**Files:**
- Modify: `backend/src/routes/meetings.routes.ts`

- [ ] **Step 1: Read the existing stub**

```bash
cd backend && grep -n "FEATURE_REMOVED" src/routes/meetings.routes.ts
```
Expected: the line range of the 410 stub (around lines 119-130 per the spec exploration). Inspect it to confirm the surrounding handler signature and request shape.

- [ ] **Step 2: Replace the handler body**

In `backend/src/routes/meetings.routes.ts`, find the `POST /` schedule handler (the one currently returning 410) and replace its body with:

```ts
async (request: FastifyRequest, reply: FastifyReply) => {
  const tenantId = (request as FastifyRequest & { tenantId: string }).tenantId;

  // Body should already be validated by the route's `schema`; cast here.
  const body = request.body as { meetingUrl: string; title?: string; botName?: string };

  // Resolve provider via router (handles fallback chain).
  const provider = await fastify.services.meetingBotRouter.resolveProvider(tenantId);

  // Manual is always available; if it's what we got, the user must upload.
  if (provider.id === 'manual') {
    return reply.status(503).send({
      success: false,
      error: {
        code: 'NO_BOT_PROVIDER',
        message: 'No live-capture provider is configured. Upload the recording after the meeting.',
      },
    });
  }

  // Create the Meeting row first so we have a stable id to attach to the bot.
  const meeting = await fastify.services.meetingService.createScheduled({
    tenantId,
    title: body.title ?? 'Scheduled meeting',
    meetingUrl: body.meetingUrl,
  });

  try {
    const result = await provider.scheduleBot({
      meetingUrl: body.meetingUrl,
      meetingId: meeting.id,
      tenantId,
      botName: body.botName,
    });
    return reply.status(201).send({
      success: true,
      data: {
        meetingId: meeting.id,
        botId: result.botId,
        status: result.status,
        provider: provider.id,
        estimatedJoinTime: result.estimatedJoinTime,
      },
    });
  } catch (err) {
    // Best-effort cleanup: cancel the orphan Meeting row.
    await fastify.services.meetingService.markFailed(meeting.id, (err as Error).message).catch(() => {});
    return reply.status(502).send({
      success: false,
      error: {
        code: 'BOT_SCHEDULE_FAILED',
        message: (err as Error).message,
      },
    });
  }
},
```

- [ ] **Step 3: Add `meetingService.createScheduled` and `markFailed` if they don't exist**

```bash
cd backend && grep -n "createScheduled\|markFailed" src/services/meeting/meeting.service.ts
```
Expected: either both methods exist (re-use them and skip this sub-step) or one/both don't (add them).

If missing, append to `backend/src/services/meeting/meeting.service.ts`:

```ts
  async createScheduled(input: { tenantId: string; title: string; meetingUrl: string }) {
    return this.prisma.meeting.create({
      data: {
        tenantId: input.tenantId,
        title: input.title,
        meetingUrl: input.meetingUrl,
        status: 'scheduled',
      },
    });
  }

  async markFailed(meetingId: string, reason: string) {
    return this.prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'failed', failureReason: reason },
    });
  }
```

If the Meeting model doesn't have `meetingUrl` or `failureReason` fields, add them via a quick additive migration:

```bash
cd backend && grep -n "^model Meeting" prisma/schema.prisma
```
Inspect; add missing optional fields:

```prisma
model Meeting {
  // ... existing fields ...
  meetingUrl    String?  // populated for live-bot meetings
  failureReason String?  // populated when status=failed
  // ... existing fields ...
}
```

Then:

```bash
cd backend && npx prisma migrate dev --name add_meeting_url_and_failure_reason
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd backend && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 5: Run targeted route tests**

```bash
cd backend && npx vitest run src/routes/__tests__/
```
Expected: existing meetings-route tests may need updating (the old test asserting 410 should now assert 201 with a manual fallback to 503). Update them to match the new behaviour.

For instance, change any test asserting `response.statusCode === 410` and `error.code === 'FEATURE_REMOVED'` to either:
- `response.statusCode === 503` and `error.code === 'NO_BOT_PROVIDER'` (when only manual is available), or
- `response.statusCode === 201` and `data.provider === 'vexa'` (when a bot is scheduled).

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/routes/meetings.routes.ts src/services/meeting/meeting.service.ts prisma/schema.prisma prisma/migrations/
# Also stage any updated route tests:
git add src/routes/__tests__/
git commit -m "feat(meetings): replace 410 stub with MeetingBotRouter dispatch"
```

---

## Task 9: Recall webhook route with HMAC validation

**Files:**
- Create: `backend/src/routes/webhooks/meeting-bot-recall.routes.ts`
- Modify: `backend/src/routes/index.ts` (mount the new router)

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/webhooks/__tests__/meeting-bot-recall.routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { meetingBotRecallWebhookRoutes } from '../meeting-bot-recall.routes.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const SECRET = 'test-secret';

function signBody(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function buildApp(): FastifyInstance {
  const app = Fastify();
  // Stub the services the handler reads.
  (app as unknown as { services: Record<string, unknown> }).services = {
    recallWebhookSecret: SECRET,
    meetingService: { handleBotEvent: vi.fn().mockResolvedValue(undefined) },
  };
  // Capture raw body for HMAC verification.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const json = JSON.parse(body as string);
      (req as unknown as { rawBody: string }).rawBody = body as string;
      done(null, json);
    } catch (err) {
      done(err as Error);
    }
  });
  app.register(meetingBotRecallWebhookRoutes, { prefix: '/webhooks/meeting-bot' });
  return app;
}

describe('Recall webhook route', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });

  it('rejects requests without a signature header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meeting-bot/recall',
      payload: '{"event":"x"}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with a wrong signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meeting-bot/recall',
      payload: '{"event":"x"}',
      headers: { 'content-type': 'application/json', 'x-recall-signature': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts correctly-signed requests and dispatches the event', async () => {
    const body = '{"event":"bot.transcript_ready","data":{"bot_id":"b1"}}';
    const sig = signBody(body, SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meeting-bot/recall',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-recall-signature': sig },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 503 when no webhookSecret is configured', async () => {
    (app as unknown as { services: { recallWebhookSecret: string | undefined } })
      .services.recallWebhookSecret = undefined;
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meeting-bot/recall',
      payload: '{}',
      headers: { 'content-type': 'application/json', 'x-recall-signature': 'whatever' },
    });
    expect(res.statusCode).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx vitest run src/routes/webhooks/__tests__/meeting-bot-recall.routes.test.ts
```
Expected: FAIL with "Cannot find module '../meeting-bot-recall.routes.js'".

- [ ] **Step 3: Implement the route**

Create `backend/src/routes/webhooks/meeting-bot-recall.routes.ts`:

```ts
/**
 * Recall.ai webhook route. HMAC-validated via x-recall-signature header.
 *
 * @module routes/webhooks/meeting-bot-recall
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'RecallWebhook' });

export async function meetingBotRecallWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/recall', async (request: FastifyRequest, reply: FastifyReply) => {
    const services = (fastify as unknown as { services: { recallWebhookSecret: string | undefined; meetingService?: { handleBotEvent?: (e: unknown) => Promise<void> } } }).services;
    const secret = services.recallWebhookSecret;
    if (!secret) {
      return reply.status(503).send({
        success: false,
        error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'RECALL_WEBHOOK_SECRET is not set' },
      });
    }

    const sig = request.headers['x-recall-signature'];
    if (typeof sig !== 'string' || sig.length === 0) {
      return reply.status(401).send({ success: false, error: { code: 'MISSING_SIGNATURE' } });
    }

    // Use the raw body captured by the content-type parser registered in
    // app setup. This is the canonical bytes Recall signed; we cannot
    // re-stringify the parsed object reliably (whitespace, key ordering).
    const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;
    if (typeof rawBody !== 'string') {
      logger.error({}, 'Recall webhook: rawBody not captured (content-type parser not registered?)');
      return reply.status(500).send({ success: false, error: { code: 'RAW_BODY_MISSING' } });
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      logger.warn({ ip: request.ip }, 'Recall webhook signature mismatch');
      return reply.status(401).send({ success: false, error: { code: 'BAD_SIGNATURE' } });
    }

    try {
      // Hand off to meeting service (existing or future). We don't mind if
      // the handler doesn't exist yet — log and 200 so Recall doesn't retry.
      if (services.meetingService?.handleBotEvent) {
        await services.meetingService.handleBotEvent(request.body);
      } else {
        logger.info({ event: (request.body as { event?: string })?.event }, 'Recall event received but no handler registered');
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Recall event handler threw');
      return reply.status(500).send({ success: false, error: { code: 'HANDLER_ERROR' } });
    }

    return reply.status(200).send({ success: true });
  });
}
```

- [ ] **Step 4: Register a content-type parser that captures raw body**

The webhook handler reads `request.rawBody` to verify HMAC. Fastify's default JSON parser discards raw bytes. Find the app setup file (likely `backend/src/index.ts` or `backend/src/app.ts` — `grep -rn "Fastify(" backend/src --include="*.ts" | head -5`) and add right after the Fastify instance is created, before any routes are registered:

```ts
// Capture raw body for webhook HMAC verification (Recall, Twilio, etc).
// Without this, request.rawBody is undefined and signature checks fail.
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  try {
    const json = body === '' ? {} : JSON.parse(body as string);
    (req as unknown as { rawBody: string }).rawBody = body as string;
    done(null, json);
  } catch (err) {
    done(err as Error);
  }
});
```

Note: if the codebase already registers a custom JSON parser (search for `addContentTypeParser`), modify that one to also set `rawBody` instead of registering a duplicate.

- [ ] **Step 5: Mount the new route in `routes/index.ts`**

```bash
cd backend && grep -n "fastify.register" src/routes/index.ts | head -10
```
Expected: existing register patterns. Add (matching the style):

```ts
import { meetingBotRecallWebhookRoutes } from './webhooks/meeting-bot-recall.routes.js';
// ... existing imports ...

await fastify.register(meetingBotRecallWebhookRoutes, { prefix: '/webhooks/meeting-bot' });
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd backend && npx vitest run src/routes/webhooks/__tests__/meeting-bot-recall.routes.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 7: Commit**

```bash
cd backend
git add src/routes/webhooks/ src/routes/index.ts src/index.ts src/app.ts 2>/dev/null
# (only the file you actually modified for the parser will be staged)
git commit -m "feat(meeting-bot): Recall webhook route with HMAC signature validation"
```

---

## Task 10: Add Vexa stack to `docker-compose.prod.yml`

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Read existing compose file structure**

```bash
cat docker-compose.prod.yml
```
Expected: 4 existing services (postgres, redis, backend, frontend), 3 named volumes, 1 network. Note that `networks.workforce0` is the existing network — new services should join it.

- [ ] **Step 2: Add Vexa services under the `meeting-bot` profile**

In `docker-compose.prod.yml`, append before the `volumes:` section:

```yaml
  # ---------------------------------------------------------------------------
  # Vexa meeting bot (opt-in via COMPOSE_PROFILES=meeting-bot)
  # ---------------------------------------------------------------------------
  vexa-api:
    image: ghcr.io/vexa-project/vexa-api:0.6
    container_name: workforce0-vexa-api
    restart: unless-stopped
    profiles: ["meeting-bot"]
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD}@postgres:5432/workforce0_vexa
      REDIS_URL: redis://redis:6379/1
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:18056/health || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s
    networks:
      - workforce0

  vexa-bot-manager:
    image: ghcr.io/vexa-project/vexa-bot-manager:0.6
    container_name: workforce0-vexa-bot-manager
    restart: unless-stopped
    profiles: ["meeting-bot"]
    environment:
      DOCKER_HOST: tcp://docker-socket-proxy:2375
      VEXA_API_URL: http://vexa-api:18056
    depends_on:
      docker-socket-proxy:
        condition: service_started
      vexa-api:
        condition: service_healthy
    networks:
      - workforce0

  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:0.3
    container_name: workforce0-docker-socket-proxy
    restart: unless-stopped
    profiles: ["meeting-bot"]
    environment:
      CONTAINERS: 1
      POST: 1
      ALLOW_START: 1
      ALLOW_STOP: 1
      ALLOW_RESTARTS: 1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - workforce0

  # vexa-transcription is part of the meeting-bot profile too, but it
  # depends on the `whisper` service from Plan 2 (local-stt profile).
  # Plan 2 adds the `whisper` service. For Plan 1 we deliberately do
  # NOT add vexa-transcription — it would crash without whisper.
  # The wizard step that picks Vexa will also enable local-stt, ensuring
  # both services are present when meeting-bot is active.
```

- [ ] **Step 3: Add Postgres init for the `workforce0_vexa` database**

The `postgres` service is created with one DB (`workforce0`). Vexa needs `workforce0_vexa`. Add an init script to the postgres service:

```bash
mkdir -p backend/db-init
```

Create `backend/db-init/01-create-vexa-db.sql`:

```sql
-- Idempotent: create the workforce0_vexa database if it doesn't exist.
SELECT 'CREATE DATABASE workforce0_vexa'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'workforce0_vexa')\gexec
```

Update the `postgres` service in `docker-compose.prod.yml` to mount this:

```yaml
  postgres:
    image: postgres:15-alpine
    container_name: workforce0-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
      POSTGRES_DB: ${POSTGRES_DB:-workforce0}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backend/db-init:/docker-entrypoint-initdb.d:ro    # NEW
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - workforce0
```

(The `docker-entrypoint-initdb.d` runs only on first volume init; existing installs need to manually create the DB. Add a one-line note in `docs-site/src/content/docs/integrations/meeting-bot.md` — see Task 12.)

- [ ] **Step 4: Verify Compose syntax**

```bash
docker compose -f docker-compose.prod.yml config > /dev/null
```
Expected: zero errors. Validates the YAML and resolves variables.

- [ ] **Step 5: Verify the meeting-bot profile parses**

```bash
docker compose -f docker-compose.prod.yml --profile meeting-bot config > /dev/null
```
Expected: zero errors; output (sent to /dev/null) would include vexa-api, vexa-bot-manager, docker-socket-proxy.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.prod.yml backend/db-init/
git commit -m "feat(compose): add Vexa meeting-bot profile with socket-proxy isolation"
```

---

## Task 11: End-to-end integration test for the schedule flow

**Files:**
- Create: `backend/src/__tests__/integration/meeting-bot-router.integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `backend/src/__tests__/integration/meeting-bot-router.integration.test.ts`:

```ts
/**
 * Integration test: POST /api/meetings (schedule) goes through the router
 * and dispatches to the right provider, with deterministic fallback when
 * the preferred provider is unavailable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MeetingBotRouter } from '../../services/meeting-bot/meeting-bot-router.service.js';
import { ManualProvider } from '../../services/meeting-bot/providers/manual.provider.js';
import type { MeetingBotProvider, ProviderId } from '../../services/meeting-bot/meeting-bot-provider.types.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

function fakeProvider(id: ProviderId, available: boolean, scheduleResult?: { botId: string; status: 'scheduled' }): MeetingBotProvider {
  return {
    id, displayName: id,
    isAvailable: vi.fn().mockResolvedValue(available),
    scheduleBot: vi.fn().mockResolvedValue(scheduleResult ?? { botId: `${id}-bot-1`, status: 'scheduled' }),
    cancelBot: vi.fn(),
    getTranscript: vi.fn(),
  };
}

function buildApp(router: MeetingBotRouter, meetingService: { createScheduled: ReturnType<typeof vi.fn>; markFailed: ReturnType<typeof vi.fn> }): FastifyInstance {
  const app = Fastify();
  (app as unknown as { services: Record<string, unknown> }).services = { meetingBotRouter: router, meetingService };
  app.addHook('preHandler', (req, _reply, done) => {
    (req as unknown as { tenantId: string }).tenantId = 't1';
    done();
  });
  app.post('/api/meetings', async (request, reply) => {
    const tenantId = (request as unknown as { tenantId: string }).tenantId;
    const body = request.body as { meetingUrl: string; title?: string };
    const provider = await router.resolveProvider(tenantId);
    if (provider.id === 'manual') {
      return reply.status(503).send({ success: false, error: { code: 'NO_BOT_PROVIDER' } });
    }
    const meeting = await meetingService.createScheduled({ tenantId, title: body.title ?? 'X', meetingUrl: body.meetingUrl });
    try {
      const r = await provider.scheduleBot({ meetingUrl: body.meetingUrl, meetingId: meeting.id, tenantId });
      return reply.status(201).send({ success: true, data: { meetingId: meeting.id, botId: r.botId, status: r.status, provider: provider.id } });
    } catch (err) {
      await meetingService.markFailed(meeting.id, (err as Error).message).catch(() => {});
      return reply.status(502).send({ success: false, error: { code: 'BOT_SCHEDULE_FAILED', message: (err as Error).message } });
    }
  });
  return app;
}

describe('integration: POST /api/meetings via MeetingBotRouter', () => {
  let meetingService: { createScheduled: ReturnType<typeof vi.fn>; markFailed: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    meetingService = {
      createScheduled: vi.fn().mockResolvedValue({ id: 'm-1' }),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('schedules via vexa when vexa is available', async () => {
    const router = new MeetingBotRouter(
      [fakeProvider('vexa', true), fakeProvider('recall', true), new ManualProvider()],
      { get: async () => ({ meetingBotProviderId: null }) },
    );
    const app = buildApp(router, meetingService);
    const res = await app.inject({ method: 'POST', url: '/api/meetings', payload: { meetingUrl: 'https://meet.google.com/x' } });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.provider).toBe('vexa');
  });

  it('falls through to recall when vexa is unavailable', async () => {
    const router = new MeetingBotRouter(
      [fakeProvider('vexa', false), fakeProvider('recall', true), new ManualProvider()],
      { get: async () => ({ meetingBotProviderId: null }) },
    );
    const app = buildApp(router, meetingService);
    const res = await app.inject({ method: 'POST', url: '/api/meetings', payload: { meetingUrl: 'https://meet.google.com/x' } });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.provider).toBe('recall');
  });

  it('returns 503 with NO_BOT_PROVIDER when only manual is available', async () => {
    const router = new MeetingBotRouter(
      [fakeProvider('vexa', false), fakeProvider('recall', false), new ManualProvider()],
      { get: async () => ({ meetingBotProviderId: null }) },
    );
    const app = buildApp(router, meetingService);
    const res = await app.inject({ method: 'POST', url: '/api/meetings', payload: { meetingUrl: 'https://meet.google.com/x' } });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error.code).toBe('NO_BOT_PROVIDER');
    expect(meetingService.createScheduled).not.toHaveBeenCalled();
  });

  it('marks meeting failed when scheduleBot throws', async () => {
    const failingVexa = fakeProvider('vexa', true);
    (failingVexa.scheduleBot as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Vexa exploded'));
    const router = new MeetingBotRouter(
      [failingVexa, fakeProvider('recall', false), new ManualProvider()],
      { get: async () => ({ meetingBotProviderId: null }) },
    );
    const app = buildApp(router, meetingService);
    const res = await app.inject({ method: 'POST', url: '/api/meetings', payload: { meetingUrl: 'https://meet.google.com/x' } });
    expect(res.statusCode).toBe(502);
    expect(meetingService.markFailed).toHaveBeenCalledWith('m-1', 'Vexa exploded');
  });

  it('respects tenant preference (recall) over default order', async () => {
    const router = new MeetingBotRouter(
      [fakeProvider('vexa', true), fakeProvider('recall', true), new ManualProvider()],
      { get: async () => ({ meetingBotProviderId: 'recall' }) },
    );
    const app = buildApp(router, meetingService);
    const res = await app.inject({ method: 'POST', url: '/api/meetings', payload: { meetingUrl: 'https://meet.google.com/x' } });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.provider).toBe('recall');
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
cd backend && npx vitest run src/__tests__/integration/meeting-bot-router.integration.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 3: Run the entire backend test suite**

```bash
cd backend && npm test
```
Expected: all tests pass; the new test file is included automatically by Vitest's default glob.

- [ ] **Step 4: Commit**

```bash
cd backend
git add src/__tests__/integration/meeting-bot-router.integration.test.ts
git commit -m "test(meeting-bot): integration test covering router fallback + failure paths"
```

---

## Task 12: Documentation

**Files:**
- Create: `docs-site/src/content/docs/integrations/meeting-bot.md`
- Modify: `README.md` (one-line mention of the new profile)

- [ ] **Step 1: Find the existing integrations docs structure**

```bash
ls docs-site/src/content/docs/integrations/
```
Expected: list of existing integration docs (e.g. jira.md, gchat.md, whatsapp.md). Match the style of one of them (read `whatsapp.md` for reference — it's the most recently maintained).

- [ ] **Step 2: Write the new doc page**

Create `docs-site/src/content/docs/integrations/meeting-bot.md`:

```markdown
---
title: Meeting Bot
description: Three options for live meeting capture — bundled (Vexa), Recall.ai BYOK, or manual upload.
---

Workforce0 supports three modes for capturing live meetings. Pick the one that fits your install.

## Option 1 — Bundled (Vexa)

The simplest path. Workforce0 ships a Vexa stack as an opt-in Compose profile. No external account, no API key, audio stays on your host.

### Enable

Add `meeting-bot` to your active profiles (the wizard does this for you):

```bash
COMPOSE_PROFILES=meeting-bot docker compose -f docker-compose.prod.yml up -d
```

This adds three containers:

| Container | What it does |
|---|---|
| `workforce0-vexa-api` | HTTP API for scheduling/canceling bots |
| `workforce0-vexa-bot-manager` | Spawns per-meeting Chrome bot containers |
| `workforce0-docker-socket-proxy` | Whitelists `containers.{create,start,stop,inspect}` so bot-manager can spawn bots without root-on-host access |

### Security note

The bot-manager needs Docker control to spawn per-meeting containers. We isolate this through a socket proxy ([tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)) that whitelists only specific Docker API calls. If bot-manager were ever compromised, the attacker could spawn/kill containers but could not exec arbitrary commands or mount host paths.

### Existing installs

Vexa needs a separate database (`workforce0_vexa`) on your existing Postgres. New installs get this automatically via `backend/db-init/01-create-vexa-db.sql`. **For existing installs**, create it manually once:

```bash
docker compose exec postgres psql -U postgres -c "CREATE DATABASE workforce0_vexa"
```

## Option 2 — Recall.ai (BYOK)

If you'd rather a vendor-managed option, bring your own Recall.ai key.

### Enable

Set in `.env`:

```bash
RECALL_API_KEY=your-recall-key
RECALL_WEBHOOK_SECRET=your-webhook-signing-secret
```

Configure Recall to send webhooks to `https://your-host/webhooks/meeting-bot/recall`. The `RECALL_WEBHOOK_SECRET` is used to verify the `x-recall-signature` HMAC on every event.

### Cost

~$0.50/hour of meeting recorded (consult Recall.ai pricing for current rates).

### Trade-offs

- Most reliable joins (Recall handles SSO/captcha edge cases).
- Audio leaves your network and is processed by Recall's infrastructure.

## Option 3 — Skip (manual upload only)

Don't enable any of the above. Users upload recordings via the existing `/api/meetings/upload` endpoint after the meeting. Always works.

## How the router picks

If a tenant has a preferred provider in `tenantSettings.meetingBotProviderId`, that's tried first. Otherwise the order is `vexa → recall → manual`. Each provider's `isAvailable()` is checked at request time, so an unavailable Vexa stack falls through to Recall (if configured), then to "please upload" (HTTP 503 `NO_BOT_PROVIDER`).
```

- [ ] **Step 3: Add a one-line README mention**

```bash
grep -n "compose -f docker-compose.prod.yml" README.md
```
Expected: line numbers showing where the README mentions the prod compose. Add nearby:

```markdown
> **Optional:** add `--profile meeting-bot` to bundle a local meeting bot (Vexa) — see [Meeting Bot integration docs](https://docs.workforce0.com/integrations/meeting-bot/).
```

- [ ] **Step 4: Commit**

```bash
git add docs-site/src/content/docs/integrations/meeting-bot.md README.md
git commit -m "docs: meeting-bot integration page (Vexa + Recall + Manual)"
```

---

## Self-review checklist (run before opening PR)

Per `feedback_self_review_before_push` memory — do this before `git push`:

- [ ] **Concurrency**: no `findFirst → create/update` non-atomic patterns introduced.
- [ ] **Layer boundaries**: routes do not touch prisma directly; everything goes through `fastify.services.*`.
- [ ] **Swallowed errors**: every catch block either rethrows or has a justified reason for not (e.g. cleanup catch-all on best-effort cancellation).
- [ ] **Lookup tables**: provider IDs are literal `'vexa' | 'recall' | 'manual'` everywhere (no per-file rewrite of the list).
- [ ] **Comment accuracy**: spec-style notes in `manual.provider.ts` and `meeting-bot-router.service.ts` describe what the code actually does.
- [ ] **Test coverage**: each provider has unit tests; the router has 5 cases; the schedule route has integration tests for happy path + 3 failure paths.
- [ ] **Pino signature**: every `log.error/warn/info` uses `(obj, msg)` ordering — never `(msg, obj)`.

## Final verification (before merge)

- [ ] **Step 1: Run the full backend test suite**

```bash
cd backend && npm test
```
Expected: all tests green, including the ~21 new tests added across Tasks 2/4/5/6/9/11.

- [ ] **Step 2: Run typecheck**

```bash
cd backend && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 3: Validate Compose**

```bash
docker compose -f docker-compose.prod.yml --profile meeting-bot config > /dev/null
```
Expected: zero errors.

- [ ] **Step 4: Smoke test (optional, requires Docker)**

```bash
docker compose -f docker-compose.prod.yml --profile meeting-bot up -d
sleep 30
curl -fsS http://127.0.0.1:18056/health   # vexa-api health
docker compose -f docker-compose.prod.yml --profile meeting-bot down
```
Expected: vexa-api returns `200 OK`. Skip if Docker not running locally.

---

## Notes for the implementer

- **Why no MeetingBotConfig table**: per-tenant config (Recall keys) lives in `.env`, not the DB. The DB only stores the tenant's *choice* of provider (`meetingBotProviderId`). The full `MeetingBotConfig` table from §11 of the spec is for Plan 3, when the wizard supports per-tenant Recall keys.
- **Why no health/observability work here**: the §12 status dashboard, `/api/integrations/*/status`, `bin/diagnose.sh`, and Prometheus metrics are all Plan 3. This plan does the meeting-bot half of §6 + §7 only.
- **Why the inline tenantSettingsAdapter in DI**: avoids creating a `TenantSettingsService` premature abstraction. When Plan 3 adds the wizard fields (`step0Migrated`, `step0Dismissed`), the adapter will likely become a real service — promote it then, not now.
- **vexa-transcription is deliberately omitted**: it depends on the `whisper` service from Plan 2. If we added it now without whisper, `docker compose --profile meeting-bot up` would fail. Plan 2 introduces whisper; Plan 3's wizard ensures both profiles are active when the user picks Vexa.
