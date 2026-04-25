# Step 0 — Local-Everything Bundle (Design)

**Status:** approved (brainstorming → spec)
**Author:** Workforce0 team
**Date:** 2026-04-25
**Branch:** `feat/attendee-meeting-bot-integration`

---

## Summary

Make Workforce0 runnable end-to-end on a single laptop with one `docker compose up`, no external accounts required. Bundle local LLMs (Ollama + Qwen 3.5 / Mistral Small 3), local STT (Whisper Large V3 Turbo), and an opt-in local meeting bot (Vexa). Keep BYOK and Recall.ai as first-class alternatives. The first-run experience proves Workforce0's value before the user buys into the AI Council, hosted tier, or any external dependency.

This is **Step 0** — the simplest path to a working install. The AI Council, multi-tenant features, M8 verified decomposition, and the hosted tier come later (Step 1+) and must not require Step 0 users to migrate.

## Non-goals

- Hosted/managed tier — explicitly deferred (`project_oss_pivot` memory).
- Diarization on manual uploads — Step 1.
- Voice dial-in via Pipecat — separate spec.
- Multi-tenant data isolation — Step 1.
- Forcing local models — BYOK alone remains a complete install path.

## Personas (recap from CLAUDE.md)

| Persona | What they care about in this spec |
|---|---|
| **Installer (technical operator)** | One-command install. Honest README. Diagnose script. Profile-based opt-ins. |
| **Consumer (non-technical exec)** | Doesn't see this directly. Inherits a working install with status indicators in Settings. |

The spec speaks to the installer throughout — the consumer surface is unchanged.

---

## §1 — High-level shape

```
docker compose up -d                    # default: BYOK only, no model downloads
                                        # → manual upload + AI Council via env-configured keys

docker compose --profile local-llm \
               --profile local-stt \
               --profile meeting-bot \
               up -d                    # full Step 0 bundle, ~12 GB disk + ~3-8 GB RAM
```

The wizard writes the right `COMPOSE_PROFILES` to `.env` based on user choices, then prints the apply command for the user to run.

## §2 — Hardware tiers

Tier picker maps **available** RAM (total minus ~7 GB for OS + Workforce0 base + STT) to model size. Wizard auto-selects.

| Available RAM | Tier | LLM defaults | Bot concurrency |
|---|---|---|---|
| <9 GB | Light | `qwen3.5:8b` (all roles) | 1 |
| 9-25 GB | Default | `mistral-small-3:24b` reasoning, `qwen3.5:8b` extraction | 2 |
| ≥25 GB | Heavy | `qwen3.5:32b` reasoning + `qwen3.5:8b` warm via `OLLAMA_MAX_LOADED_MODELS=2` | 4 |

GPU is detected via `nvidia-smi` / `system_profiler SPDisplaysDataType`; affects only inference speed, not which model gets picked.

## §3 — Model picks (April 2026)

Open weights selected for: permissive license, recent release, agent-workload track record.

| Use | Model | License | Size |
|---|---|---|---|
| Reasoning (heavy) | `qwen3.5:32b` | Apache 2.0 | ~20 GB |
| Reasoning (default) | `mistral-small-3:24b` | Apache 2.0 | ~14 GB |
| Reasoning (light) / extraction | `qwen3.5:8b` | Apache 2.0 | ~5 GB |
| Code generation | `qwen3.5-coder:32b` (heavy fallback) | Apache 2.0 | ~20 GB |
| STT default | `Systran/faster-whisper-large-v3-turbo` | MIT | ~1.6 GB |
| STT light | `Systran/faster-distil-whisper-large-v3.en` | MIT | ~750 MB |

Maintenance: `MODELS.md` in the repo tracks chosen versions and review cadence (monthly check).

## §4 — Local LLM bundle

```yaml
ollama:
  image: ollama/ollama:0.6.x
  profiles: ["local-llm"]
  environment:
    OLLAMA_MAX_LOADED_MODELS: ${OLLAMA_MAX_LOADED_MODELS:-1}
    OLLAMA_KEEP_ALIVE: 30m
  volumes:
    - ollama-cache:/root/.ollama
  ports: []   # internal-only
  networks: [internal]
```

