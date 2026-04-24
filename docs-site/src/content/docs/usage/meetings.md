---
title: Uploading meetings
description: How the exec gets a meeting into Workforce0 — upload a recording, paste a transcript, or dial in by phone.
---

:::note[Audience]
Exec / consumer. This is the one place you'll need the web UI.
:::

## Three ways in

Workforce0 accepts meetings three ways. Pick based on what you have:

| You have…                          | Use this                          |
| ---------------------------------- | --------------------------------- |
| An audio file (Zoom recording, mp3) | **Upload a recording**           |
| A text transcript (Otter, Fireflies) | **Paste a transcript**          |
| A live phone call to capture       | **Dial in** — see [Voice dial-in](/usage/voice/) |

All three end up in the same place: a **Meeting** object with a
transcript attached, ready for the chief of staff to draft a brief.

## Upload a recording

1. **Meetings** → **Upload recording**.
2. Drop the file. Supported: `mp3`, `m4a`, `webm`, `wav`, `ogg`,
   `flac`. Max 500 MB.
3. Pick the **project** this meeting belongs to (scope matters — see
   [Projects & goals](/usage/projects/)).
4. Optional but useful: add a **title** and a one-line **context**
   ("Quarterly review with design team"). The chief-of-staff uses
   this in the brief.
5. Click **Upload & transcribe**.

Whisper transcribes in the background. A 1-hour recording takes
~90 seconds on a modest server. You'll see a status badge move from
`uploading` → `transcribing` → `ready`. You don't need to wait — the
UI will notify you when the transcript is ready.

### Domain-aware transcription

If you've built the project graph (see [Project Graph](/features/project-graph/)),
Workforce0 uses a **domain-aware prompt** during transcription. This
means Whisper knows about your codebase's class names, role names, and
recurring nouns — so "BAAgentService" doesn't come back as "BA agent
service" or "be agent service." The transcription quality difference
on technical meetings is significant.

## Paste a transcript

If you already have a transcript from Otter, Fireflies, Read, Fathom,
or a manual notetaker:

1. **Meetings** → **Paste transcript**.
2. Paste the text. Plain text, Markdown, or speaker-labeled formats
   all work — Workforce0 normalizes them.
3. Pick the project.
4. Click **Create meeting**.

Pasted transcripts skip the transcription step entirely. The chief-of-staff
picks up immediately.

### Speaker labels help

If your transcript has speaker labels (`Alex: …`, `Jamie: …`), the
chief-of-staff attributes decisions and action items correctly. Without
labels it still works but loses that attribution.

## Dial in

Give your meeting attendees a **phone number**. They call it, have
the meeting, hang up — a transcript and brief land in Slack.

See [Voice dial-in](/usage/voice/) for the full setup. Gets you the
lowest-friction capture: no recording, no transcript, no upload.

## After upload: what happens next

For every new meeting:

1. The meeting becomes visible on the **Meetings** page.
2. The transcript is stored and indexed.
3. You (or anyone with approval rights) can **Generate brief** from
   it.
4. If the installer has turned on **auto-brief**, step 3 happens
   automatically the moment the transcript is ready.

The brief is then posted to your comms channel for review — see
[Approvals in Slack](/usage/approvals/).

## Privacy

- The recording file is deleted after transcription **by default** —
  configurable via the installer-side `RETAIN_RECORDINGS` env var
  (see [Environment variables](/reference/env-vars/)).
- Transcripts stay in your Postgres. They never leave your infra.
- If you use Whisper through OpenAI's hosted API, the audio file
  transits OpenAI once during transcription — if that's unacceptable,
  the installer can configure a self-hosted Whisper instead.

## Editing or deleting a meeting

- **Edit title / context** — in place on the meeting detail page.
- **Correct the transcript** — click **Edit transcript**; changes
  are versioned so a bad edit is undoable.
- **Delete** — scoped by role. Deletes the meeting + transcript; does
  NOT retroactively pull briefs that were already generated.

## What not to do

- Don't paste personal / non-work conversations in. Workforce0 will
  dutifully draft a brief for your recipe idea; the AI quota cost is
  yours to own.
- Don't re-upload the same recording if transcription is still in
  progress — it'll queue a duplicate.
- If a meeting's context is extremely sensitive (legal, exec
  compensation), ask your installer whether to route it to a dedicated
  locally-hosted model — see [Local models (Ollama)](/byok/local-ollama/).
