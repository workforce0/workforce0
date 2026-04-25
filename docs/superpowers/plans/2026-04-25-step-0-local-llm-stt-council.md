# Plan 2 — Local LLM (Ollama) + Local STT (Whisper) + Council Loop Guards

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Add Ollama as a provider to the AI Council fallback chain, add a local Whisper STT service that the existing transcription service can fall through to BYOK from, update `DEFAULT_MODEL_ASSIGNMENTS` to current April 2026 model SKUs with explicit fallbacks, and add the loop-termination guards (`maxReviewRounds`, parallel reviewers, exit telemetry) called out in §5 of the spec.

**Architecture:** Ollama runs as a `local-llm` Compose profile container. `OllamaService` mirrors the existing `GeminiService`/`OpenAIService` shape so the AI Council can call it without behavioral changes. Whisper runs as a `local-stt` profile container exposing OpenAI-compatible `/v1/audio/transcriptions`; existing `TranscriptionService` adds an `STT_PROVIDER_CHAIN` fallback that prefers local. The council's existing critique loop gets `maxReviewRounds` as a hard cap and emits `council.session_complete` telemetry per session.

**Tech Stack:** TypeScript ESM, Vitest, Docker Compose, Ollama, faster-whisper-server.

**Spec:** `docs/superpowers/specs/2026-04-25-step-0-local-everything-bundle-design.md` §4 + §5 + §8.

---

## File structure

```
backend/
├── src/
│   ├── config/index.ts                                        modified (add OLLAMA_*, STT_*, WHISPER_* env)
│   ├── lib/di-container.ts                                    modified (wire OllamaService + STTRouter)
│   ├── services/
│   │   ├── ai/
│   │   │   ├── ollama.service.ts                              NEW (mirrors openai.service.ts shape)
│   │   │   ├── ollama.service.test.ts                         NEW
│   │   │   └── ai-council.ts                                  modified (loop guards + telemetry)
│   │   ├── model-registry/
│   │   │   └── default-models.ts                              modified (April 2026 SKUs + fallbackChain + maxReviewRounds + reviewerMode)
│   │   ├── stt/                                               NEW
│   │   │   ├── stt-provider.types.ts                          NEW
│   │   │   ├── stt-router.service.ts                          NEW
│   │   │   ├── stt-router.service.test.ts                     NEW
│   │   │   ├── providers/
│   │   │   │   ├── local-whisper.provider.ts                  NEW (faster-whisper-server)
│   │   │   │   ├── local-whisper.provider.test.ts             NEW
│   │   │   │   └── openai-whisper.provider.ts                 NEW (wraps existing transcription.service.ts logic)
│   │   │   └── index.ts                                       NEW
│   │   └── transcription/
│   │       └── transcription.service.ts                       modified (delegate to STTRouter)
│   ├── types/model-registry.types.ts                          modified (new ProviderName 'ollama', new optional fields)
│   └── lib/telemetry/council-telemetry.ts                     NEW (emits council.session_complete)
docker-compose.prod.yml                                        modified (ollama + whisper services + named volumes)
docs-site/src/content/docs/integrations/local-models.md        NEW
docs-site/src/content/docs/integrations/transcription.md       NEW
MODELS.md                                                      NEW (root — tracks chosen model versions + review cadence)
```

---

## Task 1: New env keys + types

**Files:** `backend/src/config/index.ts`, `backend/src/types/model-registry.types.ts`

- [ ] **Step 1:** Find the Zod config schema. `grep -n "OPENAI_API_KEY\|JIRA_API_TOKEN" backend/src/config/index.ts`. Match the existing `optionalString` pattern.

- [ ] **Step 2:** Add to the schema:

```ts
OLLAMA_BASE_URL: z.string().optional().transform(/* same empty→undefined transform as siblings */),
OLLAMA_KEEP_ALIVE: z.string().optional().transform(/* ditto */),
OLLAMA_MAX_LOADED_MODELS: z.coerce.number().int().min(1).max(8).default(1),
WHISPER_BASE_URL: z.string().optional().transform(/* ditto */),
WHISPER_TIMEOUT_MULT: z.coerce.number().min(1).max(10).default(2),
STT_PROVIDER_CHAIN: z.string().optional().default('local,openai'),
```

- [ ] **Step 3:** Update `backend/src/types/model-registry.types.ts`:
  - Extend `ProviderName` union to include `'ollama'`.
  - In `default-models.ts` interface (re-exported from there or here — check), the `DefaultModelAssignment` interface gains optional fields:

