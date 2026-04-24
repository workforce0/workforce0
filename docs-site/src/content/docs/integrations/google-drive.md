---
title: Google Drive
description: Auto-import meeting recordings from Google Meet.
---

## What it does

When you record a Google Meet, the recording lands in Drive. The
Drive integration watches a folder, auto-imports new recordings,
runs transcription, and kicks off the brief flow.

No manual upload.

## Setup

1. **Google Cloud side**
   - Create a GCP project (or use an existing one).
   - Enable the **Drive API**.
   - Create an **OAuth 2.0 client** (web application type).
   - Add `https://your-workforce0/auth/google/callback` to
     authorized redirect URIs.
   - Copy the client ID + client secret.

2. **Workforce0 side**
   - **Integrations → Google Drive → Connect**.
   - Paste client ID, client secret.
   - Click **Authorize with Google** — you'll consent to Drive
     access for the authenticating account.

## Watched folder

After connecting:

- By default, watches "**My Drive → Meet Recordings**" (Google Meet's
  standard output location).
- Change via **Integrations → Google Drive → Folder**. Any folder
  you own (or have write access to) works.

## Push notifications

We use Drive's push channel subscription (`files.watch`). Updates
to the folder trigger a webhook on Workforce0 within seconds. No
polling needed.

Channels expire after 7 days. Workforce0 auto-renews 24 hours before
expiry. If renewal fails (revoked scope, expired token), the admin
dashboard shows a **Drive: reconnect** banner.

## Auto-transcription flow

When a new recording lands:

1. Drive webhook fires.
2. Workforce0 downloads the file (streaming; no full-file copy).
3. Whisper transcribes.
4. A **Meeting** object is created with the transcript.
5. If auto-brief is enabled (see `FEATURE_AUTO_BRIEF`), the brief
   posts to the connected comms channel.

Elapsed time from meeting end → Slack message: ~2 minutes for a
30-minute meeting.

## Metadata inference

From the recording filename Workforce0 tries to infer:

- **Meeting title** — usually contains the meeting name.
- **Project** — matched against existing project names in the
  workspace.
- **Participants** — from the Meet attendance logs if the Drive account
  is the meeting host.

Manual correction is always possible on the meeting detail page.

## Privacy

- Files are **streamed**, not persisted to Workforce0 disk (unless
  `RETAIN_RECORDINGS=1`).
- Google sees that we accessed the file (visible in Drive's activity
  log).
- Transcripts live in your Postgres. Drive never sees transcripts.

## Revoking access

**Integrations → Google Drive → Disconnect.** We revoke the OAuth
token via the Google revoke endpoint. The watched folder's push
channel is torn down.

## Troubleshooting

| Symptom                             | Fix                                                 |
| ----------------------------------- | --------------------------------------------------- |
| "Reconnect" banner keeps appearing | Push channel renewal failing — re-authorize.        |
| Recordings not picked up            | Recording wasn't saved to the watched folder.        |
| Transcription fails with 403        | File is restricted; OAuth account doesn't have access.|
| Duplicate meetings                  | Drive fired two webhooks; de-duplication failed —   |
|                                     | safe to delete the duplicate. File bug.              |
