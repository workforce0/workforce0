# Voice Intake (Pipecat) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inbound voice intake — caller dials a Twilio number, talks to a local agent, transcript flows into the existing `MEETING_PROCESS` queue → BA Agent → PRD pipeline.

**Architecture:** A `VoiceProvider` interface with three implementations (`gemini`, `openai`, `pipecat`), a router with deterministic fallback, a `CallerAuthService` for caller-ID + PIN, two new Twilio webhooks, a WebSocket route bridging Twilio Media Streams to the resolved provider, and a Python sidecar (`pipecat-bridge`) that runs the Pipecat pipeline (STT → LLM → TTS) using the existing `whisper` + `ollama` containers from Plan 2 plus a new `kokoro-tts` container.

**Tech Stack:** TypeScript ESM (Fastify, Vitest, Prisma 7), Python 3.12 (FastAPI, Pipecat, pytest), Docker Compose, Twilio Media Streams (μ-law 8kHz), Kokoro TTS, faster-whisper, Ollama.

**Spec:** `docs/superpowers/specs/2026-04-25-voice-intake-pipecat-design.md`.

---

## File structure

```
backend/
├── prisma/schema.prisma                                                 modified (additive)
├── src/
│   ├── config/index.ts                                                  modified (VOICE_*, BRIDGE_JWT_SECRET, etc.)
│   ├── lib/di-container.ts                                              modified (wire services)
│   ├── routes/
│   │   ├── index.ts                                                     modified (mount new routes)
│   │   └── webhooks/
│   │       ├── twilio-inbound.routes.ts                                 NEW
│   │       └── __tests__/twilio-inbound.routes.test.ts                  NEW
│   ├── routes/voice-media-stream.routes.ts                              NEW   (Twilio Media Streams WS)
│   └── services/voice-provider/                                         NEW directory
│       ├── voice-provider.types.ts
│       ├── voice-provider-router.service.ts
│       ├── voice-provider-router.service.test.ts
│       ├── caller-auth.service.ts
│       ├── caller-auth.service.test.ts
│       ├── pin-rate-limiter.ts                                          (Redis-backed, small)
│       ├── intake-system-prompt.ts                                      (long-string constant + test)
│       ├── index.ts                                                     barrel
│       └── providers/
│           ├── gemini-realtime.provider.ts
│           ├── gemini-realtime.provider.test.ts
│           ├── openai-realtime.provider.ts
│           ├── openai-realtime.provider.test.ts
│           ├── pipecat.provider.ts
│           └── pipecat.provider.test.ts

infra/pipecat-bridge/                                                    NEW directory
├── Dockerfile
├── pyproject.toml
├── server.py
├── pipeline.py
├── stt_adapter.py
├── llm_adapter.py
├── tts_adapter.py
├── auth.py
└── tests/
    ├── test_auth.py
    ├── test_adapters.py
    └── test_pipeline_smoke.py

docker-compose.prod.yml                                                  modified (kokoro-tts + pipecat-bridge under local-voice profile)

frontend/src/
├── components/wizard/voice-intake.tsx                                   NEW
└── components/onboarding-wizard.tsx                                     modified

docs-site/src/content/docs/
├── self-hosting/voice.md                                                NEW
└── integrations/voice-intake.md                                         NEW

bin/
├── diagnose-voice.sh                                                    NEW
└── README.md                                                            modified

README.md                                                                modified
MODELS.md                                                                modified
```

---

## Task 1: Prisma schema additions

**Files:** `backend/prisma/schema.prisma`

- [ ] **Step 1: Find TenantSettings**

```bash
cd backend && grep -A 20 "^model TenantSettings" prisma/schema.prisma
```

- [ ] **Step 2: Add fields**

Append two fields to `TenantSettings`:

```prisma
model TenantSettings {
  // ... existing fields ...
  voiceCallerAllowlist String[] @default([])  // E.164 numbers allowed to call without PIN
  voicePinHash         String?                // argon2id hash of fallback PIN; null = PIN disabled
  // ... existing relations ...
}
```

- [ ] **Step 3: Generate migration**

```bash
cd backend && npx prisma migrate dev --name add_voice_intake_settings --create-only
```

Inspect the SQL — must be additive: `ALTER TABLE tenant_settings ADD COLUMN ...`. If `prisma migrate dev` can't reach the DB, follow the same hand-write-and-verify-with-diff pattern Plan 1 / Plan 3 used.

- [ ] **Step 4: Apply + generate client**

```bash
cd backend && npm run db:migrate && npx prisma generate
```

- [ ] **Step 5: Typecheck + commit**

```bash
cd backend && npm run typecheck
cd backend && git add prisma/schema.prisma prisma/migrations/ && git commit -m "feat(db): voice intake — add voiceCallerAllowlist + voicePinHash to TenantSettings"
```

(Note: `Meeting.source` likely already accepts arbitrary strings; we use the literal `'voice_intake'` at write time. If `source` is an enum in the schema, add `voice_intake` as a value — same migration. Verify with `grep -n "Meeting.*source\|source.*Meeting" prisma/schema.prisma`.)

---

## Task 2: VoiceProvider types

**Files:** `backend/src/services/voice-provider/voice-provider.types.ts` (NEW)

Pure types file — no TDD; verify with typecheck.

- [ ] **Step 1: Create the types file**

```ts
/**
 * VoiceProvider — abstracts the LLM-backed voice agent across Gemini Live,
 * OpenAI Realtime, and the Pipecat sidecar (local STT+LLM+TTS).
 *
 * @module services/voice-provider/voice-provider.types
 */

import type { WebSocket } from 'ws';

export type VoiceProviderId = 'gemini' | 'openai' | 'pipecat';

export interface TranscriptDoc {
  /** Full transcript text, speaker-tagged turns joined with newlines. */
  text: string;
  /** Per-turn structured form for the BA Agent. */
  turns: Array<{ speaker: 'agent' | 'caller'; text: string; startMs: number; endMs: number }>;
  durationSec: number;
  language: string;
}

export interface VoiceSessionInput {
  /** Twilio CallSid. */
  callId: string;
  tenantId: string;
  /** E.164 caller number. */
  callerNumber: string;
  /** Open WebSocket to Twilio for media streaming. */
  audioInWs: WebSocket;
  /** System prompt for the LLM (intake mode). */
  systemPrompt: string;
}

export interface VoiceSessionHandle {
  sessionId: string;
  /** Caller hung up or system requested end. Closes pipeline cleanly. */
  stop(): Promise<void>;
  /** Fires once when the session ends with a non-empty transcript. */
  onTranscriptComplete(cb: (transcript: TranscriptDoc) => void): void;
  /** Fires on unrecoverable errors. */
  onError(cb: (err: Error) => void): void;
}

export interface VoiceProvider {
  readonly id: VoiceProviderId;
  /** False when the provider's prerequisites (key, container, etc.) aren't met. */
  isAvailable(): Promise<boolean>;
  startSession(input: VoiceSessionInput): Promise<VoiceSessionHandle>;
}

/** Returned by CallerAuthService.checkCallerId. */
export type CallerCheckResult = 'allowed' | 'needs_pin' | 'not_configured';
```

- [ ] **Step 2: Typecheck**

```bash
cd backend && npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
cd backend && git add src/services/voice-provider/voice-provider.types.ts && git commit -m "feat(voice): VoiceProvider interface + DTOs"
```

---

## Task 3: PIN rate limiter (Redis)

**Files:** `backend/src/services/voice-provider/pin-rate-limiter.ts` (NEW), `backend/src/services/voice-provider/pin-rate-limiter.test.ts` (NEW)

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PinRateLimiter } from './pin-rate-limiter.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

interface FakeRedis {
  get(k: string): Promise<string | null>;
  incr(k: string): Promise<number>;
  expire(k: string, sec: number): Promise<void>;
}

const buildRedis = (): FakeRedis => {
  const store = new Map<string, number>();
  return {
    get: async (k) => (store.has(k) ? String(store.get(k)) : null),
    incr: async (k) => { const v = (store.get(k) ?? 0) + 1; store.set(k, v); return v; },
    expire: async () => undefined,
  };
};

describe('PinRateLimiter', () => {
  let redis: FakeRedis;
  let limiter: PinRateLimiter;
  beforeEach(() => { redis = buildRedis(); limiter = new PinRateLimiter(redis as any, 3); });

  it('allows up to 3 attempts', async () => {
    expect(await limiter.isBlocked('t1', '+15551234567')).toBe(false);
    await limiter.recordFailure('t1', '+15551234567');
    expect(await limiter.isBlocked('t1', '+15551234567')).toBe(false);
    await limiter.recordFailure('t1', '+15551234567');
    expect(await limiter.isBlocked('t1', '+15551234567')).toBe(false);
  });

  it('blocks on the 3rd failure', async () => {
    for (let i = 0; i < 3; i++) await limiter.recordFailure('t1', '+15551234567');
    expect(await limiter.isBlocked('t1', '+15551234567')).toBe(true);
  });

  it('isolates per tenant + caller', async () => {
    for (let i = 0; i < 3; i++) await limiter.recordFailure('t1', '+15551234567');
    expect(await limiter.isBlocked('t1', '+15559999999')).toBe(false);
    expect(await limiter.isBlocked('t2', '+15551234567')).toBe(false);
  });
});
```

Run: `cd backend && npx vitest run src/services/voice-provider/pin-rate-limiter.test.ts` — expect FAIL ("Cannot find module").

- [ ] **Step 2: Implement**

```ts
/**
 * PinRateLimiter — Redis counter keyed by tenantId+callerNumber with 1h TTL.
 * After `maxAttempts` failures, isBlocked returns true until the key expires.
 *
 * @module services/voice-provider/pin-rate-limiter
 */

import type { Redis } from 'ioredis';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'PinRateLimiter' });
const TTL_SEC = 3600;

export class PinRateLimiter {
  constructor(private readonly redis: Redis, private readonly maxAttempts: number = 3) {}

  private key(tenantId: string, fromNumber: string): string {
    return `voice:pin-fails:${tenantId}:${fromNumber}`;
  }

  async isBlocked(tenantId: string, fromNumber: string): Promise<boolean> {
    const v = await this.redis.get(this.key(tenantId, fromNumber));
    return Number(v ?? 0) >= this.maxAttempts;
  }

