---
title: Model registry
description: Where Workforce0 maps (role, provider) → model id, and how prompt caching works.
---

## What it does

A single abstraction, `ModelRegistryService`, answers:

- "Given this role and this tenant, which model should I call?"
- "Which provider? Which key? Which base URL?"
- "Is the budget cap exhausted for this role this month?"

Every LLM call in the backend goes through `resolveModel()` →
`createModelClient()` → `client.chat()`. Nobody imports provider
SDKs directly.

## Resolve flow

```ts
const { modelId, provider, apiKeyEnc, baseUrl } = await
  modelRegistry.resolveModel({
    tenantId,
    role: "planner",
    preferredProvider: "anthropic",
  });
```

Under the hood:

1. Load the tenant's `AgentRole` row for the given slug.
2. Check `monthlyBudgetTokens` — if exhausted, return null (the
   caller falls back to a deterministic response).
3. Pick a provider by priority: explicit `preferredProvider` →
   tenant-configured default → first healthy AI Council member.
4. Pick a model: env-override (`MODEL_PLANNER_<PROVIDER>`) →
   tenant-configured default → registry default for
   (provider, role).
5. Fetch the provider's API key from the `ai_providers` table
   (decrypted on demand).

## The `ModelClient` interface

Every provider client exposes:

```ts
interface ModelClient {
  chat(req: {
    model: string;
    systemPrompt?: string;
    messages: Message[];
    tools?: ToolDef[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<{
    content: string;
    toolCalls?: ToolCall[];
    tokenUsage: { input: number; output: number; cacheHit?: number };
    stopReason: string;
  }>;
}
```

Implementations in `backend/src/services/agent-runtime/clients/`:

- `anthropic-client.ts` — native Anthropic SDK.
- `openai-client.ts` — OpenAI + Azure + custom OpenAI-compatible.
- `google-client.ts` — Gemini native SDK.
- `custom-client.ts` — for local Ollama / vLLM. Same shape as
  OpenAI.

## Prompt caching

Anthropic's prompt cache reduces cost on repeated system prompts.
Our chief-of-staff prompt is stable across plans — caching it
saves 80–90% of the input-token cost on the hot path.

Implementation:

- `CacheBreakpoint` tags in the system prompt at safe boundaries.
- Cache key tied to the tenant (so one tenant's cache can't be
  read by another).
- Minimum 5-minute TTL per cache entry.

OpenAI and Gemini have their own caching models; we use them when
available.

Tests: `backend/src/services/model-registry/__tests__/prompt-caching.test.ts`.

## Per-role model overrides

Tenants tune model choice per role without restarting:

**Settings → Roles → (pick role) → Model preference**. Writes to
the `AgentRole` row's `preferredModel`. The registry re-reads on
each call (caches for 30 s).

## AI Council integration

The registry is aware of the AI Council:

- `resolveCouncil()` returns an array of `ModelClient` + modelId
  tuples, one per healthy provider.
- Budget caps apply cumulatively across the Council members for the
  same role.
- Degraded-provider exclusion happens here; the Council caller never
  sees unhealthy providers.

## Observability

Every model call emits:

- Prometheus counter `wf0_ai_call_total{provider,model}`.
- Prometheus histogram `wf0_ai_call_duration_seconds{provider}`.
- Prometheus counter `wf0_ai_tokens_total{provider,direction,cache}`.
- One `api_usage` row in Postgres (with tenant / project / role
  attribution).
- One structured log line at `info`.

This means you can slice spend by role, by project, by provider
at any time.

## Failure handling

- **Network / 5xx** — provider marked `degraded` for 60 s. Excluded
  from future `resolveModel` calls within that window.
- **429 / rate-limited** — same as degraded, with a logged reason.
- **Invalid JSON / tool-call mismatch** — not a client-layer problem;
  handled by the caller (chief-of-staff retries / structured re-ask).

Recovery probe runs every 60 s per degraded provider. On success,
`degraded` → `healthy`.

## Swapping providers

When Anthropic ships a new Claude (Sonnet 4.7 say):

1. Add the model id to `backend/src/services/model-registry/model-catalog.ts`.
2. Optionally set `MODEL_PLANNER_ANTHROPIC=claude-sonnet-4-7` in env
   for an immediate swap.
3. Restart. Tenants still on the old model continue unchanged until
   they update their preference.

## Why this abstraction

- **BYOK tangle** — without a registry, every service either repeats
  "which provider, which model, which key" or hardcodes one. Both are
  bad.
- **Multi-provider routing** — the AI Council can't live without it.
- **Cost caps** — centralizing the gate means one place to enforce
  budgets.
- **Swap model families cleanly** — new SDKs drop in as new clients;
  no grep-and-replace.

## Implementation pointers

- `backend/src/services/model-registry/model-registry.service.ts` —
  the service class.
- `backend/src/services/model-registry/model-catalog.ts` — model id
  → capabilities mapping.
- `backend/src/services/agent-runtime/clients/*.ts` — provider
  clients.
- `backend/src/services/model-registry/__tests__/` — 40+ tests
  covering edge cases (Azure, custom endpoints, rate-limit
  handling).