```ts
export interface DefaultModelAssignment {
  agentType: AgentType;
  primaryProvider: ProviderName;
  primaryModelId: string;
  reviewers: Array<{ provider: ProviderName; modelId: string }>;
  fallbackChain?: Array<{ provider: ProviderName; modelId: string }>;  // NEW
  confidenceThreshold: number;
  maxSteps: number;
  maxReviewRounds?: number;          // NEW — defaults to 0 (no critique loop)
  reviewerMode?: 'parallel' | 'sequential';   // NEW — defaults to 'parallel'
}
```

- [ ] **Step 4:** Typecheck. Commit:
```bash
cd backend && git add src/config/index.ts src/types/model-registry.types.ts && git commit -m "feat(config): add Ollama, Whisper, and Council loop-guard env keys"
```

---

## Task 2: OllamaService — TDD

**Files:** `backend/src/services/ai/ollama.service.ts` and `.test.ts`.

The service mirrors the existing `OpenAIService` API surface so the AI Council can use it via the same call sites. Read the existing `OpenAIService` for shape: `cd backend && head -200 src/services/ai/openai.service.ts`.

- [ ] **Step 1: failing test** — `backend/src/services/ai/ollama.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaService } from './ollama.service.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;
beforeEach(() => mockFetch.mockReset());

describe('OllamaService', () => {
  const baseUrl = 'http://ollama:11434';

  it('isEnabled returns false when baseUrl is undefined', () => {
    const s = new OllamaService({ baseUrl: undefined });
    expect(s.isEnabled()).toBe(false);
  });

  it('isEnabled returns true when baseUrl is set', () => {
    const s = new OllamaService({ baseUrl });
    expect(s.isEnabled()).toBe(true);
  });

  it('isAvailable returns true when /api/tags responds 200', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'qwen3.5:8b' }] }), { status: 200 }));
    const s = new OllamaService({ baseUrl });
    await expect(s.isAvailable()).resolves.toBe(true);
  });

  it('isAvailable returns false when /api/tags fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connection refused'));
    const s = new OllamaService({ baseUrl });
    await expect(s.isAvailable()).resolves.toBe(false);
  });

  it('generate calls /v1/chat/completions OpenAI-compatible endpoint', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200 }));
    const s = new OllamaService({ baseUrl });
    const out = await s.generate({ model: 'qwen3.5:8b', prompt: 'hi', temperature: 0.7 });
    expect(out.text).toBe('hello');
    expect(out.usage.totalTokens).toBe(15);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/v1/chat/completions`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('generate throws on 5xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const s = new OllamaService({ baseUrl });
    await expect(s.generate({ model: 'qwen3.5:8b', prompt: 'x' })).rejects.toThrow(/Ollama generate failed: 500/);
  });

  it('warmModel issues a no-op generation request', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '' } }], usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 } }), { status: 200 }));
    const s = new OllamaService({ baseUrl });
    await s.warmModel('qwen3.5:8b');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2:** Run test (RED).

- [ ] **Step 3: implement** `backend/src/services/ai/ollama.service.ts`:

```ts
/**
 * OllamaService — local LLM provider via Ollama's OpenAI-compatible API.
 *
 * When OLLAMA_BASE_URL is unset the service stays disabled (isEnabled=false)
 * and the AI Council skips it. When set, calls go to /v1/chat/completions.
 *
 * @module services/ai/ollama
 */

import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'OllamaService' });

export interface OllamaServiceConfig {
  baseUrl: string | undefined;
  keepAlive?: string;
}

export interface OllamaGenerateInput {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface OllamaGenerateResult {
  text: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export class OllamaService {
  constructor(private readonly config: OllamaServiceConfig) {}

  isEnabled(): boolean {
    return typeof this.config.baseUrl === 'string' && this.config.baseUrl.length > 0;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.baseUrl) return false;
    try {
      const res = await fetch(`${this.config.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2_000) });
      return res.ok;
    } catch (err) {
      logger.debug({ err: (err as Error).message }, 'Ollama availability check failed');
      return false;
    }
  }

  async generate(input: OllamaGenerateInput): Promise<OllamaGenerateResult> {
    if (!this.config.baseUrl) throw new Error('OllamaService not configured');

    const messages = [
      ...(input.systemPrompt ? [{ role: 'system' as const, content: input.systemPrompt }] : []),
      { role: 'user' as const, content: input.prompt },
    ];

    const res = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        messages,
        temperature: input.temperature ?? 0.7,
        max_tokens: input.maxTokens,
        keep_alive: this.config.keepAlive ?? '30m',
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama generate failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    return {
      text: data.choices[0]?.message?.content ?? '',
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }

  /** Pre-warm a model so first real request doesn't pay cold-load latency. */
  async warmModel(model: string): Promise<void> {
    try {
      await this.generate({ model, prompt: ' ', maxTokens: 1 });
    } catch (err) {
      logger.warn({ model, err: (err as Error).message }, 'Ollama warmModel failed (non-fatal)');
    }
  }
}
```

- [ ] **Step 4:** Run test (GREEN, 7 tests).

- [ ] **Step 5:** Commit:
```bash
cd backend && git add src/services/ai/ollama.service.ts src/services/ai/ollama.service.test.ts && git commit -m "feat(ai): OllamaService with OpenAI-compatible API + warm pre-load"
```

---

## Task 3: STTProviderRouter + LocalWhisperProvider + OpenAIWhisperProvider

**Files:** `backend/src/services/stt/*` (new directory).

The pattern mirrors Plan 1's `MeetingBotProvider`. Single interface, multiple providers, a router with deterministic fallback.

- [ ] **Step 1: types** — `backend/src/services/stt/stt-provider.types.ts`:

```ts
/**
 * STTProvider — abstracts speech-to-text across local Whisper, OpenAI
 * Whisper API, and Deepgram (future).
 *
 * @module services/stt/stt-provider.types
 */

