---
title: Voice & meetings
description: Three capture paths — dial-in, upload, paste. One unified Meeting object downstream.
---

## Capture paths

1. **Phone dial-in** — Twilio + Gemini Live. Real-time
   speech-to-text, zero upload. See [Voice dial-in](/usage/voice/).
2. **File upload** — mp3 / m4a / webm. Whisper transcribes. See
   [Uploading meetings](/usage/meetings/).
3. **Paste transcript** — skip transcription. Fastest path.

All three produce a `Meeting` row with a `Transcript`. Downstream
is identical.

## Transcription

### Whisper (default)

- **Cloud**: OpenAI's `whisper-1` model. Requires `OPENAI_API_KEY`.
- **Self-hosted**: any Whisper-compatible endpoint via
  `WHISPER_BASE_URL=http://host:9000`. Run `whisper.cpp` or
  Faster-Whisper.

### Domain-aware prompting

Before transcription, we build a **domain prompt** from:

- The active project's name.
- Top-20 god-nodes from the project graph (technical terms, class
  names).
- Frequently-referenced nouns from previous transcripts in the same
  project.

This prompt is passed as the `prompt` field to Whisper. The
difference on technical meetings is significant — "BAAgentService"
stops coming back as "be agent service."

See `backend/src/services/transcription/domain-prompt.ts`.

### Gemini Live (voice dial-in only)

For real-time dial-in, we use Gemini Live which streams audio in and
emits text + semantic events. Lower latency than Whisper;
transcription quality is comparable for conversational speech.

## The Meeting object

Stored in Postgres:

- `id` — stable.
- `tenantId`, `projectId` — scope.
- `title` — inferred from filename / Meet calendar / user input.
- `source` — `upload | voice | paste`.
- `duration` — seconds; null for paste.
- `transcript` — full text.
- `speakers` — if parseable from source.
- `status` — `uploading | transcribing | ready | failed`.
- `audioUrl` — optional; only when `RETAIN_RECORDINGS=1`.

## Lifecycle

```
[source]
   │
   ▼
Meeting.status = transcribing
   │
   ▼  (Whisper / Gemini Live)
Transcript persisted
   │
   ▼
Meeting.status = ready
   │
   ▼  (if FEATURE_AUTO_BRIEF=1)
Brief drafting kicked off
```

## Editing a transcript

Transcripts are versioned (`Transcript.version`). Edits produce a
new version; old versions are retained for audit. The chief-of-staff
uses the latest version on next brief draft.

## Privacy flags

| Flag                     | Default | Effect                                |
| ------------------------ | ------- | ------------------------------------- |
| `RETAIN_RECORDINGS`      | `0`     | Keep raw audio after transcription.   |
| `RETAIN_CALL_AUDIO`      | `0`     | Keep Twilio call audio (post-stream).  |
| `WHISPER_BASE_URL`       | unset   | Use local Whisper endpoint.            |
| `VOICE_CONSENT_GREETING` | `1`     | Prepend a recording-consent notice.    |

## Limitations

- No speaker diarization on phone dial-in (Gemini Live limitation).
- No real-time transcript visible during a call (UI polls every 5s).
- Single-language per meeting; no auto-language-detect.

## Typical latency

| Path            | End-to-end | Notes |
| --------------- | ---------- | ----- |
| Paste           | <100 ms    | Just a DB insert. |
| Upload 10-min   | ~30 s      | Whisper inference + Drive download if relevant. |
| Upload 1-hour   | ~90 s      | Linear-ish in audio length. |
| Voice dial-in   | transcript ready within 5 s of hangup | Live streaming means text is ready when the call ends. |