Backend talks to Ollama via the OpenAI-compatible `/v1/chat/completions` endpoint, slotting into the same `ModelRegistryService` interface used for Anthropic/OpenAI/Google. Pre-warm via `POST /api/generate` with empty prompt on backend startup so first-real-request latency is acceptable.

Model pulls happen on first wizard-apply, not container start, so users see a progress bar instead of a 5-minute hang.

## §5 — AI Council fallback chain (with three providers + loop guards)

### Task-tier philosophy (durable rule)

**Biggest models reason. Medium models execute. Small models extract.**

- Reasoning roles (BA, QA, Supervisor) → flagship tier.
- Execution (Dev) → mid-tier optimized for code.
- Extraction (meeting_brain, memory_optimizer) → cheap fast models.

### Provider tiers (April 2026)

| Tier | Anthropic | Google | OpenAI |
|---|---|---|---|
| Reasoning (flagship) | `claude-opus-4-7` | `gemini-3.1-pro` | `gpt-5.5` |
| Reasoning (explicit CoT) | — | — | `o3` (or `o3-pro` opt-in) |
| Execution | `claude-sonnet-4-6` | `gemini-3.1-pro` | `gpt-5.4` |
| Extraction | `claude-haiku-4-5` | `gemini-3.1-flash` | `gpt-5-nano` |

### `DEFAULT_MODEL_ASSIGNMENTS`

Anthropic stays primary across all roles (Claude Code subscription is cheapest dev loop on day 0). Google/OpenAI sit as reviewers + fallbacks.

```ts
// backend/src/services/model-registry/default-assignments.ts
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
    confidenceThreshold: 0.8, maxSteps: 15,
    maxReviewRounds: 0, reviewerMode: 'parallel',
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
    confidenceThreshold: 0.85, maxSteps: 25,
    maxReviewRounds: 2, reviewerMode: 'parallel',
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
    confidenceThreshold: 0.9, maxSteps: 50,
    maxReviewRounds: 0, reviewerMode: 'parallel',
  },
  {
    agentType: 'qa_agent',
    primaryProvider: 'anthropic', primaryModelId: 'claude-opus-4-7',
    reviewers: [
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'openai', modelId: 'o3' },         // explicit-CoT reviewer
    ],
    fallbackChain: [
      { provider: 'openai', modelId: 'gpt-5.5' },
      { provider: 'google', modelId: 'gemini-3.1-pro' },
      { provider: 'ollama', modelId: 'qwen3.5:32b' },
    ],
    confidenceThreshold: 0.9, maxSteps: 30,
    maxReviewRounds: 2, reviewerMode: 'parallel',
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
    confidenceThreshold: 0.7, maxSteps: 10,
    maxReviewRounds: 0, reviewerMode: 'parallel',
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
    confidenceThreshold: 0.85, maxSteps: 20,
    maxReviewRounds: 1, reviewerMode: 'parallel',
  },
];
```

### Loop termination — 4 hard guards

1. **Reviewers run in parallel within a round.** No serial chaining; adding reviewers adds cost not loop depth.
2. **`maxReviewRounds` (default 0–2).** A round = primary → reviewers → revise. After cap, ship latest output even on disagreement.
3. **`confidenceThreshold` early exit.** Aggregated reviewer confidence ≥ threshold → ship immediately.
4. **`maxSteps` global cap.** Across all rounds; if next revision would exceed, ship current.

Telemetry: every Council session emits `council.session_complete` with `{ rounds, exit_reason: 'threshold' | 'max_rounds' | 'max_steps', total_tokens, total_latency_ms }`. If `max_rounds` dominates, that's a tuning signal — not a cap-raising signal.

### Per-role round defaults

| Role | maxReviewRounds |
|---|---|
| ba_agent | 2 |
| qa_agent | 2 |
| supervisor | 1 |
| dev_agent | 0 |
| meeting_brain | 0 |
| memory_optimizer | 0 |

Only BA/QA/Supervisor have critique loops; all bounded ≤ 2.