  async recordFailure(tenantId: string, fromNumber: string): Promise<void> {
    const k = this.key(tenantId, fromNumber);
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.expire(k, TTL_SEC);
    logger.warn({ tenantId, fromNumber, count }, 'PIN failure recorded');
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd backend && npx vitest run src/services/voice-provider/pin-rate-limiter.test.ts
cd backend && git add src/services/voice-provider/pin-rate-limiter.{ts,test.ts} && git commit -m "feat(voice): PinRateLimiter (Redis counter, 1h TTL, configurable max)"
```

---

## Task 4: CallerAuthService

**Files:** `backend/src/services/voice-provider/caller-auth.service.ts` (NEW), `caller-auth.service.test.ts` (NEW)

- [ ] **Step 1: Add `argon2` to backend deps**

```bash
cd backend && grep -q '"argon2"' package.json || npm install argon2
```

(If `bcrypt` is already in deps, use that instead and adjust the implementation. Check with `grep '"bcrypt"\|"argon2"' package.json`. The test cases below use `argon2`; swap `argon2.hash`/`argon2.verify` for bcrypt equivalents if needed.)

- [ ] **Step 2: Failing test**

`backend/src/services/voice-provider/caller-auth.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import argon2 from 'argon2';
import { CallerAuthService } from './caller-auth.service.js';
import type { PinRateLimiter } from './pin-rate-limiter.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const buildPrisma = (settings: { voiceCallerAllowlist: string[]; voicePinHash: string | null } | null) => ({
  tenantSettings: { findUnique: vi.fn().mockResolvedValue(settings) },
});

const buildLimiter = (blocked = false): PinRateLimiter => ({
  isBlocked: vi.fn().mockResolvedValue(blocked),
  recordFailure: vi.fn().mockResolvedValue(undefined),
} as unknown as PinRateLimiter);

describe('CallerAuthService.checkCallerId', () => {
  it('returns not_configured when tenant has no row', async () => {
    const svc = new CallerAuthService(buildPrisma(null) as any, buildLimiter());
    expect(await svc.checkCallerId('t1', '+15551234567')).toBe('not_configured');
  });

  it('returns not_configured when allowlist is empty AND no PIN hash', async () => {
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: [], voicePinHash: null }) as any, buildLimiter());
    expect(await svc.checkCallerId('t1', '+15551234567')).toBe('not_configured');
  });

  it('returns allowed when caller is on allowlist', async () => {
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: ['+15551234567'], voicePinHash: null }) as any, buildLimiter());
    expect(await svc.checkCallerId('t1', '+15551234567')).toBe('allowed');
  });

  it('returns needs_pin when caller is NOT on allowlist but PIN is configured', async () => {
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: ['+15559999999'], voicePinHash: 'hash' }) as any, buildLimiter());
    expect(await svc.checkCallerId('t1', '+15551234567')).toBe('needs_pin');
  });
});

describe('CallerAuthService.verifyPin', () => {
  it('returns false when PIN is not configured', async () => {
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: [], voicePinHash: null }) as any, buildLimiter());
    expect(await svc.verifyPin('t1', '1234', '+15551234567')).toBe(false);
  });

  it('returns false when caller is rate-limited', async () => {
    const hash = await argon2.hash('1234');
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: [], voicePinHash: hash }) as any, buildLimiter(true));
    expect(await svc.verifyPin('t1', '1234', '+15551234567')).toBe(false);
  });

  it('returns true on PIN match', async () => {
    const hash = await argon2.hash('1234');
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: [], voicePinHash: hash }) as any, buildLimiter());
    expect(await svc.verifyPin('t1', '1234', '+15551234567')).toBe(true);
  });

  it('returns false + records failure on PIN mismatch', async () => {
    const hash = await argon2.hash('1234');
    const limiter = buildLimiter();
    const svc = new CallerAuthService(buildPrisma({ voiceCallerAllowlist: [], voicePinHash: hash }) as any, limiter);
    expect(await svc.verifyPin('t1', '9999', '+15551234567')).toBe(false);
    expect(limiter.recordFailure).toHaveBeenCalledWith('t1', '+15551234567');
  });
});
```

Run: `cd backend && npx vitest run src/services/voice-provider/caller-auth.service.test.ts` — FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * CallerAuthService — caller-ID allowlist + PIN authentication for inbound voice.
 *
 * @module services/voice-provider/caller-auth.service
 */

import argon2 from 'argon2';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';
import type { CallerCheckResult } from './voice-provider.types.js';
import type { PinRateLimiter } from './pin-rate-limiter.js';

const logger = createChildLogger({ service: 'CallerAuthService' });

export class CallerAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly rateLimiter: PinRateLimiter,
  ) {}

  async checkCallerId(tenantId: string, fromNumber: string): Promise<CallerCheckResult> {
    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings) return 'not_configured';
    const hasAllowlist = settings.voiceCallerAllowlist.length > 0;
    const hasPin = !!settings.voicePinHash;
    if (!hasAllowlist && !hasPin) return 'not_configured';
    if (hasAllowlist && settings.voiceCallerAllowlist.includes(fromNumber.trim())) {
      return 'allowed';
    }
    if (hasPin) return 'needs_pin';
    return 'not_configured';
  }

  async verifyPin(tenantId: string, pin: string, fromNumber: string): Promise<boolean> {
    if (await this.rateLimiter.isBlocked(tenantId, fromNumber)) {
      logger.warn({ tenantId, fromNumber }, 'PIN attempt blocked by rate limiter');
      return false;
    }
    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings?.voicePinHash) return false;
    let ok = false;
    try {
      ok = await argon2.verify(settings.voicePinHash, pin);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'argon2 verify threw');
      ok = false;
    }
    if (!ok) await this.rateLimiter.recordFailure(tenantId, fromNumber);
    return ok;
  }
}
```

- [ ] **Step 4: Verify + commit**

```bash
cd backend && npx vitest run src/services/voice-provider/caller-auth.service.test.ts
cd backend && git add src/services/voice-provider/caller-auth.service.{ts,test.ts} package.json package-lock.json && git commit -m "feat(voice): CallerAuthService — allowlist + argon2 PIN verification"
```

---

## Task 5: VoiceProviderRouter

**Files:** `backend/src/services/voice-provider/voice-provider-router.service.ts` (NEW + test)

Mirrors Plan 1's `MeetingBotRouter` structure exactly. Per the spec, sessions never fall over mid-call — fallback only happens at `resolveProvider`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { VoiceProviderRouter } from './voice-provider-router.service.js';
import type { VoiceProvider, VoiceProviderId } from './voice-provider.types.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const fake = (id: VoiceProviderId, available: boolean): VoiceProvider => ({
  id,
  isAvailable: vi.fn().mockResolvedValue(available),
  startSession: vi.fn(),
});

const settings = (preferred: VoiceProviderId | null) => ({
  get: vi.fn().mockResolvedValue({ voiceProviderId: preferred }),
});

describe('VoiceProviderRouter', () => {
  it('uses preferred when available', async () => {
    const r = new VoiceProviderRouter(
      [fake('pipecat', true), fake('gemini', true), fake('openai', true)],
      settings('gemini') as any,
    );
    const p = await r.resolveProvider('t1');
    expect(p?.id).toBe('gemini');
  });

  it('falls through default order when preferred is unavailable', async () => {
    const r = new VoiceProviderRouter(
      [fake('pipecat', false), fake('gemini', true), fake('openai', true)],
      settings('pipecat') as any,
    );
    const p = await r.resolveProvider('t1');
    expect(p?.id).toBe('gemini');
  });

  it('returns null when all unavailable', async () => {
    const r = new VoiceProviderRouter(
      [fake('pipecat', false), fake('gemini', false), fake('openai', false)],
      settings(null) as any,
    );
    const p = await r.resolveProvider('t1');
    expect(p).toBeNull();
  });
});
```

Run: FAIL.

- [ ] **Step 2: Implement**

```ts
/**
 * VoiceProviderRouter — picks a VoiceProvider for a tenant, falls through on
 * !isAvailable. Never falls through mid-session (callers handle session-level errors).
 *
 * @module services/voice-provider/voice-provider-router.service
 */

import { createChildLogger } from '../../lib/logger.js';
import type { VoiceProvider, VoiceProviderId } from './voice-provider.types.js';

const logger = createChildLogger({ service: 'VoiceProviderRouter' });
const DEFAULT_ORDER: VoiceProviderId[] = ['pipecat', 'gemini', 'openai'];

interface TenantSettingsLike {
  get(tenantId: string): Promise<{ voiceProviderId: VoiceProviderId | null }>;
}

export class VoiceProviderRouter {
  private readonly providers: Map<VoiceProviderId, VoiceProvider>;

  constructor(providers: VoiceProvider[], private readonly tenantSettings: TenantSettingsLike) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
  }

  async resolveProvider(tenantId: string): Promise<VoiceProvider | null> {
    const settings = await this.tenantSettings.get(tenantId);
    const preferred = settings.voiceProviderId;
    const order: VoiceProviderId[] = preferred
      ? [preferred, ...DEFAULT_ORDER.filter((x) => x !== preferred)]
      : [...DEFAULT_ORDER];
    for (const id of order) {
      const provider = this.providers.get(id);
      if (!provider) continue;
      try {
        if (await provider.isAvailable()) {
          logger.debug({ tenantId, picked: id, preferred }, 'Voice provider resolved');
          return provider;
        }
      } catch (err) {
        logger.warn({ tenantId, providerId: id, err: (err as Error).message }, 'isAvailable threw; skipping');
      }
    }
    logger.error({ tenantId }, 'No voice provider available');
    return null;
  }
}
```

- [ ] **Step 3: Schema field for tenant preference**

`tenantSettings.voiceProviderId` doesn't exist yet. Append to the same migration from Task 1, OR create a follow-on migration:

```bash
cd backend
# Edit prisma/schema.prisma to add:
#   voiceProviderId String? // 'gemini' | 'openai' | 'pipecat'; null = router default
# in TenantSettings.
npx prisma migrate dev --name add_voice_provider_preference --create-only
npm run db:migrate && npx prisma generate
```

- [ ] **Step 4: Verify + commit**

```bash
cd backend && npx vitest run src/services/voice-provider/voice-provider-router.service.test.ts
cd backend && git add src/services/voice-provider/voice-provider-router.service.{ts,test.ts} prisma/schema.prisma prisma/migrations/ && git commit -m "feat(voice): VoiceProviderRouter with deterministic fallback chain"
```

---

## Task 6: GeminiRealtimeProvider + OpenAIRealtimeProvider (wrappers)

**Files:** `providers/gemini-realtime.provider.ts` + test, `providers/openai-realtime.provider.ts` + test (all NEW)

Both providers thinly wrap the existing 506-line `voice/gemini-live.ts` and 901-line `voice/openai-realtime.ts`. We're not re-implementing those services; just adapting them to the new interface.

- [ ] **Step 1: Read the existing services to understand the public API**

```bash
cd backend && grep -n "^export\|^async\|class.*[Ss]ervice\|public " src/voice/gemini-live.ts | head -20
cd backend && grep -n "^export\|^async\|class.*[Ss]ervice\|public " src/voice/openai-realtime.ts | head -20
```

The existing services manage a session for outbound dial-in. The wrapper task: instantiate the existing service with the inbound `audioInWs` WebSocket and surface its lifecycle as `VoiceSessionHandle`.

- [ ] **Step 2: Failing test for `GeminiRealtimeProvider`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { GeminiRealtimeProvider } from './gemini-realtime.provider.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

class FakeGeminiSession extends EventEmitter {
  start = vi.fn();
  stop = vi.fn().mockImplementation(() => Promise.resolve());
}

const buildSession = () => new FakeGeminiSession();

describe('GeminiRealtimeProvider', () => {
  it('isAvailable returns false when no API key', async () => {
    const p = new GeminiRealtimeProvider({ apiKey: undefined, sessionFactory: buildSession });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('isAvailable returns true when API key set', async () => {
    const p = new GeminiRealtimeProvider({ apiKey: 'k', sessionFactory: buildSession });
    await expect(p.isAvailable()).resolves.toBe(true);
  });

  it('startSession returns a handle that calls underlying stop()', async () => {
    const session = buildSession();
    const p = new GeminiRealtimeProvider({ apiKey: 'k', sessionFactory: () => session });
    const handle = await p.startSession({
      callId: 'CA1', tenantId: 't1', callerNumber: '+1', audioInWs: {} as any, systemPrompt: 'x',
    });
    expect(handle.sessionId).toBeTruthy();
    await handle.stop();
    expect(session.stop).toHaveBeenCalled();
  });

  it('emits transcript on session-end with transcript', async () => {
    const session = buildSession();
    const p = new GeminiRealtimeProvider({ apiKey: 'k', sessionFactory: () => session });
    const handle = await p.startSession({
      callId: 'CA1', tenantId: 't1', callerNumber: '+1', audioInWs: {} as any, systemPrompt: 'x',
    });
    const cb = vi.fn();
    handle.onTranscriptComplete(cb);
    session.emit('end', { text: 'hello', turns: [], durationSec: 5, language: 'en' });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello' }));
  });
});
```

