---
title: Twilio (voice)
description: Phone dial-in for meeting capture. Pairs with Gemini Live.
---

## What it does

Provisions a phone number. Attendees dial it, have a voice meeting,
hang up — a brief summary lands in Slack.

See [Voice dial-in](/usage/voice/) for the exec-facing UX.

## Setup

1. **Twilio side**
   - [console.twilio.com](https://console.twilio.com/) → buy a voice-
     capable phone number (~$1/mo in the US).
   - Under the number's **Voice Configuration**:
     - **A call comes in** → Webhook → `https://your-workforce0/api/voice/incoming`.
     - Method: `POST`.
   - Copy your **Account SID** and **Auth Token** from the main
     console.

2. **Workforce0 side**
   - **Integrations → Twilio → Connect**.
   - Paste SID, token, phone number (E.164 format: `+14155551234`).
   - Save.

3. **Gemini API** — voice transcription runs through Gemini Live. Set
   `GEMINI_API_KEY` even if you use Anthropic / OpenAI for planning.

## How it routes

- **Inbound call** — Twilio → our `/api/voice/incoming` → we answer
  with TwiML that opens a Media Stream.
- **Media Stream** → Gemini Live (WebSocket) → real-time
  speech-to-text.
- On hangup → we close the stream, persist the transcript as a
  Meeting, and auto-brief (if enabled).

## Caller allowlist

Public phone numbers get spam. Allowlist:

- **Integrations → Twilio → Allowlist**.
- Add E.164 numbers (`+14155551234`).
- Unknown numbers hear "we don't recognize this number" and hang up.

Wildcards: `+1415*` allowlists all San Francisco area code.

## Outbound calls

The exec can **Dial out** from the web UI:

1. Meeting detail page → **Start dial-in**.
2. Enter the other party's number.
3. Twilio dials them; when they answer, the meeting joins you on the
   same stream.

Useful for proactive outreach.

## Cost notes

- Twilio: ~$0.014/min (US). International varies.
- Gemini Live: counts against your Gemini quota.

Both caps are enforceable — see [Cost caps](/byok/cost-caps/).

## Privacy

- Default `RETAIN_CALL_AUDIO=0` — no audio persisted to disk.
- Transcripts are stored in Postgres.
- Twilio's recording of the call is disabled at our TwiML layer.

If you're in a jurisdiction with two-party-consent recording laws
(e.g. California, EU), the greeting the caller hears includes a
recording-consent notice. Customize via `backend/src/voice/greeting.ts`.

## Troubleshooting

| Symptom                              | Fix                                              |
| ------------------------------------ | ------------------------------------------------ |
| Call rings forever                   | Webhook URL unreachable or `/incoming` returns 500. |
| Call connects, silence               | Gemini key invalid OR Media Stream URL unreachable. |
| "Sorry, we don't recognize…"         | Allowlist reject (or caller blocked number).     |
| Transcript is partial                | Network drops on long calls; known issue. Short < 60min work reliably. |

## Alternatives to Twilio

In principle any SIP provider with a Media Stream-equivalent API
works. In practice, only Twilio is tested. Forks / PRs for other
providers welcome.
