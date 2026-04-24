# Google Chat Integration Setup Guide

## Overview

This guide explains how to set up Google Chat integration for Workforce0. The integration enables:

1. **Notifications**: Receive alerts when PRDs are generated
2. **Clarification Loop**: Answer AI questions directly in chat
3. **Status Updates**: Get meeting transcription progress updates

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    GOOGLE CHAT INTEGRATION                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐                      ┌─────────────────┐           │
│  │   Workforce0    │    Outgoing Webhook  │  Google Chat    │           │
│  │   Backend       │ ──────────────────>  │  Space          │           │
│  │                 │    (Notifications)   │                 │           │
│  │                 │                      │                 │           │
│  │                 │    Incoming Webhook  │                 │           │
│  │                 │ <──────────────────  │                 │           │
│  │                 │    (User Replies)    │                 │           │
│  └─────────────────┘                      └─────────────────┘           │
│                                                                          │
│  Two webhooks needed:                                                   │
│  1. OUTGOING: Workforce0 → Google Chat (simple webhook URL)             │
│  2. INCOMING: Google Chat → Workforce0 (Chat App/Bot)                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Option A: Simple Setup (Notifications Only)

Use this if you only need one-way notifications (no clarification responses).

### Step 1: Create a Google Chat Space

1. Open [Google Chat](https://chat.google.com)
2. Click the **+** next to "Spaces" in the left sidebar
3. Select **Create space**
4. Configure the space:
   - **Name**: "Workforce0 Notifications" (or your preferred name)
   - **Description**: "Notifications from Workforce0 AI"
   - **Access**: Choose who can access (your team)
5. Click **Create**

### Step 2: Get Webhook URL

1. In the space you created, click the **dropdown arrow** next to the space name
2. Select **Apps & integrations**
3. Click **Manage webhooks**
4. Click **Add webhook**
5. Configure:
   - **Name**: "Workforce0"
   - **Avatar URL** (optional): Your company logo URL
6. Click **Save**
7. **Copy the webhook URL** - it looks like:
   ```
   https://chat.googleapis.com/v1/spaces/SPACE_ID/messages?key=KEY&token=TOKEN
   ```

### Step 3: Configure Workforce0

Add the webhook URL to your `.env` file:

```bash
GCHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/SPACE_ID/messages?key=KEY&token=TOKEN
```

Or configure via the Workforce0 UI:
1. Go to **Settings** → **Integrations**
2. Find **Google Chat**
3. Paste the webhook URL
4. Click **Test Connection** to verify
5. Click **Save**

---

## Option B: Full Setup (Two-Way Communication)

Use this for the complete clarification loop with user responses.

### Prerequisites

- Google Workspace account with admin access
- Google Cloud Project
- Public HTTPS endpoint for your Workforce0 server

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click **Select a project** → **New Project**
3. Configure:
   - **Project name**: "workforce0-chat"
   - **Organization**: Your organization
4. Click **Create**

### Step 2: Enable Google Chat API

1. In your project, go to **APIs & Services** → **Library**
2. Search for "Google Chat API"
3. Click **Google Chat API**
4. Click **Enable**

### Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **Internal** (for your organization) or **External**
3. Fill in required fields:
   - **App name**: "Workforce0"
   - **User support email**: your email
   - **Developer contact**: your email
4. Click **Save and Continue**
5. Skip **Scopes** (click **Save and Continue**)
6. Click **Back to Dashboard**

### Step 4: Create Chat App Configuration

1. Go to **APIs & Services** → **Enabled APIs**
2. Click **Google Chat API**
3. Click **Configuration** tab
4. Fill in the configuration:

   **App name**: Workforce0 BA Agent

   **Avatar URL**: https://your-domain.com/images/workforce0-avatar.png

   **Description**: AI Business Analyst that generates PRDs from meetings and asks clarifying questions.

   **Interactive features**:
   - [x] Enable interactive features
   - [x] Receive 1:1 messages
   - [x] Join spaces and group conversations

   **Connection settings**:
   - Select **HTTP endpoint URL**
   - Enter your webhook URL:
     ```
     https://your-workforce0-domain.com/api/webhooks/gchat
     ```

   **Visibility**:
   - Select **Make this Chat app available to specific people and groups**
   - Add your team members or Google Groups

5. Click **Save**

### Step 5: Configure Workforce0 Webhook Endpoint

Ensure your Workforce0 server is configured to receive webhooks:

```bash
# .env configuration
# Outgoing webhook (for sending messages)
GCHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/SPACE_ID/messages?key=KEY&token=TOKEN

# Incoming webhook verification (optional, for security)
GCHAT_WEBHOOK_VERIFY_TOKEN=your-secret-verification-token
```

### Step 6: Add Bot to Space

1. Open [Google Chat](https://chat.google.com)
2. Create a new space or open an existing one
3. Click the **+** in the compose area
4. Select **Apps**
5. Search for "Workforce0"
6. Click **Add to space**
7. The bot will send a welcome message confirming it's active

### Step 7: Test the Integration

**Test outgoing (Workforce0 → Chat):**
```bash
cd mvp
npm run test:gchat
```

**Test incoming (Chat → Workforce0):**
1. In the Chat space, type: `@Workforce0 help`
2. The bot should respond with help information

---

## Webhook Endpoint Reference

### Endpoint URL

```
POST https://your-domain.com/api/webhooks/gchat
```

### Request Format (from Google Chat)

```json
{
  "type": "MESSAGE",
  "eventTime": "2024-01-15T10:30:00.000Z",
  "message": {
    "name": "spaces/SPACE_ID/messages/MESSAGE_ID",
    "text": "Q1: Use OAuth2 with JWT tokens",
    "thread": {
      "name": "spaces/SPACE_ID/threads/THREAD_ID",
      "threadKey": "prd-clarify-abc123"
    },
    "sender": {
      "name": "users/USER_ID",
      "displayName": "John Smith",
      "email": "john@company.com",
      "type": "HUMAN"
    }
  }
}
```

### Response Format

```json
{
  "text": "✅ Received your answer!"
}
```

Or for card messages:
```json
{
  "cards": [{
    "header": { "title": "Response Received" },
    "sections": [...]
  }]
}
```

---

## Message Formats

### Clarification Request (Workforce0 → Chat)

When the AI needs clarification:

```
╔═══════════════════════════════════════════════════════════╗
║  🔔 Clarification Needed: User Authentication Feature     ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  Questions Requiring Your Input                           ║
║  ─────────────────────────────                            ║
║  Q1. Which authentication method should we use?           ║
║                                                           ║
║  Q2. What is the target response time for auth requests?  ║
║                                                           ║
║  ─────────────────────────────                            ║
║  How to Respond                                           ║
║  Reply to this thread with your answers:                  ║
║                                                           ║
║  Format: "Q1: [your answer]"                              ║
║  Example: "Q1: Use OAuth2 with JWT tokens"                ║
║                                                           ║
║  AI Confidence: [MEDIUM] 75%                              ║
║                                                           ║
║  [View Document]  [View PRD]                              ║
╚═══════════════════════════════════════════════════════════╝
```

### User Response Format

Users reply in the thread:

```
Q1: Use OAuth2 with JWT tokens. Support Google and Microsoft SSO.
```

Or multiple answers:
```
Q1: Use OAuth2 with JWT tokens
Q2: Target 200ms for 95th percentile response time
```

### Acknowledgment (Workforce0 → Chat)

After receiving answers:

```
✅ Received 2 answer(s):
• Q1: "Use OAuth2 with JWT tokens"
• Q2: "Target 200ms for 95th percentile..."

🎉 All questions answered! Regenerating PRD...
```

---

## Security Considerations

### Webhook Verification

Google Chat sends a verification token with each request. Verify it:

```typescript
// In your webhook handler
const verificationToken = process.env.GCHAT_WEBHOOK_VERIFY_TOKEN;
const receivedToken = request.headers['authorization'];

if (verificationToken && receivedToken !== `Bearer ${verificationToken}`) {
  return reply.status(401).send({ error: 'Unauthorized' });
}
```

### IP Allowlisting

Google Chat webhooks come from these IP ranges:
- `64.233.160.0/19`
- `66.102.0.0/20`
- `66.249.80.0/20`
- `72.14.192.0/18`
- `74.125.0.0/16`
- `108.177.8.0/21`
- `173.194.0.0/16`
- `209.85.128.0/17`
- `216.239.32.0/19`

### Rate Limiting

Implement rate limiting on your webhook endpoint:
- Max 60 requests per minute per space
- Max 600 requests per minute total

---

## Troubleshooting

### "App not found" when adding to space

1. Verify the Chat App is published
2. Check visibility settings allow your user/group
3. Wait a few minutes for propagation

### Messages not being received

1. Check webhook URL is correct and HTTPS
2. Verify endpoint returns 200 OK
3. Check server logs for errors
4. Ensure firewall allows Google IPs

### "Unauthorized" errors

1. Verify GCHAT_WEBHOOK_VERIFY_TOKEN matches configuration
2. Check Authorization header is being passed
3. Review Google Cloud Console for API errors

### Bot not responding

1. Check bot is added to the space
2. Verify @mention is being used
3. Review Workforce0 server logs
4. Test webhook endpoint health: `/api/webhooks/gchat/health`

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `GCHAT_WEBHOOK_URL` | Yes | Outgoing webhook URL for sending messages |
| `GCHAT_WEBHOOK_VERIFY_TOKEN` | No | Token for verifying incoming webhooks |
| `GCHAT_DEFAULT_THREAD_KEY` | No | Default thread key for grouping messages |

---

## UI Integration Points

For building the setup UI in Workforce0:

### Connection Wizard Steps

1. **Choose Mode**
   - Simple (notifications only)
   - Full (two-way communication)

2. **Simple Mode**
   - Input: Webhook URL
   - Action: Test connection
   - Feedback: Success/error message

3. **Full Mode**
   - Guide to Google Cloud Console
   - Input: Project ID
   - Input: Chat App endpoint URL (auto-generated)
   - Guide to add bot to space
   - Action: Test two-way communication

### API Endpoints for UI

```
POST /api/settings/integrations/gchat/test
{
  "webhookUrl": "https://chat.googleapis.com/..."
}

Response:
{
  "success": true,
  "message": "Test message sent successfully"
}
```

```
GET /api/settings/integrations/gchat/status
Response:
{
  "enabled": true,
  "mode": "full",
  "lastMessageAt": "2024-01-15T10:30:00Z",
  "spacesConnected": 2
}
```

---

## Code References

- Service implementation: [gchat.service.ts](../src/services/integrations/gchat.service.ts)
- Webhook handler: [gchat-webhook.handler.ts](../src/routes/webhooks/gchat-webhook.handler.ts)
- Clarification loop: [clarification-loop.md](./clarification-loop.md)
