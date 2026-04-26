# Voice Intake — Pipecat + faster-whisper + Kokoro (Design)

**Status:** approved (brainstorming → spec)
**Date:** 2026-04-25
**Author:** Workforce0 team

---

## Summary

Add inbound phone-call intake as a third **VoiceProvider** option (`pipecat`) alongside the existing `gemini` (Gemini Live) and `openai` (OpenAI Realtime) providers. A caller dials a Twilio number, optionally enters a PIN, and talks to a local agent that captures requirements verbally. On hangup, the transcript flows into the existing `MEETING_PROCESS` queue → BA Agent → PRD pipeline.

Pipecat is the orchestration framework; **faster-whisper** (already shipped in Plan 2) does STT; **Ollama** (already shipped in Plan 2) runs the LLM; **Kokoro** is the new local TTS. Qwen3-TTS sits as a tier-up option for multilingual.

This is **Step 0 voice** — fully local, BYOK-free, runs on the same Compose stack.

## Non-goals

- **No replacement of Gemini Live / OpenAI Realtime.** They stay; Pipecat is alongside.
- **No outbound dial-in to meetings.** That stays in `backend/src/voice/`; this spec is inbound only.
- **No in-app browser-mic voice UI.** WebRTC, push-to-talk, etc. — separate spec.
- **No voice approvals.** Slack/WhatsApp replies already cover that surface.
- **No mlx-whisper.** Plan 2's `faster-whisper` covers all platforms; mlx-whisper is a future tier-up.
- **No automatic mid-call provider fallback.** Caller hears one provider's voice through one call.

## Personas (from CLAUDE.md)

| Persona | What they care about in this spec |
|---|---|
| Installer (technical operator) | Adds `local-voice` Compose profile, configures Twilio number + caller-ID allowlist + per-tenant PIN. |
| Consumer (non-technical exec) | Dials a number, talks naturally, hangs up. Sees the resulting brief in Slack later. |

---

## §1 — High-level shape

```
PSTN caller ──▶ Twilio Voice (inbound number)
                       │
                       │ POST /webhooks/twilio/voice/inbound
                       ▼
              Workforce0 Twilio webhook
                       │
                       │ verify caller-ID against tenant allowlist
                       │
            ┌──────────┴───────────┐
            ▼ allowed              ▼ unknown
   <Connect><Stream>            <Gather digits><Say>
                                "please enter your PIN…"
            │                     │ valid → fall through
            │                     │ invalid → <Hangup/>
            ▼
   WebSocket /media-stream/inbound/<CallSid>
            │
            │ TwilioMediaHandler (existing)
            │  ↕ μ-law ↔ PCM 16kHz codec
            ▼
   ╔════════════════════════════╗
   ║ VoiceProvider (router)     ║
   ║   gemini | openai | pipecat║
   ╚════════════════════════════╝
            │ (if pipecat)
            ▼
   ┌────────────────────────────────────┐
   │ Pipecat pipeline (Python sidecar)  │
   │   STT  → faster-whisper (Plan 2)   │
   │   LLM  → Ollama (Plan 2)           │
   │   TTS  → Kokoro (new)              │
   └────────────────────────────────────┘
            │
            │ on hangup: full transcript
            ▼
   MEETING_PROCESS queue → BA Agent → PRD
```

**Compose footprint** — new `local-voice` profile that pulls along:
- Existing `whisper` (from `local-stt` profile, reused)
- Existing `ollama` (from `local-llm` profile, reused)
- New `kokoro-tts` container (Apache 2.0, ~300 MB)
- New `pipecat-bridge` Python sidecar

