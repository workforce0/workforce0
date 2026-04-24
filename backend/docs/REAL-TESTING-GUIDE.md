# Real Recall.ai Testing Guide

## Prerequisites

1. **Recall.ai Account** - Sign up at https://recall.ai
2. **ngrok** - For exposing local server to the internet
3. **Running Server** - `npm run dev` in the mvp directory

---

## Step 1: Configure Environment Variables

Add to `mvp/.env`:

```bash
# Recall.ai API key (from dashboard)
RECALL_API_KEY=your_api_key_here

# Webhook secret (from dashboard)
RECALL_WEBHOOK_SECRET=your_webhook_secret_here
```

---

## Step 2: Start the Server

```bash
cd mvp
npm run dev
```

Wait for: `Server listening at http://127.0.0.1:3000`

---

## Step 3: Start ngrok

In a new terminal:

```bash
ngrok http 3000
```

Note your ngrok URL (e.g., `https://abc123.ngrok-free.app`)

---

## Step 4: Configure Webhook in Recall.ai Dashboard

1. Go to https://recall.ai/login
2. Select your region (e.g., US West 2)
3. Navigate to **Webhooks** in the sidebar
4. Click **Add Endpoint**
5. Configure:
   - **Endpoint URL:** `https://YOUR-NGROK-URL/webhooks/recall`
   - **Events:** Select these categories:
     - `bot.*` (all bot status events)
     - `transcript.*` (all transcript events)
6. Click **Create**

---

## Step 5: Schedule a Bot

### Option A: PowerShell Script

```powershell
cd e:\CodeSpace\Workforce0\mvp
.\tests\schedule-real-bot.ps1 -MeetingUrl "https://meet.google.com/xxx-xxxx-xxx"
```

### Option B: Direct API Call

```bash
curl -X POST http://localhost:3000/api/meetings \
  -H "Authorization: Bearer dev-api-key" \
  -H "X-Tenant-ID: test-tenant" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Meeting",
    "meetingUrl": "https://meet.google.com/xxx-xxxx-xxx"
  }'
```

### Option C: Recall.ai Dashboard

1. Go to **Bot Setup** > **Google Meet** (or your platform)
2. Enter your meeting URL
3. Click **Create Bot**

---

## Step 6: Monitor the Meeting

### Server Logs
Watch your terminal for:
- `Received Recall webhook` - Incoming events
- `Updating meeting status` - Status changes
- `Storing transcription chunk` - Real-time transcription
- `Meeting completed` - End of meeting trigger

### Database
```bash
npm run db:studio
```

Check:
- **Meeting** table - Status should update (joining → in_call → completed)
- **Meeting.metadata** - `transcriptChunks` array with real-time transcription
- **AgentTask** table - BA Agent task queued after meeting ends
- **PRD** table - Generated PRD after processing

---

## Webhook Events Flow

```
Bot Scheduled
    ↓
bot.joining_call → Meeting status: "joining"
    ↓
bot.in_call_recording → Meeting status: "in_call"
    ↓
[Real-time transcription chunks stored in metadata]
    ↓
bot.call_ended → Meeting status: "completed"
    ↓
transcript.done → Fetch full transcript
    ↓
BA Agent queued → PRD generation starts
    ↓
PRD created → Stored in database + Google Docs (if configured)
```

---

## Troubleshooting

### "Meeting not found" error
- Ensure the bot was scheduled through your API (creates meeting record with `externalId`)
- Check that `externalId` matches the `bot_id` in webhook payloads

### Webhooks not arriving
- Verify ngrok is running and URL matches dashboard configuration
- Check Recall.ai dashboard **Webhooks > Logs** for delivery attempts
- Ensure events are selected (bot.*, transcript.*)

### Bot won't join meeting
- Verify meeting URL is valid and active
- Check Recall.ai dashboard for bot status
- Some meetings require specific permissions (e.g., Teams meetings)

### Transcription not stored
- Real-time chunks stored in `meeting.metadata.transcriptChunks`
- Full transcript requires `transcript.done` webhook event
- Check server logs for any transcription errors

---

## Test Scripts

| Script | Purpose |
|--------|---------|
| `tests/schedule-real-bot.ps1` | Schedule a real Recall.ai bot |
| `tests/manual-webhook-test.ps1` | Simulate webhook events locally |
| `tests/test-webhook-flow.ts` | Automated integration test |

---

---

## Webhook Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /webhooks/recall` | Recall.ai bot events (status changes, transcription) |
| `POST /webhooks/gchat` | Google Chat clarification responses |
| `GET /webhooks/gchat/health` | Google Chat webhook health check |
| `POST /webhooks/jira` | Jira issue events |
| `GET /webhooks/health` | General webhook health check |

---

## Session Info (January 26, 2026)

- **Recall Region:** US West 2
- **Webhook URL:** `https://046d7598d922.ngrok-free.app/webhooks/recall`
- **Google Chat URL:** `https://046d7598d922.ngrok-free.app/webhooks/gchat`
- **Events Configured:** 13 (bot.* + transcript.*)