export type STTProviderId = 'local' | 'openai' | 'deepgram';

export interface TranscribeInput {
  /** Audio file as Buffer/Uint8Array. */
  audio: Uint8Array;
  /** Original file name (used for content-type sniffing). */
  filename: string;
  /** ISO 639-1 language hint (omit for autodetect). */
  language?: string;
}

export interface TranscribeResult {
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
  durationSec: number;
  language: string;
}

export interface STTProvider {
  readonly id: STTProviderId;
  isAvailable(): Promise<boolean>;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}
```

- [ ] **Step 2: LocalWhisperProvider** — `backend/src/services/stt/providers/local-whisper.provider.ts` plus test (TDD).

  Test asserts: `isAvailable` false when `baseUrl` unset; `isAvailable` true on `/health` 200; `transcribe` POSTs multipart/form-data to `/v1/audio/transcriptions`; `transcribe` parses Whisper-API-compatible response; `transcribe` throws on 5xx.

  Implementation calls `${baseUrl}/v1/audio/transcriptions` with `model=whisper-1` (faster-whisper-server's default), sends file as multipart form data (use `FormData` and `Blob`), reads response with `verbose_json` format to get segments. Timeout = `audio_duration_estimate * WHISPER_TIMEOUT_MULT` — for the local provider, just use a generous fixed timeout (5 minutes for most files) since we don't know duration in advance.

- [ ] **Step 3: OpenAIWhisperProvider** — `backend/src/services/stt/providers/openai-whisper.provider.ts`. Wraps the existing logic from `transcription.service.ts` (chunking, multipart upload to `https://api.openai.com/v1/audio/transcriptions` with Bearer auth). Don't re-implement chunking; instead, delegate to the existing `TranscriptionService.transcribeChunked` method (or a new exposed method). `isAvailable` returns true iff `OPENAI_API_KEY` is set.

  Reasoning for the wrap: the existing transcription logic handles 24 MB chunking + overlap dedup; we don't want to duplicate that. The OpenAI provider becomes a thin adapter.

- [ ] **Step 4: Router** — `backend/src/services/stt/stt-router.service.ts` plus test:

```ts
export class STTProviderRouter {
  constructor(
    private readonly providers: STTProvider[],
    private readonly chain: STTProviderId[],
  ) {}

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    let lastErr: Error | null = null;
    for (const id of this.chain) {
      const provider = this.providers.find((p) => p.id === id);
      if (!provider) continue;
      if (!(await provider.isAvailable())) continue;
      try {
        return await provider.transcribe(input);
      } catch (err) {
        lastErr = err as Error;
        logger.warn({ providerId: id, err: lastErr.message }, 'STT provider threw; falling through');
      }
    }
    throw new Error(`All STT providers exhausted: ${lastErr?.message ?? 'no providers available'}`);
  }
}
```

  Tests: 4 cases — first available wins, falls through on `isAvailable: false`, falls through on `transcribe` throw, throws after exhausting chain.

- [ ] **Step 5: barrel + commit** — `backend/src/services/stt/index.ts` re-exports all the above.

```bash
cd backend && git add src/services/stt/ && git commit -m "feat(stt): STTProviderRouter with local Whisper + OpenAI providers"
```

---

## Task 4: Refactor TranscriptionService to delegate to STTRouter

