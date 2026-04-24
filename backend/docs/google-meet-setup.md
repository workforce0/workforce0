# Google Meet Integration Setup Guide

## Overview

Auto-pull Meet transcripts and recordings into Workforce0 as soon as a meeting ends. This is the heart of Workforce0's value loop: your meetings become structured briefs, action items, and PRDs without you lifting a finger.

You have two ways to get Meet transcripts in — one fully automatic, one fully manual. Pick whichever fits your setup today; you can switch later.

---

## What you'll need

- A **Google Workspace account** on the **Business Standard** plan or higher
  - Meet transcription is a paid-plan feature. Personal `@gmail.com` accounts don't have it.
  - If you're on Business Starter, you'll need to upgrade or use Mode B (manual upload).
- **Admin access** to your Google Workspace (only for the first-time setup in Step 1)
  - If you're not the admin, forward Step 1 to whoever manages your company's Google account.
- About **10 minutes** for the first-time setup. After that, it's hands-off.

---

## Two modes — pick one

### Mode A: Drive watcher (recommended — zero friction)

Workforce0 watches your **"Meet Recordings"** folder in Google Drive. The moment Google drops a new transcript there (usually 2-5 minutes after the meeting ends), Workforce0 picks it up and starts processing.

- **Setup time:** 10 minutes, once
- **Ongoing effort:** zero — meetings just show up in Workforce0
- **Requires:** the [Google Drive integration](./google-drive-setup.md) already connected

### Mode B: Manual upload (no setup)

After each meeting, you download the transcript from Google Calendar and drop it into Workforce0. Works on any plan, no admin access needed.

- **Setup time:** zero
- **Ongoing effort:** ~30 seconds per meeting
- **How:** open the Meet event in Google Calendar → **Attachments** → download the `.vtt` transcript → in Workforce0, go to **Meetings → Upload** and drop the file in

Most people start with Mode B to try it, then switch to Mode A once they're hooked.

---

## Step 1: Turn on Meet recording and transcripts in Workspace admin

Your org may already have this on. If you're not sure, do this step anyway — it's harmless.

