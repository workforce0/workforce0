---
title: Voice dial-in
description: Phone-first meeting capture via Twilio + Gemini Live. Call a number, have a meeting, get a brief.
---

:::note[Audience]
Exec / consumer, with one-time setup by the installer.
:::

## What it is

A phone number the exec can give to anyone ("Call +1-415-…"). Attendees
dial in, have a normal voice conversation, hang up. Within ~30 seconds
a brief summary lands in Slack.

Under the hood: Twilio handles telephony → Media Stream delivers the
audio → Gemini Live does real-time speech-to-structured-text →
chief-of-staff takes over.

## Why voice

- **Lowest friction.** No "share your screen" or "add this person to
  Google Meet." The exec gives out a number.
- **No recording to deal with.** Nothing to upload after.
- **Attendee-agnostic.** Works for customers, vendors, investors —
  anyone with a phone.

## Setup (once, by the installer)

You'll need:

- A **Twilio account** with a voice-capable phone number.
- Your Workforce0 instance reachable from Twilio's webhooks (i.e.
  publicly addressable, or tunnelled via Cloudflare Tunnel / ngrok
  for development).
- A **Gemini API key** with the Live API enabled (free tier is fine).

### Twilio configuration

1. In your Twilio console, open the phone number's settings.
2. Under **Voice Configuration** → **A call comes in**, set webhook:
   ```
   https://your-workforce0.example.com/api/voice/incoming
   ```
   Method: `POST`. Primary handler: Webhook.
3. Save.

### Workforce0 configuration

Set in `.env`:

```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+14155551234
GEMINI_API_KEY=...            # the Live API uses this key
```

Restart backend. Verify by calling the number — the handler should
answer with a short greeting and the call should appear on the
**Meetings** page within seconds.

### Customising the greeting

The greeting ("Hi, you've reached Workforce0 for Acme. Your meeting is
being captured. Speak normally when ready.") is in
`backend/src/voice/greeting.ts`. Edit and rebuild.

## Using it (exec)

Give your attendee the number. Tell them:

- Call normally.
- Speak as they would in any meeting.
- Hang up when you're done.

That's it. They don't need an account, an app, or an invitation.

### During the call

- There's a **live indicator** on the web UI's dashboard while a call
  is active — partial transcript visible.
- The exec can **join the call** themselves from the web UI (Twilio
  dial-out) if they're the one running the call.
- Calls that run longer than 60 minutes gracefully close and start a
  new meeting — the chief-of-staff stitches them back together.

### After the call

Within ~30 seconds after hang-up:

1. The meeting appears on the **Meetings** page with status `ready`.
2. If auto-brief is on, a brief is drafted and posted to Slack.
3. You approve, redirect, or pause — same flow as upload.

## Cost

Voice runs through two paid services:

- **Twilio.** ~$0.014/min in the US; varies by country.
- **Gemini Live.** Counts against your Gemini quota. A 30-minute call
  is well within the free tier.

See [Cost caps](/byok/cost-caps/) to put a ceiling on total monthly
spend.

## Security

- The phone number is **public** — anyone who has it can dial in. If
  that's unacceptable, set an **allowlist** of caller numbers in the
  dashboard (**Settings → Voice → Allowlist**). Calls from other
  numbers get a polite "we don't recognize this number" prompt and
  hang up.
- Recordings are **not** stored by default. Twilio's media stream
  passes through your infra; nothing is persisted to disk. Flip
  `RETAIN_CALL_AUDIO=1` if you want it for QA.
- The Gemini Live transcript is stored in your Postgres like any
  other transcript.

## Limitations

- **English-only** today. Gemini Live supports more languages; we
  haven't tested the full matrix.
- **No participant attribution.** If two people are on the call, the
  transcript doesn't label who said what. If attribution matters,
  use a recording app that captures speaker diarization and upload.
- **Background noise** hurts quality. A speakerphone in a café is
  rough; a headset in a quiet room is flawless.

## Troubleshooting

| Symptom                               | Fix                                                 |
| ------------------------------------- | --------------------------------------------------- |
| Call rings, no greeting              | Twilio webhook URL wrong or unreachable.            |
| Greeting plays, then silence         | Gemini key invalid or rate-limited; check backend logs. |
| Call connects but no transcript      | Media Stream URL isn't reachable from Twilio — check firewall. |
| Multiple briefs generated per call   | Auto-brief is on; and the 60-min stitching didn't match — report it. |

For everything else, backend logs grep `voice:` for the right
context.