`local-voice` profile *implies* `local-stt` and `local-llm` (wizard auto-enables both — same coupling rule as Plan 1's `meeting-bot` → `local-stt`).

---

## §2 — Components

### Backend (TypeScript)

```
backend/src/services/voice-provider/                                NEW
├── voice-provider.types.ts            — interface + DTOs
├── voice-provider-router.service.ts
├── voice-provider-router.service.test.ts
├── caller-auth.service.ts             — caller-ID + PIN logic
├── caller-auth.service.test.ts
└── providers/
    ├── gemini-realtime.provider.ts        wraps existing voice/gemini-live.ts
    ├── gemini-realtime.provider.test.ts
    ├── openai-realtime.provider.ts        wraps existing voice/openai-realtime.ts
    ├── openai-realtime.provider.test.ts
    ├── pipecat.provider.ts                talks to pipecat-bridge sidecar
    └── pipecat.provider.test.ts

backend/src/routes/webhooks/
├── twilio-inbound.routes.ts            NEW   inbound TwiML + DTMF gather
└── twilio-inbound.routes.test.ts       NEW
```

The existing `backend/src/voice/` and `backend/src/services/voice/` directories stay untouched — the new providers wrap them.

### Interface

```ts
// backend/src/services/voice-provider/voice-provider.types.ts
export type VoiceProviderId = 'gemini' | 'openai' | 'pipecat';

export interface VoiceSessionInput {
  callId: string;            // Twilio CallSid
  tenantId: string;
  callerNumber: string;      // E.164
  audioInWs: WebSocket;      // Twilio media stream
  systemPrompt: string;      // intake prompt
}

export interface VoiceSessionHandle {
  sessionId: string;
  stop(): Promise<void>;
  onTranscriptComplete(cb: (transcript: TranscriptDoc) => void): void;
  onError(cb: (err: Error) => void): void;
}

export interface VoiceProvider {
  readonly id: VoiceProviderId;
  isAvailable(): Promise<boolean>;
  startSession(input: VoiceSessionInput): Promise<VoiceSessionHandle>;
}
```

### Caller auth

```ts
// backend/src/services/voice-provider/caller-auth.service.ts
export class CallerAuthService {
  async checkCallerId(tenantId: string, fromNumber: string): Promise<'allowed' | 'needs_pin' | 'not_configured'>;
  async verifyPin(tenantId: string, pin: string, fromNumber: string): Promise<boolean>;
}
```

- Allowlist + PIN stored on `TenantSettings` (additive migration: `voiceCallerAllowlist String[]`, `voicePinHash String?`).
- PIN verification uses `crypto.timingSafeEqual` against stored bcrypt/argon2 hash.
- Failure rate-limit: 3 PIN attempts per `tenantId+from` per hour, tracked in Redis.

### Pipecat sidecar (Python)

```
infra/pipecat-bridge/                                               NEW directory
├── Dockerfile                          python:3.12-slim + pipecat-ai
├── pyproject.toml
├── server.py                           FastAPI WebSocket server
├── pipeline.py                         Pipecat pipeline assembly
├── stt_adapter.py                      calls faster-whisper-server HTTP
├── llm_adapter.py                      calls Ollama OpenAI-compat endpoint
├── tts_adapter.py                      calls Kokoro container HTTP
├── auth.py                             verifies one-time JWT from backend
└── tests/
    ├── test_auth.py
    ├── test_pipeline_smoke.py
    └── test_adapters.py
```

**Why a sidecar:** Pipecat is Python-only and its mature integrations (Twilio, Daily, WebRTC adapters) live in Python. Calling Pipecat from Node via FFI was considered and rejected — the Python ecosystem's existing battle-tested adapters are the win we're paying for.

**Bridge protocol:** Backend opens a WebSocket to `pipecat-bridge:8400/sessions/<call-id>?token=<jwt>`. Backend forwards Twilio media frames in; bridge sends synthesized audio + transcript chunks out. Authenticated by a short-lived JWT signed by the backend (`BRIDGE_JWT_SECRET`, 1h TTL — well above any single call's `VOICE_MAX_CALL_DURATION_SEC`).

### Compose

```yaml
kokoro-tts:
  image: ghcr.io/kokoro-ai/kokoro-tts:0.1   # version verified at implementation time
  container_name: workforce0-kokoro-tts
  profiles: ["local-voice"]
  ports: []                                  # internal-only
  networks: [workforce0]
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8880/health || exit 1"]
    interval: 30s
    start_period: 60s

pipecat-bridge:
  build:
    context: ./infra/pipecat-bridge
    dockerfile: Dockerfile
  container_name: workforce0-pipecat-bridge
  profiles: ["local-voice"]
  environment:
    WHISPER_BASE_URL: http://whisper:8000
    OLLAMA_BASE_URL:  http://ollama:11434
    KOKORO_BASE_URL:  http://kokoro-tts:8880
    BRIDGE_JWT_SECRET: ${BRIDGE_JWT_SECRET:?required}
  depends_on:
    whisper:    { condition: service_healthy }
    ollama:     { condition: service_healthy }
    kokoro-tts: { condition: service_healthy }
  networks: [workforce0]
```

### Wizard

New "Voice intake" step inserted between Meeting Capture and Integrations:

```
☐ Enable inbound voice intake
   Twilio number: ____________________
   Caller-ID allowlist (E.164, comma-separated): _______________
   Set fallback PIN (optional, 4 digits): ____
```

Saving writes `tenantSettings.voiceCallerAllowlist`, `tenantSettings.voicePinHash`, and adds `local-voice` to `COMPOSE_PROFILES`.

---

## §3 — Data flow + state machine

### Inbound call lifecycle

```
[1] Caller dials Twilio number
[2] Twilio POSTs to /webhooks/twilio/voice/inbound
[3] Backend: CallerAuthService.checkCallerId(tenantId, from)
       ├── allowed     → return TwiML <Connect><Stream>
       ├── needs_pin   → return <Gather digits="4" timeout="10"
       │                          action="/webhooks/twilio/voice/pin"><Say>…</Say></Gather>
       └── not_configured → <Say>Voice intake is not configured.</Say><Hangup/>
[4] If PIN path: Twilio POSTs PIN → CallerAuthService.verifyPin
       ├── valid    → <Connect><Stream>
       └── invalid  → <Say>Access denied.</Say><Hangup/>  (rate-limit after 3)
[5] Twilio opens WebSocket to /media-stream/inbound/<CallSid>
[6] Backend resolves VoiceProvider via router.resolveProvider(tenantId)
[7] Provider establishes its pipeline:
       pipecat: opens WS to pipecat-bridge with one-time JWT
       gemini:  opens Gemini Live WS
       openai:  opens OpenAI Realtime WS
[8] Bidirectional audio loop via TwilioMediaHandler (existing μ-law codec)
[9] On caller hangup OR system stop:
       handler closes Twilio WS
       provider emits final transcript
       backend writes Meeting row (source: 'voice_intake'),
       enqueues MEETING_PROCESS
[10] BA Agent picks up MEETING_PROCESS → PRD lifecycle continues
```

### Session state machine

```
states: { CONNECTING, AUTHED, STREAMING, ENDING, FAILED, ENDED }

CONNECTING --[caller-id allowed]--> AUTHED
CONNECTING --[needs PIN, valid]--> AUTHED
CONNECTING --[bad PIN x3 OR timeout]--> FAILED → ENDED
AUTHED     --[provider.startSession ok]--> STREAMING
AUTHED     --[no provider available]--> FAILED → ENDED
STREAMING  --[caller hangup]--> ENDING --> ENDED  (transcript written)
STREAMING  --[provider error]--> FAILED  (transcript-so-far written if non-empty)
STREAMING  --[max-call-duration]--> ENDING --> ENDED
ENDED      [terminal — emits voice.session_complete telemetry]
```

`VOICE_MAX_CALL_DURATION_SEC=900` (15 min default). Agent says "we're approaching the limit, anything else?" at T-2 min.

### Transcript shape

Identical to `MeetingTranscript` from `meeting-bot-provider.types.ts` so the downstream `MEETING_PROCESS` handler doesn't branch on source. New `Meeting.source = 'voice_intake'` enum value (additive migration). Caller's number stored in `Meeting.metadata.callerNumber` for audit.

### Telemetry

One `voice.session_complete` event per call:

```ts
{
  tenantId, callId, providerId, durationSec,
  authMethod: 'caller_id' | 'pin',
  endReason: 'hangup_caller' | 'hangup_max_duration' | 'hangup_silence'
           | 'hangup_cost_cap' | 'failed_no_provider'
           | 'failed_provider_error' | 'failed_pin' | 'failed_caller_id',
  transcriptLength, totalTokens, totalCostUsd,
}
```

Same emission pattern as `council.session_complete` from Plan 2. Plan 3's status dashboard scrapes both via the same Prometheus exporter (when that lands).

---

## §4 — Error handling + edge cases

### Failure taxonomy

| What fails | Detection | Caller experience | Persistence |
|---|---|---|---|
| Twilio webhook signature invalid | sig check at route entry | 401, no TwiML returned (Twilio "application error" tone) | none |
| Tenant not configured for voice | `CallerAuthService.checkCallerId` → `not_configured` | `<Say>Voice intake is not configured.</Say><Hangup/>` | log attempt |
| PIN attempts exceeded | Redis counter `tenantId+from` (1h TTL) | `<Say>Access denied.</Say><Hangup/>` and any further inbound from `from` returns `<Hangup/>` immediately for the next 1h | log every blocked attempt |
| All voice providers unavailable | `router.resolveProvider` returns null | `<Say>Voice service is temporarily unavailable.</Say><Hangup/>` | log + alert |
| Pipecat sidecar refuses JWT | bridge returns 401 on WS upgrade | session FAILED → caller hears "system error, please try again" + hangup | log |
| LLM hangs (Ollama warming, OOM) | per-turn timeout (10s) inside Pipecat | agent says "one moment" filler, retries once; 2nd timeout → graceful exit | partial transcript saved if ≥1 user turn |
| TTS fails mid-utterance | Pipecat error event | agent silent for that turn; pipeline continues | partial audio dropped |
| Twilio WebSocket drops | `wsClose` event | session goes to ENDING; reconnect within 10s allowed; else write transcript-so-far | partial transcript |
| Caller stays silent >30s | VAD-driven inactivity timer | agent prompts "are you still there?"; 2nd 30s → graceful hangup | transcript-so-far |
| Bridge JWT expires mid-call | should never happen (1h TTL > max call) | logged anomaly; caller continues until provider WS closes naturally | full transcript |
| Caller hangs up during DTMF gather | Twilio call status `completed` | nothing — never entered AUTHED | log only |

### Hard rules

- **No automatic mid-call provider fallback.** Caller would hear the model voice change. Sessions FAIL closed; only `router.resolveProvider` at session start uses fallback.
- **No write to MEETING_PROCESS for empty transcripts.** Zero user turns ⇒ no Meeting row.
- **No retry of FAILED sessions.** Caller calls back. Mid-call retries land in scary territory.

### Cost guards

Per-call cost tracking (relevant for BYOK Gemini/OpenAI; Pipecat path is ~$0):

- Soft: `> $1.00` → log `warn`, no caller-visible change
- Hard: `> VOICE_HARD_COST_CAP_USD` (default `2.00`) → agent says "we've reached the budget for this call" + ENDING

---

## §5 — Testing

### Unit tests (TS, Vitest)

| Component | Coverage |
|---|---|
| `VoiceProviderRouter` | preferred provider resolves; falls through chain on `isAvailable=false`; returns null when all unavailable; never falls through mid-session |
| `CallerAuthService.checkCallerId` | `allowed` / `needs_pin` / `not_configured`; allowlist match is exact E.164 |
| `CallerAuthService.verifyPin` | constant-time compare; rate-limits after 3 fails per `tenantId+from`; PIN rotation honored |
| `GeminiRealtimeProvider`, `OpenAIRealtimeProvider` | wrap existing `voice/*` code — assert `startSession` returns a handle, `stop()` cleanly shuts down |
| `PipecatProvider` | mocks bridge WebSocket: `startSession` mints JWT, opens WS, forwards Twilio audio, surfaces transcript chunks, emits `onTranscriptComplete` on stop |
| `twilio-inbound.routes.ts` | webhook signature validation; allowlist path TwiML; PIN path TwiML; PIN failure TwiML; not-configured TwiML |

Mocks: `vi.fn()` for WebSocket, `ioredis-mock` for Redis, Twilio SDK signing helper for test signatures.

### Integration test (TS)

`backend/src/__tests__/integration/voice-intake.integration.test.ts`:

1. Boot Fastify with all routes, mock `VoiceProvider`.
2. Webhook with valid sig + caller on allowlist → TwiML contains `<Connect><Stream>`.
3. Webhook with valid sig + caller NOT on allowlist → `<Gather>`.
4. Webhook with invalid sig → 401.
5. Open `/media-stream/inbound/<id>`, mock router resolves to fake provider, send 5 audio frames, close, assert transcript emitted + `MEETING_PROCESS` enqueued with right `Meeting.id`.

### Pipecat sidecar tests (Python, pytest)

`infra/pipecat-bridge/tests/`:

- `test_auth.py` — valid JWT accepted; expired/wrong-secret JWTs rejected with 401
- `test_pipeline_smoke.py` — STT/LLM/TTS adapters mocked, sample frame in produces sample frame out + transcript chunk; pipeline shuts down cleanly
- `test_adapters.py` — adapters POST to mocked Whisper/Ollama/Kokoro with correct shapes

CI job `pipecat-bridge-tests` runs `pytest` in the bridge container, path-filtered to `infra/pipecat-bridge/**`.

### End-to-end manual test

`bin/diagnose-voice.sh`:

1. `docker compose --profile local-voice up -d`
2. Verify `whisper`, `kokoro-tts`, `pipecat-bridge` containers reach `healthy`
3. Play `tests/fixtures/voice-intake-sample.wav` into the bridge's debug `/sessions/synthetic` endpoint
4. Assert transcript JSON returned within 15s
5. Report timing: STT ms, LLM ms, TTS ms, total round-trip

Documented as the "voice smoke test" in `docs-site/.../self-hosting/voice.md`.

### Explicitly NOT tested

- **Real Twilio call to a real number.** Costs money, can't run in CI; manual verification step before tagging a release.
- **Audio quality of Kokoro output.** Subjective; covered by listening to the smoke-test sample.
- **Pipecat internals.** Treated as a vendored library; we test our adapters around it, not its pipeline machinery.

---

## File-system layout impact (summary)

```
backend/
├── prisma/schema.prisma                               additive: TenantSettings.{voiceCallerAllowlist,voicePinHash}, Meeting.source enum '+voice_intake'
├── src/
│   ├── services/voice-provider/                      NEW (see §2)
│   ├── routes/webhooks/twilio-inbound.routes.ts      NEW
│   ├── routes/setup-step0.routes.ts                  modified — wizard schema accepts voice config
│   └── lib/di-container.ts                           modified — wires CallerAuthService, VoiceProviderRouter
infra/pipecat-bridge/                                  NEW directory (see §2)
docker-compose.prod.yml                                modified — kokoro-tts + pipecat-bridge under local-voice profile
frontend/src/components/wizard/voice-intake.tsx       NEW — wizard step component
frontend/src/components/onboarding-wizard.tsx          modified — insert voice-intake step
docs-site/src/content/docs/self-hosting/voice.md       NEW — voice smoke test + setup walkthrough
docs-site/src/content/docs/integrations/voice-intake.md NEW — three providers, when to use each
README.md                                              modified — Step 0 section mentions local-voice profile
MODELS.md                                              modified — Kokoro + Qwen3-TTS rows
```

## Open questions (non-blocking — flagged for writing-plans)

- **Kokoro container image source.** `ghcr.io/kokoro-ai/kokoro-tts:0.1` is a placeholder; verify the canonical published image at implementation time. Fall-back: build from the official Kokoro Python wrapper.
- **PIN hashing algorithm.** bcrypt vs argon2id — pick whichever the codebase already depends on for password hashing. If neither, default to argon2id.
- **Where does the voice intake's "system prompt" live?** Probably in `backend/src/services/agents/intake/prompts.ts` (new), parallel to the BA Agent's prompts. Detail for the implementation plan.
- **Kokoro version pinning.** Treat like Whisper — pin to a specific tag, track via `MODELS.md` monthly review.

## Acknowledgements

- [Pipecat](https://github.com/pipecat-ai/pipecat) — voice agent framework (Apache 2.0)
- [Kokoro](https://github.com/kokoro-ai/kokoro) — open TTS, 82M parameters (Apache 2.0)
- [Qwen3-TTS](https://huggingface.co/Qwen) — multilingual tier-up TTS (Apache 2.0)
- [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) — STT (already in Plan 2)
- [Ollama](https://ollama.com) — local LLM (already in Plan 2)