1. Sign in as a Workspace admin and open the Meet admin settings page:
   [https://admin.google.com/ac/appsettings/meet](https://admin.google.com/ac/appsettings/meet)
2. Click **Recording**.
3. Set **"Let people record their meetings"** to **On**.
4. Click **Save**.
5. Go back one page and click **Transcription** (right below Recording).
6. Set **"Let people transcribe their meetings"** to **On**.
7. Click **Save**.

**Heads up:** Google says these settings take **up to 24 hours** to propagate to every user in your org. In practice it's usually under an hour, but don't panic if the "Record" button is still missing in Meet right after you save.

Once this is on, anyone hosting a meeting will see a **Record** and **Transcribe** option in Meet's three-dot menu.

---

## Step 2: Connect Google Drive (Mode A only)

Skip this step if you're using Mode B.

Workforce0 reads transcripts out of your Drive. Follow the Drive setup first, then come back:

**[Google Drive Setup Guide](./google-drive-setup.md)**

When you finish, you should see **Google Drive: Connected** on the Workforce0 Integrations page.

---

## Step 3: Set "Meet Recordings" as the watched folder

When Google Meet saves a recording, it drops it in a folder called **"Meet Recordings"** at the top level of the host's My Drive. Workforce0 needs to know to watch this folder.

1. In Workforce0, open **Settings → Integrations → Google Drive**.
2. Find the **Watched folder** dropdown.
3. Click it and pick **Meet Recordings**.
   - If you don't see it in the list, host and end a 1-minute test meeting first so Google creates the folder, then refresh.
4. Click **Save**.

You should now see **Watching: Meet Recordings** with a green dot.

---

## Step 4: Run a test meeting

Let's confirm end-to-end that a real meeting turns into a Workforce0 brief.

1. Open [Google Meet](https://meet.google.com) and start an **instant meeting**.
2. Click the **three-dot menu** (bottom right) → **Record meeting** → **Start recording**.
3. Click the menu again → **Turn on transcription** (or similar — the wording shifts between Workspace editions).
4. Talk for about a minute. Mention a fake action item, e.g., *"Let's ship the pricing page by Friday."*
5. Click **End call**.
6. Wait **2-5 minutes**. Google processes the recording and transcript in the background.
7. In Workforce0, open the **Meetings** page. Your test meeting should appear, with a brief generated underneath.

If it doesn't show up after 10 minutes, jump to **Troubleshooting** below.

---

## Troubleshooting

### "There's no transcript, only a recording"

The meeting was recorded with **transcription disabled**. Only the video/audio file landed in Drive. You have two options:
- Re-run the meeting with **Turn on transcription** enabled (Step 4, #3).
- Use Workforce0's audio transcription fallback — upload the `.mp4` directly via **Meetings → Upload**, and Workforce0 will transcribe it locally.

### "The recording never shows up in Drive"

- Check your org's **Drive retention policy** — some orgs auto-delete Meet recordings after N days or route them to a different folder.
- Confirm the meeting host is the one with the Drive integration connected. Recordings save to the **host's** Drive, not every participant's.
- Recordings can take up to **24 hours** to appear for meetings longer than an hour.

### "Workforce0 isn't picking up the new transcript"

- The Drive watcher polls every **60 seconds**. Refresh the Meetings page and wait a minute.
- Check **Settings → Integrations → Google Drive** — status must be **Connected**. If it says **Token expired**, click **Reconnect**.
- Make sure the watched folder is actually **Meet Recordings**, not a different folder with a similar name.

### "The speaker names are wrong"

Google Meet labels speakers by **who was invited on the calendar event**, not who actually spoke. If someone joins from a phone or a different account, they may show up as "Unknown" or get merged with another speaker.

Workforce0 tries to clean this up during processing — you can also manually fix speaker labels on the meeting detail page after the brief is generated.

### "I'm on Business Starter and don't have transcription"

Transcription is a Business Standard+ feature. Either:
- Ask your admin to upgrade (Google's lowest tier with transcription is ~$14/user/month).
- Use **Mode B (manual upload)** — it works on any plan, including free Gmail accounts, as long as you can get a transcript from somewhere (Otter, Fireflies, Fathom, etc. all export `.vtt` or `.srt`).

---

## What Workforce0 does with the transcript

Once a transcript lands in Workforce0:

1. **Clean** — speaker labels are normalized, filler words stripped, timestamps preserved.
2. **Chunk** — the transcript is split into context-sized pieces (~2000 tokens each).
3. **Analyze** — chunks are sent through the **AI Council** (multi-model consensus across Gemini, Claude, and GPT).
4. **Structure** — the output is assembled into a brief: summary, decisions, action items, open questions, and a draft PRD if the meeting warrants one.

End-to-end, this takes about **30 seconds** for a 30-minute meeting.

---

## Privacy

- Transcripts are stored **encrypted at rest** in your self-hosted Workforce0 database.
- AI analysis runs through **your own API keys** (BYOK — Bring Your Own Keys). Your transcripts never touch Workforce0's maintainers' servers.
- If you self-host on your own infrastructure (the default), nothing leaves your network except the calls you make to the AI providers you've configured.
- You can delete any meeting from the Workforce0 UI at any time — this removes the transcript, brief, and all derived artifacts.

---

## Revoking access

If you ever want to disconnect Workforce0 from Google:

1. Open [Google Account → Security → Third-party access](https://myaccount.google.com/permissions).
2. Find **Workforce0** in the list.
3. Click it → **Remove access**.

This immediately invalidates Workforce0's Drive token. Workforce0 will stop ingesting new meetings. Previously ingested meetings stay in Workforce0 until you delete them manually.

---

## Related guides

- [Google Drive Setup](./google-drive-setup.md) — required for Mode A
- [Google Chat Setup](./google-chat-setup.md) — get meeting briefs posted to a chat space
- [Clarification Loop](./clarification-loop.md) — how Workforce0 asks follow-up questions about a meeting