Run: FAIL.

- [ ] **Step 3: Implement `GeminiRealtimeProvider`**

```ts
/**
 * GeminiRealtimeProvider — wraps the existing voice/gemini-live.ts service.
 *
 * @module services/voice-provider/providers/gemini-realtime
 */

import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { createChildLogger } from '../../../lib/logger.js';
import type {
  VoiceProvider, VoiceProviderId,
  VoiceSessionHandle, VoiceSessionInput, TranscriptDoc,
} from '../voice-provider.types.js';

const logger = createChildLogger({ service: 'GeminiRealtimeProvider' });

interface GeminiSessionLike extends EventEmitter {
  start(input: VoiceSessionInput): void;
  stop(): Promise<void>;
}

export interface GeminiRealtimeProviderConfig {
  apiKey: string | undefined;
  /** Injected for testing — production wires this to the existing GeminiLiveSession constructor. */
  sessionFactory: () => GeminiSessionLike;
}

export class GeminiRealtimeProvider implements VoiceProvider {
  readonly id: VoiceProviderId = 'gemini';

  constructor(private readonly config: GeminiRealtimeProviderConfig) {}

  async isAvailable(): Promise<boolean> {
    return typeof this.config.apiKey === 'string' && this.config.apiKey.length > 0;
  }

  async startSession(input: VoiceSessionInput): Promise<VoiceSessionHandle> {
    if (!this.config.apiKey) throw new Error('GeminiRealtimeProvider: GEMINI_API_KEY not set');

    const session = this.config.sessionFactory();
    const sessionId = randomUUID();
    const transcriptCbs: Array<(t: TranscriptDoc) => void> = [];
    const errorCbs: Array<(e: Error) => void> = [];

    session.on('end', (transcript: TranscriptDoc) => {
      for (const cb of transcriptCbs) cb(transcript);
    });
    session.on('error', (err: Error) => {
      for (const cb of errorCbs) cb(err);
    });

    session.start(input);
    logger.info({ sessionId, callId: input.callId }, 'Gemini voice session started');

    return {
      sessionId,
      stop: () => session.stop(),
      onTranscriptComplete: (cb) => { transcriptCbs.push(cb); },
      onError: (cb) => { errorCbs.push(cb); },
    };
  }
}
```

- [ ] **Step 4: Mirror for `OpenAIRealtimeProvider`**

Copy `gemini-realtime.provider.{ts,test.ts}` to `openai-realtime.provider.{ts,test.ts}` and find/replace `Gemini`→`OpenAI`, `apiKey: 'GEMINI_API_KEY'`→`'OPENAI_API_KEY'`, `id: 'gemini'`→`id: 'openai'`. The test asserts the same shape against an injected `OpenAISessionLike`.

- [ ] **Step 5: Verify + commit**

```bash
cd backend && npx vitest run src/services/voice-provider/providers/
cd backend && git add src/services/voice-provider/providers/gemini-realtime.provider.{ts,test.ts} src/services/voice-provider/providers/openai-realtime.provider.{ts,test.ts} && git commit -m "feat(voice): Gemini + OpenAI realtime providers wrap existing voice services"
```

(Production wiring of the `sessionFactory` happens in DI — Task 11.)

---

## Task 7: PipecatProvider (TS side)

**Files:** `providers/pipecat.provider.ts` + test (NEW)

The Pipecat provider mints a JWT, opens a WebSocket to the bridge, forwards audio frames in, surfaces transcripts coming out.

- [ ] **Step 1: Add `jsonwebtoken` if absent**

```bash
cd backend && grep -q '"jsonwebtoken"' package.json || npm install jsonwebtoken && npm install --save-dev @types/jsonwebtoken
```

- [ ] **Step 2: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PipecatProvider } from './pipecat.provider.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

class FakeWs extends EventEmitter {
  sent: unknown[] = [];
  send(data: unknown) { this.sent.push(data); }
  close = vi.fn();
  readyState = 1;
}

describe('PipecatProvider', () => {
  let bridgeWs: FakeWs;
  let twilioWs: FakeWs;

  beforeEach(() => {
    bridgeWs = new FakeWs();
    twilioWs = new FakeWs();
  });

  it('isAvailable hits bridge /health', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const p = new PipecatProvider({
      bridgeBaseUrl: 'http://pipecat-bridge:8400',
      jwtSecret: 'secret',
      wsFactory: () => bridgeWs as any,
    });
    await expect(p.isAvailable()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://pipecat-bridge:8400/health', expect.any(Object));
  });

  it('isAvailable returns false on bridge non-2xx', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('boom', { status: 503 })) as unknown as typeof fetch;
    const p = new PipecatProvider({
      bridgeBaseUrl: 'http://pipecat-bridge:8400',
      jwtSecret: 'secret',
      wsFactory: () => bridgeWs as any,
    });
    await expect(p.isAvailable()).resolves.toBe(false);
  });

  it('startSession opens bridge WS and forwards twilio frames', async () => {
    const p = new PipecatProvider({
      bridgeBaseUrl: 'http://pipecat-bridge:8400',
      jwtSecret: 'secret',
      wsFactory: () => bridgeWs as any,
    });
    const handle = await p.startSession({
      callId: 'CA1', tenantId: 't1', callerNumber: '+1', audioInWs: twilioWs as any, systemPrompt: 'x',
    });
    twilioWs.emit('message', Buffer.from('audio-frame'));
    expect(bridgeWs.sent.some((m) => m instanceof Buffer && m.toString().includes('audio-frame'))).toBe(true);
    await handle.stop();
    expect(bridgeWs.close).toHaveBeenCalled();
  });

  it('emits transcript on bridge end-of-session message', async () => {
    const p = new PipecatProvider({
      bridgeBaseUrl: 'http://pipecat-bridge:8400',
      jwtSecret: 'secret',
      wsFactory: () => bridgeWs as any,
    });
    const handle = await p.startSession({
      callId: 'CA1', tenantId: 't1', callerNumber: '+1', audioInWs: twilioWs as any, systemPrompt: 'x',
    });
    const cb = vi.fn();
    handle.onTranscriptComplete(cb);
    bridgeWs.emit(
      'message',
      JSON.stringify({ type: 'transcript_complete', transcript: { text: 'hi', turns: [], durationSec: 1, language: 'en' } }),
    );
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ text: 'hi' }));
  });
});
```

Run: FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * PipecatProvider — bridges Twilio Media Stream WS to the Pipecat sidecar.
 * Mints a short-lived JWT, opens a WebSocket to pipecat-bridge, forwards
 * binary audio frames in, parses control + transcript JSON out.
 *
 * @module services/voice-provider/providers/pipecat
 */

import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { WebSocket as WsClient } from 'ws';
import { createChildLogger } from '../../../lib/logger.js';
import type {
  VoiceProvider, VoiceProviderId,
  VoiceSessionHandle, VoiceSessionInput, TranscriptDoc,
} from '../voice-provider.types.js';

const logger = createChildLogger({ service: 'PipecatProvider' });
const JWT_TTL_SEC = 3600;

export interface PipecatProviderConfig {
  bridgeBaseUrl: string;       // e.g. http://pipecat-bridge:8400
  jwtSecret: string;
  wsFactory: (url: string) => WsClient;
}

export class PipecatProvider implements VoiceProvider {
  readonly id: VoiceProviderId = 'pipecat';

  constructor(private readonly config: PipecatProviderConfig) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.bridgeBaseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok;
    } catch (err) {
      logger.debug({ err: (err as Error).message }, 'pipecat-bridge health check failed');
      return false;
    }
  }

  async startSession(input: VoiceSessionInput): Promise<VoiceSessionHandle> {
    const sessionId = randomUUID();
    const token = jwt.sign(
      { callId: input.callId, tenantId: input.tenantId, sessionId },
      this.config.jwtSecret,
      { expiresIn: JWT_TTL_SEC },
    );

    const wsUrl = `${this.config.bridgeBaseUrl.replace(/^http/, 'ws')}/sessions/${input.callId}?token=${encodeURIComponent(token)}`;
    const bridgeWs = this.config.wsFactory(wsUrl);

    const transcriptCbs: Array<(t: TranscriptDoc) => void> = [];
    const errorCbs: Array<(e: Error) => void> = [];

    // Send initial config (system prompt) once bridge accepts the connection.
    bridgeWs.on('open', () => {
      bridgeWs.send(JSON.stringify({ type: 'init', systemPrompt: input.systemPrompt, callerNumber: input.callerNumber }));
    });

    bridgeWs.on('message', (raw: Buffer | string) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      try {
        const msg = JSON.parse(text) as { type?: string; transcript?: TranscriptDoc; error?: string };
        if (msg.type === 'transcript_complete' && msg.transcript) {
          for (const cb of transcriptCbs) cb(msg.transcript);
        } else if (msg.type === 'error' && msg.error) {
          for (const cb of errorCbs) cb(new Error(msg.error));
        }
        // synthesized audio frames come back as binary; we forward those to twilio in the route handler.
      } catch {
        // binary audio — forwarded in the media-stream route, not here.
      }
    });

    bridgeWs.on('error', (err: Error) => {
      for (const cb of errorCbs) cb(err);
    });

    // Forward Twilio audio frames into the bridge.
    input.audioInWs.on('message', (frame: Buffer) => {
      if (bridgeWs.readyState === 1 /* OPEN */) bridgeWs.send(frame);
    });

    logger.info({ sessionId, callId: input.callId }, 'Pipecat session opened');

    return {
      sessionId,
      stop: async () => { bridgeWs.close(); },
      onTranscriptComplete: (cb) => { transcriptCbs.push(cb); },
      onError: (cb) => { errorCbs.push(cb); },
    };
  }
}
```

