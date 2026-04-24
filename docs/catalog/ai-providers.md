# AI Providers Catalog

Every AI model Workforce0 talks to goes through **one choke-point**: `ModelRegistryService`. Agents never import provider SDKs directly. That's how we keep the product provider-agnostic — swap Claude for Gemini for GPT without touching a single agent.

## Index

| Provider | Purpose | Client wrapper | Env var |
|---|---|---|---|
| [**Google Gemini**](#google-gemini) | Meeting Brain, BA reasoning, cheap fast agent | `backend/src/services/agent-runtime/clients/google-client.ts` | `GEMINI_API_KEY` |
| [**Anthropic Claude**](#anthropic-claude) | Dev Agent, QA Agent, long-context critique | `backend/src/services/agent-runtime/clients/anthropic-client.ts` | `ANTHROPIC_API_KEY` |
| [**OpenAI**](#openai) | OpenAI critic in AI Council | `backend/src/services/agent-runtime/clients/openai-client.ts` | `OPENAI_API_KEY` |

Users configure keys three ways, in order of precedence:
1. **In-app Settings → AI Providers** — AES-256-GCM encrypted, per-tenant. **Primary path for non-technical users.**
2. **Env vars** — convenient for initial deploy via Docker/Railway/Render.
3. **WorkOS-managed SSO** — for enterprise installs (rare).

## The one choke-point: `ModelRegistryService`

```ts
// Always call it like this, anywhere in the codebase:
const response = await modelRegistry.invoke({
  tenantId,
  agentType: 'ba_agent',        // maps to default provider+model via default-models.ts
  prompt: '…',
  systemPrompt: '…',
  tools: [...],
});
```

`ModelRegistryService` handles:
- Picking the right provider+model for the agent type
- Pulling the decrypted credential from the per-tenant credential pool
- Applying Anthropic prompt-caching tokens (`cache_control`) when relevant
- Redacting PII before logging trajectories (`redact.ts`)
- Falling back to the next provider in `FALLBACK_CHAINS` on rate-limit / outage
- Tracking per-tenant rate limits (`rate-limit-tracker.ts`)
- Emitting OTEL spans for observability

**Files:**
- `backend/src/services/model-registry/model-registry.service.ts` — the service
- `backend/src/services/model-registry/model-catalog.ts` — list of supported models (editable)
- `backend/src/services/model-registry/default-models.ts` — per-agent-type defaults (editable)
- `backend/src/services/model-registry/credential-pool.ts` — encrypted key store
- `backend/src/services/model-registry/prompt-caching.ts` — Anthropic cache_control strategy
- `backend/src/services/model-registry/redact.ts` — PII redaction before logging
- `backend/src/services/model-registry/rate-limit-tracker.ts` — per-tenant tracking

---

## Google Gemini

The cheap, fast, multimodal workhorse. Default for meeting-brain, BA, and supervisor agents.

- **Models in catalog:** `gemini-2.0-flash`, `gemini-2.0-flash-thinking`, `gemini-1.5-pro`
- **Voice model:** `gemini-2.0-flash-exp` (voice bot — `backend/src/voice/`)
- **Free tier:** 15 RPM on aistudio.google.com — enough to try every agent
- **Env var:** `GEMINI_API_KEY`
- **Where to get keys:** https://aistudio.google.com/apikey

## Anthropic Claude

Default for Dev Agent, QA Agent, and long-context reasoning. Supports prompt-caching (we use it heavily).

- **Models in catalog:** `claude-sonnet-4`, `claude-opus-4`, `claude-haiku-4`
- **Env var:** `ANTHROPIC_API_KEY`
- **Prompt cache:** applied via `prompt-caching.ts`. Only the system prompt and the last 3 non-system messages carry `cache_control`. See [`AGENTS.md`](../../AGENTS.md#cache-discipline) for the cache rules.
- **Where to get keys:** https://console.anthropic.com/settings/keys

## OpenAI

Used as a **critic model** in AI Council consensus (off by default). GPT-4o runs adversarial critique against the primary model's brief.

- **Models in catalog:** `gpt-4o`, `gpt-4o-mini`, `o1`, `o1-mini`
- **Env var:** `OPENAI_API_KEY`
- **Where to get keys:** https://platform.openai.com/api-keys
- **Transcription** (Whisper): used via `backend/src/services/transcription/transcription.service.ts` for meeting recordings.

## Per-agent defaults

From `backend/src/services/model-registry/default-models.ts`:

| Agent | Primary | Reviewers (AI Council on) | Confidence threshold | Max steps |
|---|---|---|---|---|
| meeting_brain | Gemini 2.0 Flash | — | 0.80 | 15 |
| ba_agent | Gemini 2.0 Flash (thinking) | GPT-4o | 0.85 | 25 |
| dev_agent | Claude Sonnet 4 | Gemini + GPT-4o | 0.90 | 50 |
| qa_agent | Claude Sonnet 4 | Gemini + GPT-4o | 0.90 | 30 |
| memory_optimizer | Claude Haiku 4 | — | 0.70 | 10 |
| supervisor | Gemini 2.0 Flash | — | 0.80 | 20 |

Presets users can flip in **Settings → Models**:
- **Recommended** — the table above (balanced cost/quality)
- **Budget** — everything on Gemini 2.0 Flash, no reviewers
- **Premium** — latest Claude Opus + full review panel
- **Custom** — pick per-agent from the full model catalog

---

## How to add a new AI provider

Goal: plug in Mistral / Groq / local Ollama / whatever-comes-next without the agents noticing.

### 1. Add a client wrapper — `backend/src/services/agent-runtime/clients/<name>-client.ts`

Implement the `AiClient` interface:

```ts
// Reference: anthropic-client.ts
export interface AiClient {
  invoke(request: AiRequest): Promise<AiResponse>;
  // Optional — providers that support caching implement this
  applyCacheControl?(messages: Messages, strategy: CacheStrategy): Messages;
}
```

Your wrapper handles SDK-specific quirks (message formatting, tool-call shape, streaming). Everything downstream sees `AiRequest` / `AiResponse`.

### 2. Register in `client-factory.ts`

```ts
case 'mistral': return new MistralClient(apiKey);
```

### 3. Add the provider to `model-catalog.ts`

```ts
{
  provider: 'mistral',
  modelId: 'mistral-large-latest',
  displayName: 'Mistral Large',
  costInput: 3.0,   // USD per 1M tokens
  costOutput: 9.0,
  contextWindow: 128_000,
  supportsTools: true,
  supportsCaching: false,
},
```

### 4. Add the env var to `backend/src/config/index.ts`

```ts
MISTRAL_API_KEY: optionalString,
```

And to `backend/.env.example` so contributors see it.

### 5. (Optional) Add a default for an agent in `default-models.ts`

Only if this provider is better than the current default for some agent type.

### 6. Tests

- `__tests__/mistral-client.test.ts` — smoke test the client wrapper
- Append a case to `model-registry.service.test.ts` that runs an end-to-end `invoke` with your provider mocked.

### 7. UI

`frontend/src/app/(dashboard)/settings/ai-providers/page.tsx` — add your provider to the `PROVIDERS` array. The paste-test-save flow is generic and just needs the provider slug, label, and "Get a key" URL.

### 8. Add it to this catalog

Append a new row to the index table at the top and a new section below.

---

## AI Council (optional multi-model consensus)

When `AI_COUNCIL_ENABLED=true`, the BA Agent (and optionally others) run **three passes**:

1. **Primary generation** — the agent's primary model produces a brief.
2. **Critique** — a reviewer model reads the brief and the original transcript, identifies gaps, and scores confidence.
3. **Revision** — if the critic's confidence is below the agent's `confidenceThreshold`, the primary model revises with critic feedback.

Council is **off by default** for speed/cost. Turn it on for high-stakes briefs (customer escalations, regulated industries).

- **Entry point:** `backend/src/services/ai/ai-council.ts`
- **Hook into any agent:** pass `{ useCouncil: true }` to `modelRegistry.invoke(...)`.
- **Critic selection:** `default-models.ts` → `reviewers` array per agent.