## §6 — `MeetingBotProvider` abstraction

> **Status update (2026-04-25):** Vexa bundling has been deferred — the spec's
> claims about a `meeting-bot` Compose profile are aspirational. The provider
> abstraction (this section's main contribution) is shipped, and `VexaProvider`
> works against any Vexa instance the user runs separately. See [issue #36](https://github.com/workforce0/workforce0/issues/36) for
> the real bundling work.

One interface, three implementations. All feed the same downstream pipeline (engagement creation, BA agent dispatch).

```ts
// backend/src/services/meeting-bot/meeting-bot-provider.types.ts
export type ProviderId = 'vexa' | 'recall' | 'manual';

export interface MeetingBotProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  isAvailable(): Promise<boolean>;
  scheduleBot(input: ScheduleBotInput): Promise<ScheduleBotResult>;
  cancelBot(botId: string): Promise<void>;
  getTranscript(botId: string): Promise<MeetingTranscript | null>;
  handleWebhook?(req: FastifyRequest, reply: FastifyReply): Promise<void>;
}

export interface MeetingTranscript {
  segments: TranscriptSegment[];
  durationSec: number;
  participants: string[];
  language: string;
}
```

### Three concrete providers

- **`VexaProvider`** — talks to bundled `vexa-api:18056`. Polls `/bots/:id/transcript`. No webhook.
- **`RecallProvider`** — talks to `https://api.recall.ai` with `RECALL_API_KEY`. Webhook at `/webhooks/meeting-bot/recall`, HMAC-verified via `RECALL_WEBHOOK_SECRET`.
- **`ManualProvider`** — `scheduleBot` throws `ProviderNotSchedulableError`. Always-available terminal fallback.

### Routing

```ts
// backend/src/services/meeting-bot/meeting-bot-router.service.ts
class MeetingBotRouter {
  private fallbackOrder: ProviderId[] = ['vexa', 'recall', 'manual'];

  async resolveProvider(tenantId: string): Promise<MeetingBotProvider> {
    const tenant = await this.tenantSettings.get(tenantId);
    const preferredId = tenant.meetingBotProviderId ?? this.fallbackOrder[0];

    for (const id of [preferredId, ...this.fallbackOrder.filter(x => x !== preferredId)]) {
      const provider = this.providers.get(id);
      if (provider && await provider.isAvailable()) return provider;
    }
    return this.providers.get('manual')!;
  }
}
```

### File layout

```
backend/src/services/meeting-bot/
├── meeting-bot-provider.types.ts
├── meeting-bot-router.service.ts
├── providers/
│   ├── vexa.provider.ts
│   ├── recall.provider.ts
│   └── manual.provider.ts
└── index.ts
```

DI container wires the router into existing `/api/meetings/schedule` and bot-event handler routes; direct-Recall code paths get *replaced* (not paralleled) by `RecallProvider`.

## §7 — Local meeting bot bundle

> **Status update (2026-04-25):** Vexa bundling has been deferred — the spec's
> claims about a `meeting-bot` Compose profile are aspirational. The provider
> abstraction (§6's main contribution) is shipped, and `VexaProvider` works
> against any Vexa instance the user runs separately. See [issue #36](https://github.com/workforce0/workforce0/issues/36) for the
> real bundling work.

We bundle Vexa's full compose (api + bot-manager + transcription + socket proxy), reusing Workforce0's Postgres and Redis instances. We deliberately *don't* use Vexa's "lite" config (single-Chrome, ephemeral Redis) because of known stability issues there.

### Compose

```yaml
vexa-api:
  image: ghcr.io/vexa-project/vexa-api:0.6.x
  profiles: ["meeting-bot"]
  environment:
    DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/workforce0_vexa
    REDIS_URL: redis://redis:6379/1
  depends_on: [postgres, redis]
  networks: [internal]

vexa-bot-manager:
  image: ghcr.io/vexa-project/vexa-bot-manager:0.6.x
  profiles: ["meeting-bot"]
  environment:
    DOCKER_HOST: tcp://docker-socket-proxy:2375
  depends_on: [docker-socket-proxy, vexa-api]
  networks: [internal]

docker-socket-proxy:
  image: tecnativa/docker-socket-proxy:0.3
  profiles: ["meeting-bot"]
  environment:
    CONTAINERS: 1
    POST: 1
    ALLOW_START: 1
    ALLOW_STOP: 1
    ALLOW_RESTARTS: 1
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
  networks: [internal]

vexa-transcription:
  image: ghcr.io/vexa-project/vexa-transcription:0.6.x
  profiles: ["meeting-bot"]
  environment:
    WHISPER_BACKEND: local
    WHISPER_API_URL: http://whisper:8000/v1
  depends_on: [whisper]
  networks: [internal]
```

### Security: Docker socket proxy

Vexa bot-manager mounts `/var/run/docker.sock` only to the proxy. Proxy whitelists only `containers.{create, start, stop, inspect}`. Mitigates "Vexa = root on host" footgun. Wizard explains threat model with link to docs page.

### Persistence

- **Postgres**: shared instance, separate database `workforce0_vexa`. Migration in init container.
- **Redis**: shared instance, logical DB index 1.
- **Bot recordings/transcripts**: filesystem volume `./data/vexa/`.

### Resource budget

| Component | Idle RAM | Per active meeting |
|---|---|---|
| vexa-api | ~150 MB | — |
| vexa-bot-manager | ~100 MB | — |
| vexa-transcription | ~50 MB | (delegates to whisper) |
| docker-socket-proxy | ~10 MB | — |
| Per-meeting Chrome bot | — | ~500 MB + ~10% CPU |
| **Idle baseline** | ~310 MB | — |
| **2 concurrent meetings** | ~310 MB | +1 GB |

Default `MAX_CONCURRENT_BOTS=2`. Fits the 16 GB Mac target alongside LLM bundle and rest of stack.

### Failure paths (and what surfaces)

| Failure | What user sees |
|---|---|
| Containers won't start | Wizard: "Vexa failed to start. [Logs] [Retry] [Switch to Recall] [Skip]" |
| Bot can't join meeting | Slack notification: "Couldn't join the meeting. Upload recording instead?" |
| Disk fills with old containers | Cleanup cron in vexa-bot-manager (1h); silent |
| Postgres connection drops | Same as "won't start" path |

### Upgrades

Pin to `0.6.x` in compose; CI job in main repo monitors Vexa releases, opens version-bump PR with smoke-test result. Users apply via `git pull && docker compose pull && docker compose up -d`.

## §8 — Local transcription

### Service

```yaml
whisper:
  image: fedirz/faster-whisper-server:latest-cpu  # or :latest-cuda
  profiles: ["local-stt"]
  environment:
    WHISPER_MODEL: ${WHISPER_MODEL:-Systran/faster-whisper-large-v3-turbo}
    WHISPER_INFERENCE_DEVICE: ${WHISPER_DEVICE:-auto}
    WHISPER_COMPUTE_TYPE: ${WHISPER_COMPUTE:-int8}
    PRELOAD_MODELS: '["Systran/faster-whisper-large-v3-turbo"]'
  volumes:
    - whisper-cache:/root/.cache/huggingface
  ports: []
  networks: [internal]
```

`faster-whisper-server` (Apache 2.0) exposes `/v1/audio/transcriptions` matching OpenAI Whisper API exactly.

### Tier auto-detection

| Tier | RAM avail. for STT | Default model | Size | Notes |
|---|---|---|---|---|
| Light | <8 GB | `Systran/faster-distil-whisper-large-v3.en` | ~750 MB | English-only, ~6× faster |
| Default | 8 GB+ | `Systran/faster-whisper-large-v3-turbo` | ~1.6 GB | 99 languages |
| GPU | NVIDIA / Apple Silicon | same `large-v3-turbo` | ~1.6 GB | float16, ~10× faster |

Override via `WHISPER_MODEL=...`.

### Internal callers

1. Vexa transcription service (`WHISPER_API_URL=http://whisper:8000/v1`).
2. Manual upload pipeline — `MEETING_PROCESS` job posts file to `http://whisper:8000/v1/audio/transcriptions`. Replaces today's Gemini-only path: try local → fall through to BYOK STT.
3. Voice dial-in (Spec 3, future) — Pipecat streams via chunked transfer.

### Fallback chain

```bash
STT_PROVIDER_CHAIN=local,openai,deepgram
```

`STTProviderRouter` tries `local` first. Falls through on: container down, model load failure, response timeout (`WHISPER_TIMEOUT_MULT * audio_duration`, default 2.0×), HTTP 5xx.

### Diarization

Out of scope. Vexa diarizes per-bot internally (separate audio streams). Manual uploads get speaker-agnostic transcripts (Speaker 1/2/3). WhisperX/pyannote diarization → Step 1.

### Resource budget

| State | RAM | CPU |
|---|---|---|
| Idle (model loaded) | ~1.8 GB (int8) | ~0% |
| Active (CPU, 1× realtime) | ~2.2 GB | 100% / core / stream |
| Active (GPU/MPS) | ~1 GB host + ~2 GB VRAM | 5-15% / core |

Default `MAX_CONCURRENT_TRANSCRIPTIONS=2`. CPU-only 60-min meeting: ~60 min transcription. GPU: ~6 min. Wizard warns CPU users.

### First-start UX

Container downloads model on first run (~1.6 GB); cached in volume. Wizard streams progress so user understands the wait.

## §9 — First-run wizard

Existing wizard: BYOK + integrations. Step 0 inserts three new screens.

### Flow

```
1. Welcome              (existing)
2. Hardware check       NEW
3. AI providers         existing, expanded
4. Meeting capture      NEW
5. Integrations         (existing)
6. Done + apply         (modified)
```

### Step 2 — Hardware check

Backend runs once on entry:

```ts
// backend/src/services/wizard/hardware-detect.service.ts
async detect(): Promise<HardwareProfile> {
  const totalRamGB = os.totalmem() / 1e9;
  const cpuCores = os.cpus().length;
  const gpu = await detectGpu();
  const freeDiskGB = await getFreeDisk();
  return {
    totalRamGB, cpuCores, gpu, freeDiskGB,
    availableForLLM_GB: totalRamGB - 4 - 3,
    recommendedTier: this.pickTier(totalRamGB, gpu),
  };
}
```

UI: "We detected **16 GB RAM, Apple Silicon GPU, 80 GB free**. Recommended tier: **Default**. [Use recommended] [Choose another]".

### Step 3 — AI providers (expanded)

Two columns: BYOK keys (left) + Local models (right). Either alone is sufficient; both = AI Council scenario.

```
┌─ BYOK ─────────────────┐  ┌─ Local models ──────────┐
│ □ Anthropic   [key  ]  │  │ ☑ Run models locally    │
│ □ OpenAI      [key  ]  │  │   Tier: ○ Light         │
│ □ Google      [key  ]  │  │         ● Default       │
│                        │  │         ○ Heavy         │
│ ☑ Verify on save       │  │   Disk needed: ~12 GB   │
│                        │  │   Includes Whisper STT  │
└────────────────────────┘  └─────────────────────────┘

⚠ At least one provider must be configured.
```

"Verify on save" makes a 1-token sanity call to each provider so bad keys fail at wizard time, not at first BA run.

If Local is on: `local-llm` and `local-stt` are added to `COMPOSE_PROFILES`.

**Profile coupling rule** — picking the bundled meeting bot in Step 4 *also* implies `local-stt` (Vexa needs a local Whisper endpoint to transcribe). If the user picks bundled meeting bot but skipped local LLMs, the wizard adds `local-stt` automatically and surfaces: "Bundled meeting bot includes local transcription (~1.6 GB additional)." `local-llm` and `local-stt` remain independently togglable in every other path.

### Step 4 — Meeting capture

Three cards, one selected:

```
┌─ Bundled (recommended) ─┐  ┌─ Recall.ai ────────────┐  ┌─ Skip ─────────┐
│ ✓ No external account   │  │ ✓ Most reliable joins  │  │ Manual upload   │
│ ✓ Apache 2.0, runs here │  │ ✓ Vendor-managed       │  │ only            │
│ ⚠ Adds ~310 MB RAM      │  │ ⚠ Costs ~$0.50/hour    │  │ Always works.   │
│   Powered by Vexa       │  │ ⚠ Audio leaves network │  │                 │
└─────────────────────────┘  └────────────────────────┘  └─────────────────┘
```

Bundled adds `meeting-bot` profile. Recall reveals API-key field. Skip writes nothing.

### Step 6 — Done + apply

Wizard saves `.env`, then prints:

```
✓ Configuration saved.

Almost done! Run this in your terminal:

    cd workforce0 && ./bin/setup-finish.sh

This pulls images and starts services you enabled (local models,
Whisper, meeting bot). 5-15 min the first time depending on choices.

[I'll do it now]   [Wait, let me change something]
```

`bin/setup-finish.sh`:
```bash
docker compose pull
docker compose up -d --remove-orphans
docker compose logs -f --tail=20 backend frontend
```

After "I'll do it now" the wizard polls `/api/integrations/*/status` once per second; flips each row green as it comes up.

### Re-running

Mounted at `/setup`; checks `installComplete` flag. Reachable via Settings → Reconfigure for adding keys/changing meeting capture later.

## §10 — Step 1 upgrade path

### Compatibility contract

| Surface | Promise |
|---|---|
| **DB schema** | Step 1 only adds columns/tables. Migrations forward-only. |
| **`.env` keys** | Step 0 keys stay supported; Step 1 keys have defaults. |
| **Compose profiles** | Step 0's profiles stay; Step 1 may add new ones. |
| **Public API** | Step 0 routes never break. New routes go to `/api/v2/*`. |
| **`MeetingBotProvider`** | Interface stable. New providers slot in. |

### What Step 1 adds (preview, not designed here)

- AI Council in production mode (multi-provider critique on every run).
- M8 verified decomposition (plan→critique→revise + self-consistency).
- More agents: support agent, ops agent.
- Hosted-tier API shim (env-gated; off for self-hosted by default).

### Upgrade flow

```bash
cd workforce0
git pull
docker compose pull
docker compose up -d --remove-orphans
```

Backend runs pending Prisma migrations on startup. Wizard re-prompts only for newly-introduced settings, on first login post-upgrade. Banner: "New: AI Council multi-provider critique is available. [Enable] [Later]".

### Trap-door triggers (when Step 0 stops being enough)

1. **Throughput** — >5 concurrent meetings/day on a 16 GB host. Scale horizontally or move to managed.
2. **Cross-team / multi-org** — Step 1 multi-tenant (still self-hostable).
3. **Always-on availability** — laptop-sleep breaks bots. Run on Linux server (same compose, no code change).

None force a managed/hosted tier. OSS scales to a beefy box.

## §11 — Migration for existing installs

Step 0 is purely additive. `git pull && docker compose up -d` doesn't break existing installs or auto-start Step 0 services.

### What an existing installer sees

```
[Backend startup]
  ✓ Migrations applied (3 new additive tables: HardwareProfile, MeetingBotConfig, ProviderHealth)
  ✓ Step 0 features available; not enabled.

[UI on next login]
  ┌────────────────────────────────────────────────────┐
  │ ℹ Workforce0 v0.6 adds local-first features.       │
  │   [Configure now]  [Tell me more]  [Not now]       │
  └────────────────────────────────────────────────────┘
```

"Not now" sets `step0Dismissed=true`; no further nags. Settings → Reconfigure reaches it later.

### Slimmed migration wizard

| §9 screen | Existing install sees? |
|---|---|
| Welcome | skipped |
| Hardware check | shown |
| AI providers | shown, BYOK pre-filled; only "Local models" toggle is new |
| Meeting capture | shown |
| Integrations | skipped |
| Done + setup-finish.sh | shown |

Tracks completion with `step0Migrated=true`.

### Compose-side migration

Step 0 adds `meeting-bot`, `local-llm`, `local-stt` profiles. **None active by default** — `git pull && docker compose up -d` does NOT silently start downloading model weights. Services come up only after wizard apply.

User overrides in `docker-compose.override.yml` are preserved.

### Rollback

`git checkout <previous-tag> && docker compose up -d` works:

- New schema columns/tables tolerated by old code (additive).
- New compose profiles ignored by old base file.
- Downloaded model weights persist in named volumes (~5-12 GB); user reclaims with `docker volume rm` if desired.

### Migration smoke test (CI, runs on every Step 0 PR)

1. Boot pre-Step-0 image with seed data (3 engagements, 5 meetings).
2. Pull Step 0 image; `docker compose up -d`.
3. Assert: backend healthy, all 5 meetings still listed, no errors in logs.
4. Run wizard "skip local, skip Vexa".
5. Assert: install identical to pre-Step-0 (no new containers running).
6. Re-run wizard "enable Vexa, enable local LLM Light tier".
7. Assert: new containers up, transcription works, BA agent runs against Qwen.

Catches additive-violation regressions before they reach existing users.

## §12 — Failure modes & observability

### Failure taxonomy

| What fails | Detection | What user sees | Recovery |
|---|---|---|---|
| Ollama model not loaded | `/api/tags` empty; first inference times out | UI tag "Local model loading…"; Council router falls through | Pre-warm on backend startup; status flips to `unavailable` after 60s |
| Ollama OOM mid-inference | Process killed (137); next request retries | Inference call throws → fallback chain | Auto-restart via `restart: unless-stopped`; wizard suggests smaller tier on repeated OOM |
| Whisper model download failed | Container restart loop; `/health` 503 | Wizard apply: "Whisper failed to download model: <reason>" | Backend retries 3× with backoff; user can `bin/diagnose.sh --pull-models` |
| Whisper audio timeout (>2× duration) | `STTProviderRouter` timer | Falls through to OpenAI/Deepgram if configured; else "Transcription took too long" + retry | `WHISPER_TIMEOUT_MULT` configurable |
| Vexa container won't start | Compose health-check fails | Status indicator red; banner "Live capture unavailable" + actionable | `bin/diagnose.sh` dumps last 50 lines |
| Vexa bot can't join | `scheduleBot` returns error | Per §6, falls through. Slack: "Couldn't join. Upload recording?" | Most: SSO/captcha. No auto-recovery |
| Docker socket proxy down | Bot-manager can't spawn | Same as "Vexa won't start" | Auto-restart |
| All providers down | Council exhausts chain | Toast: "AI services unavailable. Check Settings → Status"; engagement paused | Operator visits status page |
| `setup-finish.sh` fails | Script exits non-zero | Wizard polls timeout (15 min); shows captured log tail | `bin/diagnose.sh` |

### Health checks

Each new service exposes `/health`. Backend aggregates:

```ts
const SERVICES = {
  ollama:           { url: 'http://ollama:11434/api/tags',     enabled: hasProfile('local-llm') },
  whisper:          { url: 'http://whisper:8000/health',       enabled: hasProfile('local-stt') },
  vexa_api:         { url: 'http://vexa-api:18056/health',     enabled: hasProfile('meeting-bot') },
  vexa_bot_manager: { url: 'http://vexa-bot-manager:8080/health', enabled: hasProfile('meeting-bot') },
  socket_proxy:     { url: 'http://docker-socket-proxy:2375/_ping', enabled: hasProfile('meeting-bot') },
};

// GET /api/integrations/status → { service, status: 'up'|'down'|'disabled', latency_ms, last_error }
```

UI consumes this for the status indicator (CLAUDE.md requirement).

### Status dashboard

Settings → System status. Traffic-light dot per service, P50/P95 latency, recent error count. Click row → last 50 log lines (proxied via backend, no host shell).

### Metrics (Prometheus-compatible at `/metrics`)

```
workforce0_council_session_total{role,exit_reason="threshold|max_rounds|max_steps"}
workforce0_council_session_duration_seconds{role,exit_reason}
workforce0_provider_call_total{provider,model,status="success|fallback|error"}
workforce0_provider_call_duration_seconds{provider,model}
workforce0_meeting_bot_join_total{provider,status}
workforce0_transcription_duration_ratio{provider}
workforce0_local_model_loaded{model}
```

`infra/grafana/step0-dashboard.json` ships in repo. Optional `monitoring` profile (Prometheus + Grafana) for users who want it; default-off.

### Structured logging

All new services use Pino. Consistent fields:

```ts
log.info({
  service: 'meeting-bot',
  provider: 'vexa',
  meetingId,
  tenantId,
  durationMs: 12_400,
}, 'Bot joined meeting');
```

Per `feedback_self_review_before_push` memory: `log.error({obj}, 'msg')` ordering — never reversed. Lint rule enforces.

### Self-diagnosis

```bash
$ bin/diagnose.sh

Workforce0 diagnostic — 2026-04-25T...
─────────────────────────────────────
✓ Backend: up (12ms)
✓ Frontend: up (8ms)
✓ Postgres: up (3ms)
✓ Redis: up (1ms)
✗ Ollama: DOWN — connection refused
  Last 5 log lines: [...]
  Suggestion: switch to Light tier or close other applications.
✓ Whisper: up (15ms)
✓ Vexa API: up (24ms)

3 services degraded. Run `docker compose logs <service>` for details.
```

Output captured to `./diagnostics-<timestamp>.txt`. PII-aware: redacts `.env` values, transcript content, meeting URLs.

---

## File-system layout impact (summary)

```
backend/src/services/
├── meeting-bot/                  NEW
│   ├── meeting-bot-provider.types.ts
│   ├── meeting-bot-router.service.ts
│   └── providers/{vexa,recall,manual}.provider.ts
├── stt/                          NEW
│   ├── stt-provider.types.ts
│   ├── stt-router.service.ts
│   └── providers/{local-whisper,openai,deepgram}.provider.ts
├── wizard/                       expanded
│   ├── hardware-detect.service.ts        NEW
│   └── (existing files updated for new screens)
└── model-registry/               expanded
    └── default-assignments.ts            updated (Council loop guards)

backend/prisma/schema.prisma
  + model HardwareProfile {...}    NEW (additive)
  + model MeetingBotConfig {...}   NEW (additive)
  + model ProviderHealth {...}     NEW (additive)
  + tenantSettings: + step0Migrated, + step0Dismissed, + meetingBotProviderId

bin/                              NEW
├── setup-finish.sh
└── diagnose.sh

infra/grafana/
└── step0-dashboard.json          NEW

docker-compose.prod.yml           updated
  + ollama (profile: local-llm)
  + whisper (profile: local-stt)
  + vexa-api / bot-manager / transcription / docker-socket-proxy (profile: meeting-bot)

frontend/src/app/setup/           expanded
  + steps/HardwareCheck.tsx       NEW
  + steps/MeetingCapture.tsx      NEW
  + steps/Apply.tsx               NEW (modified)

docs-site/src/content/docs/
├── self-hosting/local-models.md  NEW
├── self-hosting/meeting-bot.md   NEW
├── self-hosting/transcription.md NEW
└── self-hosting/diagnose.md      NEW

MODELS.md                         NEW (root) — tracks model versions + review cadence
```

## Open questions (none blocking — flagged for writing-plans)

- Vexa version pinning strategy: track `0.6.x` minor or stay on a fixed patch? Default to minor; revisit if upstream breakage rate > 1/quarter.
- `local-stt` is independent of `local-llm` (user can have local STT without local LLM, or vice versa) but `meeting-bot` profile implies `local-stt` because vexa-transcription needs a local Whisper endpoint.
- Dependabot-style version-bump PRs: which scheduler? GitHub Actions workflow with monthly cron is enough for now.

## Acknowledgements

- [Vexa](https://github.com/Vexa-ai/vexa) — Apache 2.0, the meeting bot stack we're bundling.
- [Ollama](https://ollama.com/) — local LLM serving.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) and [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) — local STT.
- [tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) — socket isolation.