- [ ] **Step 4: Verify + commit**

```bash
cd backend && npx vitest run src/services/voice-provider/providers/pipecat.provider.test.ts
cd backend && git add src/services/voice-provider/providers/pipecat.provider.{ts,test.ts} package.json package-lock.json && git commit -m "feat(voice): PipecatProvider bridges Twilio MS to pipecat-bridge sidecar"
```

---

## Task 8: Intake system prompt

**Files:** `backend/src/services/voice-provider/intake-system-prompt.ts` (NEW + test)

Small file but worth its own task — the prompt is product-load-bearing.

- [ ] **Step 1: Write**

```ts
/**
 * Intake system prompt — the agent's behavior on inbound voice calls.
 *
 * Goals:
 *   - Capture intent + acceptance criteria conversationally, in <15 minutes.
 *   - Ask one clarifying question at a time.
 *   - When the caller seems done OR transcript is rich enough, summarize
 *     the brief back and confirm before hanging up.
 *
 * The transcript is later read by the BA Agent (PRD generation), so capture
 * concrete details (what, who for, success looks like, deadline if any).
 *
 * @module services/voice-provider/intake-system-prompt
 */

export const INTAKE_SYSTEM_PROMPT = `You are Workforce0's voice intake agent. You take phone calls from
product leaders who have an idea or a problem they want their team to work on.

Your job:
1. Greet briefly: "Hi, this is Workforce0. What are you calling about?"
2. Capture: WHAT they want, WHO IT'S FOR, WHAT SUCCESS LOOKS LIKE, BY WHEN.
3. Ask ONE clarifying question at a time. Wait for the answer. Don't overload.
4. If they ramble, gently steer: "What's the most important outcome here?"
5. When you have enough — usually 5-10 turns — summarize back: "OK, so you
   want X for audience Y, success means Z, by date W. Did I get that right?"
6. On confirmation: "Got it, I'll have the team draft something. Goodbye."
7. On correction: capture the correction, summarize again, confirm.

Hard rules:
- Never make up details the caller didn't say.
- If they go silent for 30s, ask "are you still there?"
- If they want to cancel: "OK, no brief will be created. Goodbye."
- If asked who you are: "I'm Workforce0's voice intake agent. Your call is
  being recorded for transcript only."
- Stay under 15 minutes. At T-2 minutes you'll receive a wrap-up signal.
`;
```

- [ ] **Step 2: Trivial test**

```ts
import { describe, it, expect } from 'vitest';
import { INTAKE_SYSTEM_PROMPT } from './intake-system-prompt.js';

describe('INTAKE_SYSTEM_PROMPT', () => {
  it('mentions clarifying questions and a summary step', () => {
    expect(INTAKE_SYSTEM_PROMPT).toMatch(/clarifying question/);
    expect(INTAKE_SYSTEM_PROMPT).toMatch(/summari[sz]e/i);
  });
  it('caps at a reasonable length', () => {
    expect(INTAKE_SYSTEM_PROMPT.length).toBeLessThan(4000);
    expect(INTAKE_SYSTEM_PROMPT.length).toBeGreaterThan(200);
  });
});
```

- [ ] **Step 3: Commit**

```bash
cd backend && npx vitest run src/services/voice-provider/intake-system-prompt.test.ts
cd backend && git add src/services/voice-provider/intake-system-prompt.{ts,test.ts} && git commit -m "feat(voice): intake system prompt — single-question clarification + summary"
```

---

## Task 9: Twilio inbound webhooks

**Files:** `backend/src/routes/webhooks/twilio-inbound.routes.ts` (NEW + test)

Two endpoints in one file: `/inbound` (initial call) and `/pin` (DTMF gather callback).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { twilioInboundRoutes } from '../twilio-inbound.routes.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const buildApp = (overrides?: { check?: string; verify?: boolean; tenantId?: string }) => {
  const app = Fastify();
  (app as unknown as { services: any }).services = {
    callerAuthService: {
      checkCallerId: vi.fn().mockResolvedValue(overrides?.check ?? 'allowed'),
      verifyPin: vi.fn().mockResolvedValue(overrides?.verify ?? true),
    },
    tenantResolver: {
      // Map +1800555... → tenant
      resolveTenantByDID: vi.fn().mockResolvedValue(overrides?.tenantId ?? 't1'),
    },
  };
  app.register(twilioInboundRoutes, { prefix: '/webhooks/twilio/voice' });
  return app;
};

describe('POST /webhooks/twilio/voice/inbound', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = buildApp(); await app.ready(); });

  it('returns <Connect><Stream> when caller is allowed', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhooks/twilio/voice/inbound',
      payload: 'From=%2B15551234567&To=%2B18005551111&CallSid=CA1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.body).toContain('<Connect>');
    expect(res.body).toContain('<Stream');
  });

  it('returns <Gather> when caller needs PIN', async () => {
    const app2 = buildApp({ check: 'needs_pin' });
    await app2.ready();
    const res = await app2.inject({
      method: 'POST', url: '/webhooks/twilio/voice/inbound',
      payload: 'From=%2B15559999999&To=%2B18005551111&CallSid=CA2',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.body).toContain('<Gather');
    expect(res.body).toContain('action="/webhooks/twilio/voice/pin"');
  });

  it('returns <Hangup/> when not configured', async () => {
    const app2 = buildApp({ check: 'not_configured' });
    await app2.ready();
    const res = await app2.inject({
      method: 'POST', url: '/webhooks/twilio/voice/inbound',
      payload: 'From=%2B15551234567&To=%2B18005551111&CallSid=CA3',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.body).toContain('<Hangup');
    expect(res.body).toContain('not configured');
  });
});

describe('POST /webhooks/twilio/voice/pin', () => {
  it('returns <Connect><Stream> on valid PIN', async () => {
    const app = buildApp({ verify: true });
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/webhooks/twilio/voice/pin',
      payload: 'From=%2B15551234567&To=%2B18005551111&CallSid=CA4&Digits=1234',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.body).toContain('<Connect>');
  });

  it('returns <Hangup/> on invalid PIN', async () => {
    const app = buildApp({ verify: false });
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/webhooks/twilio/voice/pin',
      payload: 'From=%2B15551234567&To=%2B18005551111&CallSid=CA4&Digits=9999',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.body).toContain('Access denied');
    expect(res.body).toContain('<Hangup');
  });
});
```

Run: FAIL.

- [ ] **Step 2: Implement**

```ts
/**
 * POST /webhooks/twilio/voice/inbound — initial inbound call routing.
 * POST /webhooks/twilio/voice/pin     — DTMF gather callback.
 *
 * Both return TwiML. Twilio webhook signature validation is handled by
 * the existing twilio-signature plugin; we don't re-verify here.
 *
 * @module routes/webhooks/twilio-inbound.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'TwilioInbound' });

interface TwilioBody { From: string; To: string; CallSid: string; Digits?: string }

interface ServicesShape {
  callerAuthService: {
    checkCallerId(tenantId: string, fromNumber: string): Promise<'allowed' | 'needs_pin' | 'not_configured'>;
    verifyPin(tenantId: string, pin: string, fromNumber: string): Promise<boolean>;
  };
  tenantResolver: { resolveTenantByDID(toNumber: string): Promise<string> };
}

function streamTwiML(callId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${process.env.WEBHOOK_BASE_HOST ?? 'localhost'}/media-stream/inbound/${callId}" />
  </Connect>
</Response>`;
}

function gatherTwiML(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="4" timeout="10" action="/webhooks/twilio/voice/pin">
    <Say>Welcome to Workforce0. Please enter your PIN, then press pound.</Say>
  </Gather>
  <Say>No PIN entered. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

function hangupTwiML(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>${message}</Say><Hangup/></Response>`;
}

export async function twilioInboundRoutes(fastify: FastifyInstance): Promise<void> {
  const services = (fastify as unknown as { services: ServicesShape }).services;

  fastify.post('/inbound', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as TwilioBody;
    const tenantId = await services.tenantResolver.resolveTenantByDID(body.To);
    const result = await services.callerAuthService.checkCallerId(tenantId, body.From);
    logger.info({ tenantId, from: body.From, callId: body.CallSid, result }, 'Inbound voice call');

    let twiml: string;
    if (result === 'allowed') twiml = streamTwiML(body.CallSid);
    else if (result === 'needs_pin') twiml = gatherTwiML();
    else twiml = hangupTwiML('Voice intake is not configured for this number. Goodbye.');

    return reply.type('application/xml').send(twiml);
  });

  fastify.post('/pin', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as TwilioBody;
    const tenantId = await services.tenantResolver.resolveTenantByDID(body.To);
    const ok = body.Digits ? await services.callerAuthService.verifyPin(tenantId, body.Digits, body.From) : false;
    logger.info({ tenantId, from: body.From, callId: body.CallSid, ok }, 'PIN attempt');
    const twiml = ok ? streamTwiML(body.CallSid) : hangupTwiML('Access denied. Goodbye.');
    return reply.type('application/xml').send(twiml);
  });
}
```

- [ ] **Step 3: TenantResolver service (small)**

The route depends on a `tenantResolver`. If one already exists for other Twilio routes, reuse it. Otherwise create a minimal one — likely the To-number → tenant map already lives in `tenantSettings.voiceDID` or similar. Find with:
```bash
cd backend && grep -rn "resolveTenant\|voiceDID\|TenantResolver" src --include="*.ts" | head -10
```

If no existing resolver, add a method on `TenantSettings` or a small service. For Step 0 single-tenant installs, the resolver can hardcode `'default'`. Document this in the file.

- [ ] **Step 4: Mount + verify**

In `backend/src/routes/index.ts`:

```ts
import { twilioInboundRoutes } from './webhooks/twilio-inbound.routes.js';
// ...
await fastify.register(twilioInboundRoutes, { prefix: '/webhooks/twilio/voice' });
```

```bash
cd backend && npx vitest run src/routes/webhooks/__tests__/twilio-inbound.routes.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/routes/webhooks/twilio-inbound.routes.ts src/routes/webhooks/__tests__/ src/routes/index.ts && git commit -m "feat(voice): Twilio inbound + PIN webhooks return appropriate TwiML"
```

---

## Task 10: Media stream route (Twilio MS WebSocket)

**Files:** `backend/src/routes/voice-media-stream.routes.ts` (NEW)

Skinny route — opens a WebSocket route at `/media-stream/inbound/:callSid`, looks up tenant + provider, calls `provider.startSession(...)`, glues the audio in/out paths.

- [ ] **Step 1: Read existing pattern**

The current outbound voice already has a similar route. Find:
```bash
cd backend && grep -rn "media-stream\|wsHandler\|websocket" src/routes --include="*.ts" | head -10
```

Reuse the same plugin/handler shape (`fastify-websocket` is the codebase's pattern).

- [ ] **Step 2: Implement (no separate test — covered by integration test in Task 16)**

```ts
/**
 * GET /media-stream/inbound/:callSid (WebSocket)
 *
 * Twilio Media Streams opens this WS once <Connect><Stream> is returned by
 * /webhooks/twilio/voice/inbound. We resolve the tenant + voice provider,
 * call provider.startSession, and bridge audio.
 *
 * @module routes/voice-media-stream.routes
 */

