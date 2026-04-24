# Manual Webhook Testing Guide

## Quick Start

### Step 1: Start the Server
```bash
cd mvp
npm run dev
```

Wait for: `✅ Queue workers started` and `Server listening at http://127.0.0.1:3000`

### Step 2: Create a Test Meeting

First, we need a meeting record in the database that the webhooks can reference.

**Using Prisma Studio (easiest):**
```bash
npm run db:studio
```
Then manually create a meeting with:
- tenantId: `test-tenant-manual`
- title: `Manual Test Meeting`
- meetingUrl: `https://meet.google.com/test`
- externalId: `test-bot-123` (this is the bot_id for webhooks)
- status: `scheduled`

**Or use the test script:**
```bash
npx tsx tests/test-e2e-flow.ts
```
This creates a complete test meeting automatically.

### Step 3: Send Webhook Events

Copy-paste these curl commands one at a time:

```bash
# 1. Bot joining
curl -X POST http://localhost:3000/webhooks/recall \
  -H "Content-Type: application/json" \
  -d '{"event":"bot.status_change","timestamp":"2026-01-26T12:00:00Z","data":{"bot_id":"test-bot-123","status":"joining"}}'

# 2. Bot in call
curl -X POST http://localhost:3000/webhooks/recall \
  -H "Content-Type: application/json" \
  -d '{"event":"bot.status_change","timestamp":"2026-01-26T12:01:00Z","data":{"bot_id":"test-bot-123","status":"in_call"}}'

# 3. Transcription chunk
curl -X POST http://localhost:3000/webhooks/recall \
  -H "Content-Type: application/json" \
  -d '{"event":"bot.transcription","timestamp":"2026-01-26T12:02:00Z","data":{"bot_id":"test-bot-123","transcription":{"text":"Hello everyone, lets discuss the feature","speaker":"Sarah PM","start_time":0,"end_time":5,"confidence":0.95}}}'

# 4. Another transcription chunk
curl -X POST http://localhost:3000/webhooks/recall \
  -H "Content-Type: application/json" \
  -d '{"event":"bot.transcription","timestamp":"2026-01-26T12:02:05Z","data":{"bot_id":"test-bot-123","transcription":{"text":"We need OAuth integration with Google","speaker":"Mike Tech Lead","start_time":5,"end_time":10,"confidence":0.92}}}'

# 5. Meeting done (triggers transcript storage + BA Agent)
curl -X POST http://localhost:3000/webhooks/recall \
  -H "Content-Type: application/json" \
  -d '{"event":"bot.status_change","timestamp":"2026-01-26T12:10:00Z","data":{"bot_id":"test-bot-123","status":"done"}}'
```

### Step 4: Verify Results

**Check the server logs** for:
- `Updating meeting status` messages
- `Storing transcription chunk` messages
- `Meeting completed` trigger

**Check the database:**
```bash
npm run db:studio
```

Look for:
1. **Meeting table**: Status should be `completed`
2. **Meeting.metadata**: Should have `transcriptChunks` array
3. **AgentTask table**: Should have a `ba_agent` task (if transcript fetched)

---

## Option 2: Run Automated Test

```bash
# PowerShell (Windows)
.\tests\manual-webhook-test.ps1

# Bash (Linux/Mac/WSL)
bash tests/manual-webhook-test.sh
```

---

## Option 3: Full Automated Test

```bash
# Runs against running server
npx tsx tests/test-webhook-flow.ts
```

This test:
1. Creates a meeting with bot ID
2. Sends all webhook events
3. Verifies status updates
4. Verifies transcription chunks stored
5. Tests Google Chat webhook

---

## Testing Google Chat Webhook

To test clarification responses:

```bash
curl -X POST http://localhost:3000/api/webhooks/gchat \
  -H "Content-Type: application/json" \
  -d '{
    "type": "MESSAGE",
    "message": {
      "text": "Q1: Use OAuth2\nQ2: Launch in Q2",
      "thread": {"threadKey": "prd-clarify-some-prd-id"},
      "sender": {"displayName": "John", "email": "john@example.com"}
    }
  }'
```

---

## Real Recall.ai Testing

For actual meeting bot testing:

1. **Sign up** at https://recall.ai
2. **Add to .env:**
   ```
   RECALL_API_KEY=your_api_key
   RECALL_WEBHOOK_SECRET=your_webhook_secret
   ```
3. **Expose your server** using ngrok:
   ```bash
   ngrok http 3000
   ```
4. **Configure webhook URL** in Recall.ai dashboard
5. **Schedule a bot** via API or dashboard
6. **Join the meeting** - bot will join and transcribe!

---

## Troubleshooting

### "Meeting not found" error
- Make sure the `externalId` in the meeting matches the `bot_id` in webhooks

### Transcription chunks not stored
- Check server logs for errors
- Verify MeetingService is initialized (needs RECALL_API_KEY)

### BA Agent task not queued
- Requires real Recall.ai API to fetch final transcript
- Or the stored chunks can be used as fallback (future enhancement)