**File:** `backend/src/services/transcription/transcription.service.ts`.

The existing service hardcodes OpenAI. Make it accept an `STTProviderRouter` in its constructor and delegate to it, but keep the same public method signatures so callers (the BA agent's transcript path, the meeting upload route) don't change.

- [ ] **Step 1:** Read the full existing service to understand its surface area: `cd backend && cat src/services/transcription/transcription.service.ts`.

- [ ] **Step 2:** Update the constructor to take `{ router: STTProviderRouter; openaiApiKey: string | undefined }`. The existing public methods (`transcribe`, `transcribeChunked`, etc.) call `router.transcribe()` instead of OpenAI directly. The `OpenAIWhisperProvider` keeps the chunking logic (move it there if not already done in Task 3).

- [ ] **Step 3:** Update existing tests for the service to construct it with a router. Most existing assertions should still pass (the public surface is unchanged). Update DI container to inject the router.

- [ ] **Step 4:** Run full backend test suite. Commit:
```bash
cd backend && git add src/services/transcription/ src/lib/di-container.ts && git commit -m "refactor(transcription): delegate to STTProviderRouter for fallback chain"
```

---

## Task 5: Update DEFAULT_MODEL_ASSIGNMENTS to April 2026 SKUs

**File:** `backend/src/services/model-registry/default-models.ts`.

Replace the entire file with:

```ts
import type { AgentType, ProviderName } from '../../types/model-registry.types.js';

export interface DefaultModelAssignment {
  agentType: AgentType;
  primaryProvider: ProviderName;
  primaryModelId: string;
  reviewers: Array<{ provider: ProviderName; modelId: string }>;
  fallbackChain?: Array<{ provider: ProviderName; modelId: string }>;
  confidenceThreshold: number;
  maxSteps: number;
  maxReviewRounds?: number;
  reviewerMode?: 'parallel' | 'sequential';
}

export const DEFAULT_MODEL_ASSIGNMENTS: DefaultModelAssignment[] = [
  {
    agentType: 'meeting_brain',
    primaryProvider: 'anthropic', primaryModelId: 'claude-haiku-4-5',
    reviewers: [],
    fallbackChain: [
      { provider: 'google', modelId: 'gemini-3.1-flash' },
      { provider: 'openai', modelId: 'gpt-5-nano' },
      { provider: 'ollama', modelId: 'qwen3.5:8b' },
    ],
    confidenceThreshold: 0.8, maxSteps: 15, maxReviewRounds: 0, reviewerMode: 'parallel',
  },
  {
    agentType: 'ba_agent',
    primaryProvider: 'anthropic', primaryModelId: 'claude-opus-4-7',
    reviewers: [
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'openai', modelId: 'gpt-5.5' },
    ],
    fallbackChain: [
      { provider: 'openai', modelId: 'gpt-5.5' },
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'ollama', modelId: 'qwen3.5:32b' },
    ],
    confidenceThreshold: 0.85, maxSteps: 25, maxReviewRounds: 2, reviewerMode: 'parallel',
  },
  {
    agentType: 'dev_agent',
    primaryProvider: 'anthropic', primaryModelId: 'claude-sonnet-4-6',
    reviewers: [],
    fallbackChain: [
      { provider: 'openai', modelId: 'gpt-5.4' },
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'ollama', modelId: 'qwen3.5-coder:32b' },
    ],
    confidenceThreshold: 0.9, maxSteps: 50, maxReviewRounds: 0, reviewerMode: 'parallel',
  },
  {
    agentType: 'qa_agent',
    primaryProvider: 'anthropic', primaryModelId: 'claude-opus-4-7',
    reviewers: [
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'openai', modelId: 'o3' },
    ],
    fallbackChain: [
      { provider: 'openai', modelId: 'gpt-5.5' },
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'ollama', modelId: 'qwen3.5:32b' },
    ],
    confidenceThreshold: 0.9, maxSteps: 30, maxReviewRounds: 2, reviewerMode: 'parallel',
  },
  {
    agentType: 'memory_optimizer',
    primaryProvider: 'anthropic', primaryModelId: 'claude-haiku-4-5',
    reviewers: [],
    fallbackChain: [
      { provider: 'google', modelId: 'gemini-3.1-flash' },
      { provider: 'openai', modelId: 'gpt-5-nano' },
      { provider: 'ollama', modelId: 'qwen3.5:8b' },
    ],
    confidenceThreshold: 0.7, maxSteps: 10, maxReviewRounds: 0, reviewerMode: 'parallel',
  },
  {
    agentType: 'supervisor',
    primaryProvider: 'anthropic', primaryModelId: 'claude-opus-4-7',
    reviewers: [
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'openai', modelId: 'gpt-5.5' },
    ],
    fallbackChain: [
      { provider: 'openai', modelId: 'gpt-5.5' },
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'ollama', modelId: 'mistral-small-3:24b' },
    ],
    confidenceThreshold: 0.85, maxSteps: 20, maxReviewRounds: 1, reviewerMode: 'parallel',
  },
  {
    agentType: 'chief_of_staff',
    primaryProvider: 'anthropic', primaryModelId: 'claude-haiku-4-5',
    reviewers: [],
    fallbackChain: [
      { provider: 'google', modelId: 'gemini-3.1-flash' },
      { provider: 'openai', modelId: 'gpt-5-nano' },
      { provider: 'ollama', modelId: 'qwen3.5:8b' },
    ],
    confidenceThreshold: 0.7, maxSteps: 1, maxReviewRounds: 0, reviewerMode: 'parallel',
  },
];

// Legacy provider-keyed fallback map. Kept for callers that haven't
// migrated to per-agent fallbackChain yet. Will be removed in Step 1.
export const FALLBACK_CHAINS: Record<string, Array<{ provider: ProviderName; modelId: string }>> = {
  anthropic: [
    { provider: 'google', modelId: 'gemini-3.1-pro' },
    { provider: 'openai', modelId: 'gpt-5.5' },
    { provider: 'ollama', modelId: 'qwen3.5:32b' },
  ],
  google: [
    { provider: 'anthropic', modelId: 'claude-opus-4-7' },
    { provider: 'openai', modelId: 'gpt-5.5' },
    { provider: 'ollama', modelId: 'qwen3.5:32b' },
  ],
  openai: [
    { provider: 'anthropic', modelId: 'claude-opus-4-7' },
    { provider: 'google', modelId: 'gemini-3.1-pro' },
    { provider: 'ollama', modelId: 'qwen3.5:32b' },
  ],
};
```

Run any existing tests that read `DEFAULT_MODEL_ASSIGNMENTS`. Search: `grep -rn "DEFAULT_MODEL_ASSIGNMENTS" backend/src`. Update assertions that depend on old model IDs (most are likely just shape-checks, but verify).

Also check `backend/src/types/model-registry.types.ts` for the `ProviderName` union — must include `'ollama'`. If not, add it.

Commit:
```bash
cd backend && git add src/services/model-registry/default-models.ts src/types/model-registry.types.ts && git commit -m "feat(model-registry): April 2026 SKUs + per-agent fallback chains + loop guards"
```

---

## Task 6: AI Council loop guards + telemetry

**Files:** `backend/src/services/ai/ai-council.ts`, new `backend/src/lib/telemetry/council-telemetry.ts`.

The existing council orchestrates Gemini + OpenAI for PRD generation and critique. Plan 2 adds:
- `maxReviewRounds` cap on revise→critique cycles
- `council.session_complete` telemetry event with `{ rounds, exit_reason, total_tokens, total_latency_ms }`

Do NOT refactor to be n-provider here — that's Step 1's M8 verified decomposition. Just add the guards.

- [ ] **Step 1: Telemetry stub** — `backend/src/lib/telemetry/council-telemetry.ts`:

```ts
import { createChildLogger } from '../logger.js';

const logger = createChildLogger({ service: 'CouncilTelemetry' });

export type CouncilExitReason = 'threshold' | 'max_rounds' | 'max_steps' | 'first_pass' | 'error';

export interface CouncilSessionEvent {
  agentType: string;
  rounds: number;
  exitReason: CouncilExitReason;
  totalTokens: number;
  totalLatencyMs: number;
  primaryProvider: string;
  primaryModelId: string;
  reviewerCount: number;
}

export function emitCouncilSessionComplete(event: CouncilSessionEvent): void {
  // Structured log; downstream Prometheus exporter (Plan 3) will scrape via /metrics.
  logger.info(event, 'council.session_complete');
}
```

Add a unit test asserting the helper logs at info with the right shape.

- [ ] **Step 2: Loop guard in AICouncil** — find the existing critique loop in `ai-council.ts`. The current code roughly looks like: generate → critique → if not approved, revise once. Wrap that in a counter:

```ts
const maxRounds = assignment.maxReviewRounds ?? 0;
let rounds = 0;
let exitReason: CouncilExitReason = 'first_pass';

while (rounds < maxRounds) {
  rounds++;
  const critique = await this.runCritique(prd /* ... */);
  if (critique.confidence >= assignment.confidenceThreshold) {
    exitReason = 'threshold';
    break;
  }
  prd = await this.revise(prd, critique);
  if (rounds >= maxRounds) exitReason = 'max_rounds';
}
```

Match the existing variable names — don't rename anything. The point is to introduce the cap as a hard upper bound. If the existing code already has a single revise pass, just gate it on `maxRounds > 0` and parameterize the count.

For the parallel reviewer execution: if `reviewerMode === 'parallel'` and `reviewers.length > 1`, dispatch all reviewer calls with `Promise.all`. The current code probably calls one reviewer; this generalizes it.

- [ ] **Step 3: emit telemetry** at end of every council session (success path AND error path):

```ts
emitCouncilSessionComplete({
  agentType: assignment.agentType,
  rounds, exitReason,
  totalTokens: result.estimatedCost.total ? Math.round(result.estimatedCost.total / 1e-6) : 0,  // approximation
  totalLatencyMs: result.timing.total,
  primaryProvider: assignment.primaryProvider,
  primaryModelId: assignment.primaryModelId,
  reviewerCount: assignment.reviewers.length,
});
```

(Token counting is approximate; revisit when Prometheus exporter is added in Plan 3.)

- [ ] **Step 4:** Update `ai-council.test.ts`. Add three new test cases:
  1. Council exits with `exit_reason='first_pass'` when `maxReviewRounds=0`.
  2. Council exits with `exit_reason='threshold'` when reviewer confidence ≥ threshold mid-loop.
  3. Council exits with `exit_reason='max_rounds'` when reviewers always disagree.

  Use a vi-spied `emitCouncilSessionComplete` to assert the right event was emitted.

- [ ] **Step 5:** Run full suite: `cd backend && npm test`. All pass.

- [ ] **Step 6:** Commit:
```bash
cd backend && git add src/services/ai/ai-council.ts src/services/ai/ai-council.test.ts src/lib/telemetry/ && git commit -m "feat(council): maxReviewRounds guard + parallel reviewers + session telemetry"
```

---

## Task 7: Wire OllamaService + STTRouter into DI

**File:** `backend/src/lib/di-container.ts`.

- [ ] **Step 1:** Read the existing DI wiring (now has `meetingBotRouter` from Plan 1). Add Ollama and STT alongside.

```ts
import { OllamaService } from '../services/ai/ollama.service.js';
import {
  STTProviderRouter,
  LocalWhisperProvider,
  OpenAIWhisperProvider,
  type STTProviderId,
} from '../services/stt/index.js';

// ...

const ollamaService = new OllamaService({
  baseUrl: config.OLLAMA_BASE_URL,
  keepAlive: config.OLLAMA_KEEP_ALIVE,
});

// Pre-warm common models on startup if Ollama is enabled (non-blocking).
if (ollamaService.isEnabled()) {
  for (const model of ['qwen3.5:8b']) {  // light tier default; heavier tiers warmed by wizard apply
    void ollamaService.warmModel(model);
  }
}

const sttRouter = new STTProviderRouter(
  [
    new LocalWhisperProvider({ baseUrl: config.WHISPER_BASE_URL, timeoutMult: config.WHISPER_TIMEOUT_MULT }),
    new OpenAIWhisperProvider({ apiKey: config.OPENAI_API_KEY }),
  ],
  config.STT_PROVIDER_CHAIN.split(',').map((s) => s.trim()) as STTProviderId[],
);
```

- [ ] **Step 2:** Decorate services:

```ts
fastify.decorate('services', {
  ...fastify.services,
  ollamaService,
  sttRouter,
});
```

- [ ] **Step 3:** Update `transcriptionService` construction to inject `sttRouter` (per Task 4).

- [ ] **Step 4:** Update Fastify type augmentation to add `ollamaService: OllamaService; sttRouter: STTProviderRouter`.

- [ ] **Step 5:** Typecheck + full test suite. Commit:
```bash
cd backend && git add src/lib/di-container.ts && git commit -m "feat(di): wire OllamaService + STTRouter into Fastify services"
```

---

## Task 8: Add `ollama` and `whisper` services to docker-compose.prod.yml

**File:** `docker-compose.prod.yml`.

- [ ] **Step 1:** Append before the `volumes:` section:

```yaml
  # ---------------------------------------------------------------------------
  # Ollama (local LLM, opt-in via COMPOSE_PROFILES=local-llm)
  # ---------------------------------------------------------------------------
  ollama:
    image: ollama/ollama:0.6
    container_name: workforce0-ollama
    restart: unless-stopped
    profiles: ["local-llm"]
    environment:
      OLLAMA_KEEP_ALIVE: ${OLLAMA_KEEP_ALIVE:-30m}
      OLLAMA_MAX_LOADED_MODELS: ${OLLAMA_MAX_LOADED_MODELS:-1}
    volumes:
      - ollama_cache:/root/.ollama
    healthcheck:
      test: ["CMD-SHELL", "ollama list > /dev/null 2>&1 || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s
    networks:
      - workforce0

  # ---------------------------------------------------------------------------
  # Whisper STT (faster-whisper-server, opt-in via COMPOSE_PROFILES=local-stt)
  # ---------------------------------------------------------------------------
  whisper:
    image: fedirz/faster-whisper-server:latest-cpu
    container_name: workforce0-whisper
    restart: unless-stopped
    profiles: ["local-stt"]
    environment:
      WHISPER_MODEL: ${WHISPER_MODEL:-Systran/faster-whisper-large-v3-turbo}
      WHISPER_INFERENCE_DEVICE: ${WHISPER_INFERENCE_DEVICE:-auto}
      WHISPER_COMPUTE_TYPE: ${WHISPER_COMPUTE_TYPE:-int8}
      PRELOAD_MODELS: '["${WHISPER_MODEL:-Systran/faster-whisper-large-v3-turbo}"]'
    volumes:
      - whisper_cache:/root/.cache/huggingface
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8000/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 120s   # model download on first start
    networks:
      - workforce0
```

- [ ] **Step 2:** Add the named volumes:

```yaml
volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local
  backend_uploads:
    driver: local
  ollama_cache:
    driver: local
  whisper_cache:
    driver: local
```

- [ ] **Step 3:** Update `backend` service env to point at the local services (when profiles active). Add to the backend service's `environment:` block:

```yaml
      OLLAMA_BASE_URL: ${OLLAMA_BASE_URL:-http://ollama:11434}
      WHISPER_BASE_URL: ${WHISPER_BASE_URL:-http://whisper:8000}
```

(`OLLAMA_BASE_URL` defaults to the internal hostname even when `local-llm` profile is off — `OllamaService.isAvailable()` will return false because the container won't be running, and the AI Council just skips it. No special handling needed.)

- [ ] **Step 4:** Validate:
```bash
docker compose -f docker-compose.prod.yml --profile local-llm --profile local-stt config > /dev/null
```

- [ ] **Step 5:** Commit:
```bash
git add docker-compose.prod.yml && git commit -m "feat(compose): add Ollama + Whisper services with opt-in profiles"
```

---

## Task 9: MODELS.md (model version tracking)

**File:** `MODELS.md` at repo root.

Per the spec acknowledgement: "Maintenance: `MODELS.md` in the repo tracks chosen versions and review cadence (monthly check)."

- [ ] **Step 1:** Create `MODELS.md`:

```markdown
# Model Versions

Last reviewed: 2026-04-25 · Next review due: 2026-05-25

This file tracks the model versions Workforce0 ships as defaults. Update via PR after the monthly review (or sooner if a major release lands).

## Open weights (local, via Ollama)

| Use | Model | License | Size | Source |
|---|---|---|---|---|
| Reasoning (heavy) | `qwen3.5:32b` | Apache 2.0 | ~20 GB | https://ollama.com/library/qwen3.5 |
| Reasoning (default) | `mistral-small-3:24b` | Apache 2.0 | ~14 GB | https://ollama.com/library/mistral-small-3 |
| Reasoning (light) / extraction | `qwen3.5:8b` | Apache 2.0 | ~5 GB | https://ollama.com/library/qwen3.5 |
| Code generation | `qwen3.5-coder:32b` | Apache 2.0 | ~20 GB | https://ollama.com/library/qwen3.5-coder |

## STT (local, via faster-whisper-server)

| Use | Model | License | Size |
|---|---|---|---|
| Default | `Systran/faster-whisper-large-v3-turbo` | MIT | ~1.6 GB |
| Light (English-only) | `Systran/faster-distil-whisper-large-v3.en` | MIT | ~750 MB |

## BYOK provider tiers (April 2026)

| Tier | Anthropic | Google | OpenAI |
|---|---|---|---|
| Reasoning (flagship) | `claude-opus-4-7` | `gemini-3.1-pro` | `gpt-5.5` |
| Reasoning (explicit CoT) | — | — | `o3` (or `o3-pro` opt-in) |
| Execution | `claude-sonnet-4-6` | `gemini-3.1-pro` | `gpt-5.4` |
| Extraction | `claude-haiku-4-5` | `gemini-3.1-flash` | `gpt-5-nano` |

## Review process

1. Check upstream releases for each model on the first Monday of each month.
2. If a major release dropped (e.g. Qwen 4, Claude 5, GPT-6), open a PR titled `chore(models): bump <provider> to <version>`.
3. Run the smoke test (`backend/scripts/smoke-test.ts`) against the new model before merging.
4. Update this file's "Last reviewed" date and "Next review due" (+30 days).
```

- [ ] **Step 2:** Commit:
```bash
git add MODELS.md && git commit -m "docs: MODELS.md tracks default model versions and review cadence"
```

---

## Task 10: Documentation pages

- [ ] **Step 1:** Create `docs-site/src/content/docs/integrations/local-models.md`. Cover:
  - What the `local-llm` profile bundles (Ollama + Qwen 3.5 / Mistral Small 3 by tier)
  - Hardware tier table from §2 of spec
  - How to override models via `MODEL_<ROLE>_<PROVIDER>` env vars or `AgentConfig` table
  - Disk + RAM requirements per tier
  - First-start expectation: model download (~5-12 GB) on first wizard apply

- [ ] **Step 2:** Create `docs-site/src/content/docs/integrations/transcription.md`. Cover:
  - `local-stt` profile bundles faster-whisper-server
  - Model auto-detection by tier (large-v3-turbo default, distil-large-v3.en for light tier)
  - `STT_PROVIDER_CHAIN=local,openai,deepgram` env config
  - GPU vs CPU performance expectations
  - When local fails, falls through to BYOK (OpenAI Whisper API or Deepgram)

- [ ] **Step 3:** Update README — add a one-line callout near the existing meeting-bot mention:

```markdown
> **Optional:** add `--profile local-llm --profile local-stt` to bundle local models — see [Local Models docs](https://docs.workforce0.com/integrations/local-models/).
```

- [ ] **Step 4:** Commit:
```bash
git add docs-site/src/content/docs/integrations/local-models.md docs-site/src/content/docs/integrations/transcription.md README.md && git commit -m "docs: local-models + transcription integration pages"
```

---

## Task 11: End-to-end integration test for STTRouter fallback

**File:** `backend/src/__tests__/integration/stt-router.integration.test.ts`.

Mirrors the meeting-bot integration test pattern. 4 cases:
- Local available → uses local
- Local unavailable, OpenAI key set → falls through to OpenAI
- Local throws → falls through to OpenAI
- All exhausted → throws `All STT providers exhausted`

```bash
cd backend && git add src/__tests__/integration/stt-router.integration.test.ts && git commit -m "test(stt): integration test for fallback chain"
```

---

## Self-review (before push)

Run through the `feedback_self_review_before_push` checklist:

- [ ] **Concurrency**: Ollama warmModel is fire-and-forget; not in any race with subsequent calls (it's just a warm-up).
- [ ] **Layer boundaries**: STT router used through DI, not directly imported.
- [ ] **Swallowed errors**: STTRouter logs and falls through (intentional fallback chain); throws after exhausting (so caller knows). OllamaService.warmModel logs and swallows (non-fatal).
- [ ] **Lookup tables**: `STTProviderId = 'local' | 'openai' | 'deepgram'`. Single source of truth.
- [ ] **Comment accuracy**: docstrings match implementation.
- [ ] **Pino**: every `log.*` uses `({obj}, 'msg')`.
- [ ] **Test coverage**: ~25-30 new tests across this plan (Ollama, STT providers, router, council loop guards).

## Final verification

```bash
cd backend && npm test && npm run typecheck
docker compose -f docker-compose.prod.yml --profile local-llm --profile local-stt config > /dev/null
```

All must pass.

## Notes for the implementer

- **Don't over-engineer the council refactor.** The existing AICouncil hardcodes Gemini+OpenAI for PRD critique. We're adding a loop guard around what's there, not making it n-provider. Step 1's M8 milestone does the deeper refactor.
- **`OpenAIWhisperProvider` reuses existing chunking logic.** Don't duplicate the 24 MB chunking; have the provider call into existing `TranscriptionService.transcribeChunked` (or move that helper into the provider — implementer's call based on what's least invasive).
- **Ollama tags**: `:0.6` is the current minor as of 2026-04. If the smoke test reveals tag doesn't exist, check Ollama Hub and pin the latest minor.
- **Whisper image**: `fedirz/faster-whisper-server` has both `:latest-cpu` and `:latest-cuda` tags. We default to `-cpu` for portability; users with NVIDIA can override.