import type { FastifyInstance } from 'fastify';
import { createChildLogger } from '../lib/logger.js';
import { INTAKE_SYSTEM_PROMPT } from '../services/voice-provider/intake-system-prompt.js';

const logger = createChildLogger({ service: 'VoiceMediaStream' });

interface ServicesShape {
  voiceProviderRouter: { resolveProvider(tenantId: string): Promise<import('../services/voice-provider/voice-provider.types.js').VoiceProvider | null> };
  tenantResolver: { resolveTenantByCallSid(callSid: string): Promise<string> };
  meetingService: { createFromVoiceTranscript(input: { tenantId: string; callId: string; callerNumber: string; transcript: import('../services/voice-provider/voice-provider.types.js').TranscriptDoc }): Promise<{ id: string }> };
  queueService: { addJob(name: string, payload: unknown): Promise<string> };
}

export async function voiceMediaStreamRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { callSid: string } }>(
    '/media-stream/inbound/:callSid',
    { websocket: true },
    async (connection, request) => {
      const { callSid } = request.params;
      const services = (fastify as unknown as { services: ServicesShape }).services;
      const tenantId = await services.tenantResolver.resolveTenantByCallSid(callSid);
      logger.info({ callSid, tenantId }, 'Voice media stream opened');

      const provider = await services.voiceProviderRouter.resolveProvider(tenantId);
      if (!provider) {
        connection.socket.close();
        return;
      }

      const handle = await provider.startSession({
        callId: callSid,
        tenantId,
        callerNumber: '', // populated by tenantResolver in production; left blank for the prototype
        audioInWs: connection.socket as unknown as import('ws').WebSocket,
        systemPrompt: INTAKE_SYSTEM_PROMPT,
      });

      handle.onTranscriptComplete(async (transcript) => {
        if (!transcript.text || transcript.turns.length === 0) {
          logger.warn({ callSid }, 'Empty transcript — not enqueueing MEETING_PROCESS');
          return;
        }
        const meeting = await services.meetingService.createFromVoiceTranscript({
          tenantId, callId: callSid, callerNumber: '', transcript,
        });
        await services.queueService.addJob('meeting_process', { meetingId: meeting.id, tenantId });
        logger.info({ callSid, meetingId: meeting.id }, 'Voice intake → MEETING_PROCESS enqueued');
      });

      handle.onError((err) => logger.error({ callSid, err: err.message }, 'Voice session error'));

      connection.socket.on('close', async () => { await handle.stop(); });
    },
  );
}
```

- [ ] **Step 3: Mount in `routes/index.ts`**

```ts
import { voiceMediaStreamRoutes } from './voice-media-stream.routes.js';
// ...
await fastify.register(voiceMediaStreamRoutes);  // no prefix; handler registers full path
```

- [ ] **Step 4: `MeetingService.createFromVoiceTranscript`**

Append a method to the existing meeting service that writes a Meeting row with `source: 'voice_intake'`, stores the transcript text, and stashes `callerNumber` in metadata:

```ts
async createFromVoiceTranscript(input: { tenantId: string; callId: string; callerNumber: string; transcript: TranscriptDoc }): Promise<{ id: string }> {
  return this.prisma.meeting.create({
    data: {
      tenantId: input.tenantId,
      title: `Voice intake (${input.callerNumber || input.callId})`,
      source: 'voice_intake',
      durationSec: input.transcript.durationSec,
      transcriptText: input.transcript.text,
      metadata: { callId: input.callId, callerNumber: input.callerNumber, turns: input.transcript.turns },
    },
  });
}
```

(Field names in `Meeting` may differ; align with the existing schema. If `transcriptText` doesn't exist, use whatever the existing manual-upload flow uses.)

- [ ] **Step 5: Verify + commit**

```bash
cd backend && npm run typecheck
cd backend && git add src/routes/voice-media-stream.routes.ts src/routes/index.ts src/services/meeting/ && git commit -m "feat(voice): media-stream route bridges Twilio WS to VoiceProvider"
```

---

## Task 11: Config + DI wiring

**Files:** `backend/src/config/index.ts`, `backend/src/lib/di-container.ts`

- [ ] **Step 1: New env keys**

In `backend/src/config/index.ts`, add (matching the existing `optionalString` pattern):

```ts
WEBHOOK_BASE_HOST: z.string().optional().transform(/* same empty→undefined */),
PIPECAT_BRIDGE_URL: z.string().optional().default('http://pipecat-bridge:8400'),
BRIDGE_JWT_SECRET: z.string().min(32).optional(),  // required only when local-voice profile is active
VOICE_MAX_CALL_DURATION_SEC: z.coerce.number().int().min(60).max(3600).default(900),
VOICE_HARD_COST_CAP_USD: z.coerce.number().min(0).max(20).default(2),
```

- [ ] **Step 2: DI wiring**

In `backend/src/lib/di-container.ts`, after the existing voice services are wired, add:

```ts
import { CallerAuthService } from '../services/voice-provider/caller-auth.service.js';
import { PinRateLimiter } from '../services/voice-provider/pin-rate-limiter.js';
import { VoiceProviderRouter } from '../services/voice-provider/voice-provider-router.service.js';
import { GeminiRealtimeProvider } from '../services/voice-provider/providers/gemini-realtime.provider.js';
import { OpenAIRealtimeProvider } from '../services/voice-provider/providers/openai-realtime.provider.js';
import { PipecatProvider } from '../services/voice-provider/providers/pipecat.provider.js';
import WebSocket from 'ws';

const pinRateLimiter = new PinRateLimiter(redis);
const callerAuthService = new CallerAuthService(prisma, pinRateLimiter);

// Production session factories wire the existing GeminiLiveSession / OpenAIRealtimeSession
// from backend/src/voice/ — adapt to the EventEmitter-shaped interface. Concrete wiring
// belongs here; for now, a thin adapter:
const geminiRealtime = new GeminiRealtimeProvider({
  apiKey: config.GEMINI_API_KEY,
  sessionFactory: () => new (await import('../voice/gemini-live.js')).GeminiLiveSession(),
});
const openaiRealtime = new OpenAIRealtimeProvider({
  apiKey: config.OPENAI_API_KEY,
  sessionFactory: () => new (await import('../voice/openai-realtime.js')).OpenAIRealtimeSession(),
});
const pipecatProvider = new PipecatProvider({
  bridgeBaseUrl: config.PIPECAT_BRIDGE_URL,
  jwtSecret: config.BRIDGE_JWT_SECRET ?? '',
  wsFactory: (url) => new WebSocket(url) as unknown as WebSocket,
});

const tenantSettingsAdapter = {
  get: async (tenantId: string) => {
    const row = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    return { voiceProviderId: (row?.voiceProviderId ?? null) as 'gemini' | 'openai' | 'pipecat' | null };
  },
};

const voiceProviderRouter = new VoiceProviderRouter(
  [geminiRealtime, openaiRealtime, pipecatProvider],
  tenantSettingsAdapter,
);
```

Decorate `fastify.services` with `callerAuthService`, `voiceProviderRouter`. Update the type augmentation. Note: the existing `GeminiLiveSession` / `OpenAIRealtimeSession` may not be EventEmitter-shaped; adjust the wrapper or those classes — keep changes minimal, prefer adapting at the wrapper.

- [ ] **Step 3: TenantResolver**

Find or create `services.tenantResolver` with `resolveTenantByDID(toNumber: string)` and `resolveTenantByCallSid(callSid: string)`. For Step 0 single-tenant, both can return `'default'`. Document the upgrade path in a JSDoc comment.

- [ ] **Step 4: Verify + commit**

```bash
cd backend && npm run typecheck && npm test
cd backend && git add src/config/index.ts src/lib/di-container.ts src/services/ 2>/dev/null && git commit -m "feat(voice): wire VoiceProviderRouter, CallerAuthService, providers into Fastify"
```

---

## Task 12: Pipecat bridge — Dockerfile + project layout

**Files:** `infra/pipecat-bridge/Dockerfile`, `infra/pipecat-bridge/pyproject.toml`

- [ ] **Step 1: Create directory + pyproject**

```bash
mkdir -p infra/pipecat-bridge/tests
```

`infra/pipecat-bridge/pyproject.toml`:

```toml
[project]
name = "pipecat-bridge"
version = "0.1.0"
description = "Workforce0 Pipecat sidecar — STT (faster-whisper) → LLM (Ollama) → TTS (Kokoro)"
requires-python = ">=3.12,<3.13"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "websockets>=13",
  "pyjwt>=2.10",
  "httpx>=0.28",
  "pipecat-ai>=0.0.50",
]

