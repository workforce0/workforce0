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