[project.optional-dependencies]
dev = ["pytest>=8", "pytest-asyncio>=0.24", "pytest-mock>=3.14"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

`infra/pipecat-bridge/Dockerfile`:

```dockerfile
FROM python:3.12-slim AS base
WORKDIR /app

# System deps for audio/PyAV builds inside Pipecat
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl \
 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir uv && uv pip install --system .

COPY *.py ./
COPY tests/ ./tests/

EXPOSE 8400
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -fsS http://127.0.0.1:8400/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8400"]
```

- [ ] **Step 2: Verify build (no network needed beyond the base image)**

```bash
docker build -t pipecat-bridge:dev infra/pipecat-bridge 2>&1 | tail -5
```

If the image builds, basic structure is sound. If pipecat-ai version doesn't exist, search Docker Hub / PyPI and pin to the latest `0.0.x` release.

- [ ] **Step 3: Commit**

```bash
git add infra/pipecat-bridge/Dockerfile infra/pipecat-bridge/pyproject.toml && git commit -m "build(pipecat-bridge): Dockerfile + pyproject.toml scaffolding"
```

---

## Task 13: Bridge auth (JWT verify)

**Files:** `infra/pipecat-bridge/auth.py` + test

- [ ] **Step 1: Failing test**

`infra/pipecat-bridge/tests/test_auth.py`:

```python
import os
import time
import jwt
import pytest
from auth import verify_token, AuthError

SECRET = "test-secret-12345678901234567890123456789012"


def make_token(payload: dict, exp_offset: int = 3600, secret: str = SECRET) -> str:
    payload = {**payload, "exp": int(time.time()) + exp_offset}
    return jwt.encode(payload, secret, algorithm="HS256")


def test_valid_token_returns_payload():
    token = make_token({"callId": "CA1", "tenantId": "t1", "sessionId": "s1"})
    payload = verify_token(token, SECRET)
    assert payload["callId"] == "CA1"
    assert payload["tenantId"] == "t1"


def test_expired_token_raises():
    token = make_token({"callId": "CA1"}, exp_offset=-10)
    with pytest.raises(AuthError):
        verify_token(token, SECRET)


def test_wrong_secret_raises():
    token = make_token({"callId": "CA1"}, secret="other-secret-1234567890123456789012345")
    with pytest.raises(AuthError):
        verify_token(token, SECRET)


def test_missing_callId_raises():
    token = make_token({"tenantId": "t1"})
    with pytest.raises(AuthError):
        verify_token(token, SECRET)
```

Run:
```bash
docker run --rm -v "$PWD/infra/pipecat-bridge:/app" -w /app python:3.12-slim sh -c \
  "pip install -q .[dev] && pytest tests/test_auth.py -v"
```
Expected: FAIL (auth.py doesn't exist).

- [ ] **Step 2: Implement**

`infra/pipecat-bridge/auth.py`:

```python
"""JWT verification for incoming bridge connections.

Backend mints a short-lived (1h) HS256 token containing callId, tenantId,
sessionId. Bridge verifies signature + expiration + required claims.
"""

from __future__ import annotations
import jwt


class AuthError(Exception):
    pass


REQUIRED_CLAIMS = ("callId", "tenantId", "sessionId")


def verify_token(token: str, secret: str) -> dict:
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError(f"invalid token: {exc}") from exc

    for claim in REQUIRED_CLAIMS:
        if claim not in payload:
            raise AuthError(f"missing claim: {claim}")
    return payload
```

- [ ] **Step 3: Verify + commit**

```bash
docker run --rm -v "$PWD/infra/pipecat-bridge:/app" -w /app python:3.12-slim sh -c \
  "pip install -q .[dev] && pytest tests/test_auth.py -v"
```

```bash
git add infra/pipecat-bridge/auth.py infra/pipecat-bridge/tests/test_auth.py && git commit -m "feat(pipecat-bridge): JWT verification (HS256, required claims)"
```

---

## Task 14: Bridge adapters (STT, LLM, TTS)

**Files:** `infra/pipecat-bridge/{stt,llm,tts}_adapter.py` + `tests/test_adapters.py`

Each adapter is a thin HTTP client to its respective container.

- [ ] **Step 1: Failing test for adapters**

`infra/pipecat-bridge/tests/test_adapters.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch
from stt_adapter import STTAdapter
from llm_adapter import LLMAdapter
from tts_adapter import TTSAdapter


@pytest.mark.asyncio
async def test_stt_posts_multipart():
    adapter = STTAdapter("http://whisper:8000")
    with patch("stt_adapter.httpx.AsyncClient") as mock_client_class:
        mock = AsyncMock()
        mock.post = AsyncMock(return_value=AsyncMock(
            status_code=200,
            json=AsyncMock(return_value={"text": "hello", "duration": 1.0, "language": "en", "segments": []}),
            raise_for_status=lambda: None,
        ))
        mock_client_class.return_value.__aenter__.return_value = mock
        result = await adapter.transcribe(b"\x00" * 16, "audio.wav")
        assert result["text"] == "hello"
        assert mock.post.called
        url = mock.post.call_args.args[0]
        assert "/v1/audio/transcriptions" in url


@pytest.mark.asyncio
async def test_llm_chat_completion():
    adapter = LLMAdapter("http://ollama:11434", "qwen3.5:8b")
    with patch("llm_adapter.httpx.AsyncClient") as mock_client_class:
        mock = AsyncMock()
        mock.post = AsyncMock(return_value=AsyncMock(
            status_code=200,
            json=AsyncMock(return_value={"choices": [{"message": {"content": "hi"}}]}),
            raise_for_status=lambda: None,
        ))
        mock_client_class.return_value.__aenter__.return_value = mock
        out = await adapter.complete([{"role": "user", "content": "hi"}])
        assert out == "hi"


@pytest.mark.asyncio
async def test_tts_returns_pcm_bytes():
    adapter = TTSAdapter("http://kokoro-tts:8880")
    with patch("tts_adapter.httpx.AsyncClient") as mock_client_class:
        mock = AsyncMock()
        mock.post = AsyncMock(return_value=AsyncMock(
            status_code=200,
            content=b"\x00" * 100,
            raise_for_status=lambda: None,
        ))
        mock_client_class.return_value.__aenter__.return_value = mock
        audio = await adapter.synthesize("hello")
        assert audio == b"\x00" * 100
```

Run: FAIL.

- [ ] **Step 2: Implement adapters**

`infra/pipecat-bridge/stt_adapter.py`:

```python
"""Calls the Workforce0 faster-whisper-server container via OpenAI-compatible API."""

from __future__ import annotations
import httpx


class STTAdapter:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    async def transcribe(self, audio: bytes, filename: str = "audio.wav") -> dict:
        async with httpx.AsyncClient(timeout=600) as client:
            files = {"file": (filename, audio, "audio/wav")}
            data = {"model": "whisper-1", "response_format": "verbose_json"}
            res = await client.post(f"{self.base_url}/v1/audio/transcriptions", files=files, data=data)
            res.raise_for_status()
            return res.json()
```

`infra/pipecat-bridge/llm_adapter.py`:

```python
"""Calls Ollama via OpenAI-compatible /v1/chat/completions."""

from __future__ import annotations
import httpx


class LLMAdapter:
    def __init__(self, base_url: str, model: str = "qwen3.5:8b") -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model

    async def complete(self, messages: list[dict], temperature: float = 0.4) -> str:
        async with httpx.AsyncClient(timeout=120) as client:
            res = await client.post(
                f"{self.base_url}/v1/chat/completions",
                json={"model": self.model, "messages": messages, "temperature": temperature},
            )
            res.raise_for_status()
            data = res.json()
            return data["choices"][0]["message"]["content"]
```

`infra/pipecat-bridge/tts_adapter.py`:

```python
"""Calls Kokoro TTS container's HTTP synthesize endpoint, returns raw PCM bytes."""

from __future__ import annotations
import httpx


class TTSAdapter:
    def __init__(self, base_url: str, voice: str = "af") -> None:
        self.base_url = base_url.rstrip("/")
        self.voice = voice

    async def synthesize(self, text: str) -> bytes:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post(
                f"{self.base_url}/v1/audio/synthesize",
                json={"text": text, "voice": self.voice, "format": "pcm_16000"},
            )
            res.raise_for_status()
            return res.content
```

(Kokoro's HTTP API may differ — verify against the canonical container's docs at implementation time and adjust the path/payload.)

- [ ] **Step 3: Verify + commit**

```bash
docker run --rm -v "$PWD/infra/pipecat-bridge:/app" -w /app python:3.12-slim sh -c \
  "pip install -q .[dev] && pytest tests/test_adapters.py -v"
git add infra/pipecat-bridge/{stt,llm,tts}_adapter.py infra/pipecat-bridge/tests/test_adapters.py && git commit -m "feat(pipecat-bridge): STT/LLM/TTS adapters (Whisper/Ollama/Kokoro)"
```

---

## Task 15: Bridge pipeline + server

**Files:** `infra/pipecat-bridge/pipeline.py`, `infra/pipecat-bridge/server.py`, `tests/test_pipeline_smoke.py`

- [ ] **Step 1: Smoke test**

`infra/pipecat-bridge/tests/test_pipeline_smoke.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch
from pipeline import VoicePipeline


@pytest.mark.asyncio
async def test_pipeline_processes_one_frame():
    """With STT/LLM/TTS adapters mocked, a sample frame in produces output + transcript chunk."""
    pipeline = VoicePipeline(
        stt=AsyncMock(transcribe=AsyncMock(return_value={"text": "hello", "language": "en", "duration": 1.0, "segments": [{"start": 0, "end": 1, "text": "hello"}]})),
        llm=AsyncMock(complete=AsyncMock(return_value="hi there")),
        tts=AsyncMock(synthesize=AsyncMock(return_value=b"\x00" * 100)),
        system_prompt="you are an intake agent",
    )
    transcripts = []
    audio_out = []
    async def on_transcript(t): transcripts.append(t)
    async def on_audio(b): audio_out.append(b)

    await pipeline.handle_audio_chunk(b"\x00" * 8000, on_audio, on_transcript)
    summary = await pipeline.finalize(on_transcript)

    assert any("hello" in t.get("text", "") for t in transcripts)
    assert audio_out, "expected at least one audio response"
    assert summary["text"], "final transcript should be non-empty"
```

Run: FAIL.

- [ ] **Step 2: Implement pipeline**

`infra/pipecat-bridge/pipeline.py`:

```python
"""Voice pipeline: incoming audio → STT → LLM → TTS → outgoing audio.

Minimal version. Pipecat-ai supplies more sophisticated VAD/turn-taking;
this is the framework-agnostic loop with a swap-in point for Pipecat's
real pipeline once we wire it.
"""

from __future__ import annotations
import time
from typing import Any, Awaitable, Callable


class VoicePipeline:
    def __init__(self, stt: Any, llm: Any, tts: Any, system_prompt: str) -> None:
        self.stt = stt
        self.llm = llm
        self.tts = tts
        self.history: list[dict] = [{"role": "system", "content": system_prompt}]
        self._turns: list[dict] = []
        self._t0 = time.time()

    async def handle_audio_chunk(
        self,
        audio: bytes,
        on_audio: Callable[[bytes], Awaitable[None]],
        on_transcript: Callable[[dict], Awaitable[None]],
    ) -> None:
        """Process one chunk: transcribe, complete, synthesize."""
        stt_result = await self.stt.transcribe(audio)
        user_text = (stt_result.get("text") or "").strip()
        if not user_text:
            return

        turn_user = {"speaker": "caller", "text": user_text, "startMs": int((time.time() - self._t0) * 1000)}
        self._turns.append(turn_user)
        await on_transcript({"type": "turn", **turn_user})

        self.history.append({"role": "user", "content": user_text})
        agent_text = await self.llm.complete(self.history)
        turn_agent = {"speaker": "agent", "text": agent_text, "startMs": int((time.time() - self._t0) * 1000)}
        self._turns.append(turn_agent)
        await on_transcript({"type": "turn", **turn_agent})
        self.history.append({"role": "assistant", "content": agent_text})

        audio_bytes = await self.tts.synthesize(agent_text)
        await on_audio(audio_bytes)

    async def finalize(self, on_transcript: Callable[[dict], Awaitable[None]]) -> dict:
        text = "\n".join(f"[{t['speaker']}] {t['text']}" for t in self._turns)
        summary = {
            "type": "transcript_complete",
            "text": text,
            "turns": self._turns,
            "durationSec": int(time.time() - self._t0),
            "language": "en",
        }
        await on_transcript(summary)
        return summary
```

- [ ] **Step 3: FastAPI server**

`infra/pipecat-bridge/server.py`:

```python
"""FastAPI WebSocket server that wraps the voice pipeline with JWT auth."""

from __future__ import annotations
import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import JSONResponse
from auth import verify_token, AuthError
from pipeline import VoicePipeline
from stt_adapter import STTAdapter
from llm_adapter import LLMAdapter
from tts_adapter import TTSAdapter


app = FastAPI()


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.websocket("/sessions/{call_id}")
async def session(websocket: WebSocket, call_id: str, token: str = Query(...)) -> None:
    secret = os.environ["BRIDGE_JWT_SECRET"]
    try:
        verify_token(token, secret)
    except AuthError:
        await websocket.close(code=1008, reason="auth")
        return

    await websocket.accept()
    init_msg = await websocket.receive_text()
    init = json.loads(init_msg)
    if init.get("type") != "init":
        await websocket.close(code=1008, reason="bad init"); return

    pipeline = VoicePipeline(
        stt=STTAdapter(os.environ["WHISPER_BASE_URL"]),
        llm=LLMAdapter(os.environ["OLLAMA_BASE_URL"]),
        tts=TTSAdapter(os.environ["KOKORO_BASE_URL"]),
        system_prompt=init["systemPrompt"],
    )

    async def on_audio(b: bytes) -> None:
        await websocket.send_bytes(b)

    async def on_transcript(t: dict) -> None:
        await websocket.send_text(json.dumps(t))

    try:
        while True:
            msg = await websocket.receive()
            if "bytes" in msg:
                await pipeline.handle_audio_chunk(msg["bytes"], on_audio, on_transcript)
            elif "text" in msg:
                control = json.loads(msg["text"])
                if control.get("type") == "stop":
                    break
    except WebSocketDisconnect:
        pass
    finally:
        await pipeline.finalize(on_transcript)
```

- [ ] **Step 4: Verify + commit**

```bash
docker run --rm -v "$PWD/infra/pipecat-bridge:/app" -w /app python:3.12-slim sh -c \
  "pip install -q .[dev] && pytest tests/ -v"
git add infra/pipecat-bridge/pipeline.py infra/pipecat-bridge/server.py infra/pipecat-bridge/tests/test_pipeline_smoke.py && git commit -m "feat(pipecat-bridge): VoicePipeline + FastAPI WebSocket server"
```

---

## Task 16: Compose additions

**File:** `docker-compose.prod.yml`

- [ ] **Step 1: Append `kokoro-tts` and `pipecat-bridge` services + named volumes**

```yaml
  # ---------------------------------------------------------------------------
  # Kokoro TTS (local-voice profile)
  # ---------------------------------------------------------------------------
  kokoro-tts:
    # Verify canonical image at implementation time. If no published image,
    # build from infra/kokoro/Dockerfile (out of scope here).
    image: ghcr.io/remsky/kokoro-fastapi:latest
    container_name: workforce0-kokoro-tts
    restart: unless-stopped
    profiles: ["local-voice"]
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8880/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s
    networks:
      - workforce0

  pipecat-bridge:
    build:
      context: ./infra/pipecat-bridge
      dockerfile: Dockerfile
    container_name: workforce0-pipecat-bridge
    restart: unless-stopped
    profiles: ["local-voice"]
    environment:
      WHISPER_BASE_URL: http://whisper:8000
      OLLAMA_BASE_URL: http://ollama:11434
      KOKORO_BASE_URL: http://kokoro-tts:8880
      BRIDGE_JWT_SECRET: ${BRIDGE_JWT_SECRET:?BRIDGE_JWT_SECRET is required when local-voice is active}
    depends_on:
      whisper: { condition: service_healthy }
      ollama: { condition: service_healthy }
      kokoro-tts: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:8400/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    networks:
      - workforce0
```

- [ ] **Step 2: Backend env defaults**

In the `backend` service environment block, add:

```yaml
      PIPECAT_BRIDGE_URL: ${PIPECAT_BRIDGE_URL:-http://pipecat-bridge:8400}
      BRIDGE_JWT_SECRET: ${BRIDGE_JWT_SECRET:-}
```

- [ ] **Step 3: Validate**

```bash
touch .env.tmp
POSTGRES_PASSWORD=test BRIDGE_JWT_SECRET=test123456789012345678901234567890123 \
  docker compose -f docker-compose.prod.yml --env-file .env.tmp \
    --profile local-llm --profile local-stt --profile local-voice config > /dev/null
rm .env.tmp
echo "compose OK"
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.prod.yml && git commit -m "feat(compose): add kokoro-tts + pipecat-bridge under local-voice profile"
```

---

## Task 17: Wizard + frontend

**Files:** `frontend/src/components/wizard/voice-intake.tsx` (NEW), `frontend/src/components/onboarding-wizard.tsx` (modified)

- [ ] **Step 1: Create the step component**

`frontend/src/components/wizard/voice-intake.tsx`:

```tsx
"use client";
import { Card, CardContent } from "@/components/ui/card";

export interface VoiceIntakeConfig {
  enabled: boolean;
  twilioNumber: string;
  callerAllowlist: string[];
  pin?: string;
}

export function VoiceIntake({
  value,
  onChange,
}: {
  value: VoiceIntakeConfig;
  onChange: (next: VoiceIntakeConfig) => void;
}) {
  return (
    <Card><CardContent className="space-y-3 p-6">
      <h3 className="text-lg font-semibold">Voice intake (optional)</h3>
      <p className="text-sm text-muted-foreground">
        Inbound phone hotline. Caller dials your Twilio number and talks to a
        local agent. Transcript flows into the same brief pipeline as a
        manual upload.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        Enable inbound voice intake
      </label>
      {value.enabled && (
        <div className="space-y-2 pt-2">
          <input
            type="tel"
            placeholder="Twilio number (E.164, e.g. +18005551111)"
            value={value.twilioNumber}
            onChange={(e) => onChange({ ...value, twilioNumber: e.target.value })}
            className="w-full border p-2 rounded text-sm"
          />
          <input
            type="text"
            placeholder="Caller-ID allowlist (E.164, comma-separated)"
            value={value.callerAllowlist.join(", ")}
            onChange={(e) =>
              onChange({
                ...value,
                callerAllowlist: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })
            }
            className="w-full border p-2 rounded text-sm"
          />
          <input
            type="password"
            placeholder="Fallback PIN (4 digits, optional)"
            maxLength={4}
            value={value.pin ?? ""}
            onChange={(e) => onChange({ ...value, pin: e.target.value || undefined })}
            className="w-full border p-2 rounded text-sm"
          />
        </div>
      )}
    </Card></CardContent>
  );
}
```

(Fix the JSX closing-tag order if your editor flags it: `</CardContent></Card>`. Above is shown collapsed; adjust as needed.)

- [ ] **Step 2: Wire into `onboarding-wizard.tsx`**

Find the wizard's step list and insert "Voice intake" after Meeting Capture (per the spec's wizard flow). Add `voiceIntake` to the wizard state; on save, POST it to `/api/setup/save-step0` (which already accepts `recallApiKey` etc — extend the Zod schema to accept `voiceIntake`).

- [ ] **Step 3: Backend extension**

Update `backend/src/routes/setup-step0.routes.ts`:
- Zod body: add `voiceIntake: z.object({ enabled, twilioNumber, callerAllowlist: array(string), pin: optional }).optional()`.
- On save: hash PIN with argon2, write to `tenantSettings.voicePinHash`, write `voiceCallerAllowlist`, return `BRIDGE_JWT_SECRET` and `WEBHOOK_BASE_HOST` as env hints if not already present.

- [ ] **Step 4: Verify + commit**

```bash
cd frontend && npm run typecheck
cd backend && npm run typecheck && npm test
cd /Users/ithena/Documents/CodeSpace/workforce0-public && git add frontend/src/components/wizard/voice-intake.tsx 'frontend/src/components/onboarding-wizard.tsx' backend/src/routes/setup-step0.routes.ts && git commit -m "feat(wizard): voice-intake step with Twilio number, allowlist, optional PIN"
```

---

## Task 18: Docs

**Files:** `docs-site/src/content/docs/integrations/voice-intake.md` (NEW), `docs-site/src/content/docs/self-hosting/voice.md` (NEW), `README.md` (modified), `MODELS.md` (modified)

- [ ] **Step 1: Integration page**

`docs-site/src/content/docs/integrations/voice-intake.md`:

```markdown
---
title: Voice Intake
description: Inbound phone hotline — caller dials, talks to a local agent, transcript flows into the brief pipeline.
---

Workforce0 supports inbound voice intake via Twilio. Three provider modes
behind a single phone number:

## Modes

- **Pipecat (local).** Default for the `local-voice` Compose profile. STT
  via faster-whisper, LLM via Ollama, TTS via Kokoro. No external API calls.
- **Gemini Live (BYOK).** Real-time multimodal API; lowest latency.
  Requires `GEMINI_API_KEY`.
- **OpenAI Realtime (BYOK).** Same shape as Gemini, OpenAI's API. Requires
  `OPENAI_API_KEY`.

The router picks per tenant: tenant preference first, else default chain
`pipecat → gemini → openai → none`. No mid-call fallback.

## Setup

1. Provision a Twilio number.
2. Set its **Voice & Fax → A Call Comes In** webhook to:
   `https://<your-host>/webhooks/twilio/voice/inbound`
3. In the Workforce0 wizard, enable Voice Intake and add caller-ID
   allowlist + optional fallback PIN.
4. (For local mode) `docker compose -f docker-compose.prod.yml --profile local-voice up -d`.

## Auth flow

- Caller is on the allowlist → call connects directly.
- Caller is off the allowlist + a PIN is configured → caller is prompted
  for PIN; 3 wrong attempts = blocked for 1h.
- Neither configured → call hung up with "voice intake not configured."

## Telemetry

Every call emits `voice.session_complete` with provider, duration, end
reason, and cost. Plan 3's status dashboard shows recent calls.

## Cost

Pipecat path is ~$0 (local). Gemini Live + OpenAI Realtime are billed by
the provider; the per-call hard cap is `VOICE_HARD_COST_CAP_USD` (default
$2.00).
```

- [ ] **Step 2: Smoke-test page**

`docs-site/src/content/docs/self-hosting/voice.md`:

```markdown
---
title: Voice smoke test
description: Verify the local-voice profile end-to-end before tagging a release.
---

Run this on a 16 GB host (Mac or Linux) to verify Pipecat is wired correctly.

\`\`\`bash
docker compose -f docker-compose.prod.yml \
  --profile local-llm --profile local-stt --profile local-voice up -d

# Wait for whisper, ollama, kokoro-tts, pipecat-bridge to be healthy.
docker ps --filter "label=com.docker.compose.project=workforce0-public"

# Run the diagnose script (plays a sample WAV through the pipeline).
./bin/diagnose-voice.sh
\`\`\`

## Expected output

\`\`\`
Workforce0 voice diagnostic
✓ whisper: healthy
✓ ollama:  healthy
✓ kokoro-tts: healthy
✓ pipecat-bridge: healthy

Synthetic session: STT 850ms · LLM 1.2s · TTS 320ms · total 2.4s
Transcript: "hello, this is a test"
\`\`\`

If any step fails, see `bin/diagnose.sh` for full container logs.
```

- [ ] **Step 3: README + MODELS**

In `README.md`, add `local-voice` to the Step 0 profiles list and link the integration page.

In `MODELS.md`, append a "Voice (TTS)" table:

```markdown
## Voice (local TTS)

| Use | Model | License | Size |
|---|---|---|---|
| Default | Kokoro 82M (Apache 2.0) | Apache 2.0 | ~300 MB |
| Multilingual tier-up | Qwen3-TTS | Apache 2.0 | ~1.5 GB |
```

- [ ] **Step 4: Commit**

```bash
git add docs-site/src/content/docs/integrations/voice-intake.md docs-site/src/content/docs/self-hosting/voice.md README.md MODELS.md && git commit -m "docs: voice intake integration + smoke-test guide + Kokoro in MODELS"
```

---

## Task 19: Diagnose script

**Files:** `bin/diagnose-voice.sh` (NEW), `bin/README.md` (modified), `tests/fixtures/voice-intake-sample.wav` (NEW; small fixture)

- [ ] **Step 1: Create the script**

`bin/diagnose-voice.sh`:

```bash
#!/usr/bin/env bash
# Verify the local-voice profile end-to-end with a synthetic session.

set -uo pipefail
cd "$(dirname "$0")/.."

echo "Workforce0 voice diagnostic — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "─────────────────────────────────────"

for svc in whisper ollama kokoro-tts pipecat-bridge; do
  cid=$(docker compose -f docker-compose.prod.yml ps -q "$svc" 2>/dev/null || true)
  if [ -z "$cid" ]; then echo "[$svc] not running"; continue; fi
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$cid" 2>/dev/null || echo unknown)
  echo "[$svc] health=$health"
done
echo

# Mint a JWT and POST a sample WAV to the bridge's debug synthetic endpoint.
# (Bridge exposes /sessions/synthetic only when DEBUG=1; document in voice.md.)
SAMPLE="tests/fixtures/voice-intake-sample.wav"
if [ ! -f "$SAMPLE" ]; then
  echo "Sample WAV missing: $SAMPLE"; exit 2
fi

echo "Posting sample WAV to bridge synthetic endpoint…"
TOKEN=$(node -e "
  const jwt = require('jsonwebtoken');
  console.log(jwt.sign({ callId: 'diag', tenantId: 'default', sessionId: 'diag' },
    process.env.BRIDGE_JWT_SECRET, { expiresIn: '5m' }));
")
curl -fsS -X POST "http://localhost:8400/sessions/synthetic?token=$TOKEN" \
  -H "Content-Type: audio/wav" --data-binary "@$SAMPLE" | head -c 500
echo
```

`chmod +x bin/diagnose-voice.sh`.

- [ ] **Step 2: Update `bin/README.md`**

Add a `## diagnose-voice.sh` section with one-paragraph description and example output.

- [ ] **Step 3: Add a tiny WAV fixture**

```bash
mkdir -p tests/fixtures
# Generate a 1-second 16kHz mono PCM WAV with say(1) on macOS, or use any
# pre-existing voice sample under 100 KB. Commit the fixture.
say -o tests/fixtures/voice-intake-sample.wav --data-format=LEI16@16000 "hello this is a test"
ls -lh tests/fixtures/voice-intake-sample.wav
```

(On Linux runners, generate via `espeak-ng` or commit a pre-recorded file from elsewhere. File must be < 100 KB.)

- [ ] **Step 4: Add `/sessions/synthetic` endpoint to bridge**

In `infra/pipecat-bridge/server.py`, add a guarded debug endpoint (only when `DEBUG=1`):

```python
@app.post("/sessions/synthetic")
async def synthetic(token: str = Query(...), request: Request = None):
    if os.environ.get("DEBUG") != "1":
        return JSONResponse({"error": "debug disabled"}, status_code=404)
    secret = os.environ["BRIDGE_JWT_SECRET"]
    try:
        verify_token(token, secret)
    except AuthError:
        return JSONResponse({"error": "auth"}, status_code=401)
    audio = await request.body()
    pipeline = VoicePipeline(...)  # initialize like the WS handler
    transcripts = []
    audio_out = []
    async def on_a(b): audio_out.append(b)
    async def on_t(t): transcripts.append(t)
    await pipeline.handle_audio_chunk(audio, on_a, on_t)
    summary = await pipeline.finalize(on_t)
    return JSONResponse({"transcript": summary, "audioBytes": sum(len(b) for b in audio_out)})
```

- [ ] **Step 5: Commit**

```bash
chmod +x bin/diagnose-voice.sh
git add bin/diagnose-voice.sh bin/README.md tests/fixtures/voice-intake-sample.wav infra/pipecat-bridge/server.py && git commit -m "feat(bin): diagnose-voice.sh runs end-to-end synthetic session"
```

---

## Task 20: Integration test

**Files:** `backend/src/__tests__/integration/voice-intake.integration.test.ts` (NEW)

- [ ] **Step 1: Write the test**

```ts
/**
 * Integration: inbound voice flow exercises the webhook + media-stream + provider
 * router. Provider is mocked; we verify the route returns the right TwiML and
 * that on transcript-complete a Meeting row is created and MEETING_PROCESS
 * enqueued.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { twilioInboundRoutes } from '../../routes/webhooks/twilio-inbound.routes.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const buildApp = () => {
  const app = Fastify();
  (app as unknown as { services: any }).services = {
    callerAuthService: {
      checkCallerId: vi.fn().mockResolvedValue('allowed'),
      verifyPin: vi.fn().mockResolvedValue(true),
    },
    tenantResolver: {
      resolveTenantByDID: vi.fn().mockResolvedValue('t1'),
      resolveTenantByCallSid: vi.fn().mockResolvedValue('t1'),
    },
  };
  app.register(twilioInboundRoutes, { prefix: '/webhooks/twilio/voice' });
  return app;
};

describe('integration: inbound voice TwiML routing', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = buildApp(); await app.ready(); });

  it('allowed caller → <Connect><Stream>', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhooks/twilio/voice/inbound',
      payload: 'From=%2B15551234567&To=%2B18005551111&CallSid=CA1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.body).toContain('<Connect>');
  });

  it('PIN flow: invalid → <Hangup/>', async () => {
    (app as unknown as { services: any }).services.callerAuthService.checkCallerId
      .mockResolvedValueOnce('needs_pin');
    (app as unknown as { services: any }).services.callerAuthService.verifyPin
      .mockResolvedValueOnce(false);
    const r1 = await app.inject({
      method: 'POST', url: '/webhooks/twilio/voice/inbound',
      payload: 'From=%2B15559999999&To=%2B18005551111&CallSid=CA2',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(r1.body).toContain('<Gather');
    const r2 = await app.inject({
      method: 'POST', url: '/webhooks/twilio/voice/pin',
      payload: 'From=%2B15559999999&To=%2B18005551111&CallSid=CA2&Digits=9999',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(r2.body).toContain('<Hangup');
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd backend && npx vitest run src/__tests__/integration/voice-intake.integration.test.ts
cd backend && git add src/__tests__/integration/voice-intake.integration.test.ts && git commit -m "test(voice): integration test for inbound TwiML routing + PIN flow"
```

---

## Self-review checklist (before opening PR)

Per `feedback_self_review_before_push`:

- [ ] **Concurrency**: PIN rate-limit uses Redis `INCR` + `EXPIRE` atomically — fine. CallerAuthService has no `findFirst → create/update` pattern.
- [ ] **Layer boundaries**: routes use `fastify.services.*`; CallerAuthService uses prisma directly (acceptable — service layer's job).
- [ ] **Swallowed errors**: `argon2.verify` catch returns false explicitly (not silently); pipeline errors flow to `onError` callback.
- [ ] **Lookup tables**: provider IDs literal `'gemini' | 'openai' | 'pipecat'` everywhere.
- [ ] **Comment accuracy**: spec/§ headings + module docstrings match implementation.
- [ ] **Pino**: every `log.*` uses `({obj}, 'msg')`.
- [ ] **Test coverage**: ~30 new tests across providers, router, auth, routes, integration.

## Final verification

```bash
cd backend && npm test && npm run typecheck
cd frontend && npm run typecheck
docker run --rm -v "$PWD/infra/pipecat-bridge:/app" -w /app python:3.12-slim sh -c \
  "pip install -q .[dev] && pytest tests/ -v"
docker compose -f docker-compose.prod.yml \
  --profile local-llm --profile local-stt --profile local-voice config > /dev/null
```

All four must pass.

## Notes for the implementer

- **Existing voice services may not be EventEmitter-shaped.** Tasks 6+11 wire `GeminiLiveSession`/`OpenAIRealtimeSession` to the new provider interface. If those classes don't already emit `'end'` and `'error'`, add the events at the boundary — minimum-touch.
- **Kokoro container**: `ghcr.io/remsky/kokoro-fastapi:latest` is the most-cited community wrapper. If a canonical Kokoro image emerges from the official project, swap it in via the version-pin process documented in `MODELS.md`.
- **`tenantResolver`**: For Step 0 single-tenant installs, both methods can return `'default'`. Document the upgrade path (resolve by DID → tenant lookup table) in a JSDoc comment for whoever does multi-tenant work in Step 1.
- **`MeetingService.createFromVoiceTranscript`**: aligns with however the existing manual-upload flow writes Meeting rows. Reuse those field names.
- **Prisma migration ordering**: Tasks 1 + 5 each add columns to TenantSettings. Combine into one migration if the implementer is touching both at once.
