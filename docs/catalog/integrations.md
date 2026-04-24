# Integrations Catalog

Every third-party connector Workforce0 ships with, where it lives in the code, what env vars it needs, and how users configure it.

> **TL;DR for users:** connect everything via **Settings → Integrations** in the app. Keys encrypt at rest. No `.env` editing after initial deploy.

## Index

| Integration | Purpose | Status | Primary file | UI wizard |
|---|---|---|---|---|
| [Jira](#jira) | Ticket creation from approved briefs | ✅ GA | `backend/src/services/integrations/jira.service.ts` | Settings → Integrations → Jira |
| [Slack](#slack) | Notifications + reply-to-approve | ✅ GA | `backend/src/services/communication/channels/slack.channel.ts` | Settings → Integrations → Slack |
| [GitHub](#github) | PR creation from approved briefs | ✅ GA | `backend/src/services/integrations/github.service.ts` | Settings → Integrations → GitHub |
| [Google Chat](#google-chat) | Brief updates to a Chat space | ✅ GA | `backend/src/services/integrations/gchat.service.ts` | Settings → Integrations → Google Chat |
| [Google Docs](#google-docs) | Approved briefs as Google Docs | ✅ GA | `backend/src/services/integrations/gdocs.service.ts` | Settings → Integrations → Google Docs |
| [Google Drive](#google-drive) | Auto-ingest Meet recordings from a watched folder | ✅ GA | `backend/src/routes/webhooks/google-drive.webhook.ts` | Settings → Integrations → Google Meet (OAuth) |
| [Google Meet](#google-meet) | Automatic transcript capture | ✅ GA | `backend/src/services/integrations/google-oauth.service.ts` | Settings → Integrations → Google Meet |
| [Twilio Voice](#twilio) | Dial-in voice bot | ✅ GA | `backend/src/services/voice/twilio-voice.service.ts` | Settings → Voice → Twilio |
| [SendGrid](#sendgrid-email) | Email notifications + digests | ✅ GA | `backend/src/services/communication/channels/email.channel.ts` | Settings → Integrations → Email |
| [Microsoft Teams](#microsoft-teams) | Outbound brief updates | ✅ GA | `backend/src/services/communication/channels/teams.channel.ts` | Settings → Integrations → Teams |
| [SMS / WhatsApp](#sms--whatsapp) | Outbound messages (via Twilio) | ✅ GA | `backend/src/services/communication/channels/{sms,whatsapp}.channel.ts` | Settings → Integrations → Twilio |
| [Linear](#linear) | Issue creation (alternative to Jira) | ✅ GA | `backend/src/services/integrations/linear.service.ts` | Settings → Integrations → Linear |
| [Notion](#notion) | Briefs as Notion pages | ✅ GA | `backend/src/services/integrations/notion.service.ts` | Settings → Integrations → Notion |
| [WorkOS SSO](#workos-sso) | Single sign-on (SAML/OIDC) | ✅ GA | `backend/src/services/auth/workos.service.ts` | Settings → Account → SSO |
| [Meeting storage](#meeting-storage) | Audio/video upload destination | ✅ GA | `backend/src/services/storage/` | Local filesystem by default; S3 opt-in |
| Asana | — | 🔵 Planned | — | — |
| Salesforce | — | 🔵 Planned | — | — |

Legend: ✅ GA (fully wired) · 🚧 Scaffolded (API routes exist, needs production polish) · 🔵 Planned (issue open)

---

## Jira

Creates tickets automatically from approved briefs. One ticket per requirement with priority, acceptance criteria, and an optional story-points field.

- **Service:** [`backend/src/services/integrations/jira.service.ts`](../../backend/src/services/integrations/jira.service.ts)
- **Setup doc:** [`backend/docs/jira-setup.md`](../../backend/docs/jira-setup.md)
- **Env vars** (optional — also configurable via UI):
  ```bash
  JIRA_BASE_URL=https://your-org.atlassian.net
  JIRA_EMAIL=you@company.com
  JIRA_API_TOKEN=...
  JIRA_DEFAULT_PROJECT=PROJ
  JIRA_STORY_POINTS_FIELD=customfield_10016   # optional
  JIRA_WEBHOOK_SECRET=...                     # optional, for inbound
  ```
- **Where tickets get created:** `POST /api/agents/prds/:id/tickets` in `backend/src/routes/agents.routes.ts`
- **Graceful degradation:** `JiraService.isConfigured()` returns false → UI shows "Not connected" and the route returns 400.

## Slack

Three surfaces:
1. **Outbound** — notifications, digests, approval requests (`slack.channel.ts`)
2. **Inbound approvals** — reply-to-approve via Slack Events API (`webhooks/slack-events.handler.ts`)
3. **Inbound agent dispatch** — `@ba`, `@dev`, `@qa`, `@architect`, `@supervisor`, `@help` in any Slack channel where the bot is installed route through `AgentDispatcherService` and reply in-thread. Tenant is resolved by matching the Slack user id against `TeamMember.channelIds.slack`.

- **Service:** [`backend/src/services/communication/channels/slack.channel.ts`](../../backend/src/services/communication/channels/slack.channel.ts)
- **Webhook handler:** [`backend/src/routes/webhooks/slack-events.handler.ts`](../../backend/src/routes/webhooks/slack-events.handler.ts)
- **Setup doc:** [`backend/docs/slack-setup.md`](../../backend/docs/slack-setup.md)
- **Env vars:**
  ```bash
  SLACK_BOT_TOKEN=xoxb-...
  SLACK_SIGNING_SECRET=...
  ```

## GitHub

Creates branches and pull requests from approved briefs. Used by the local **Dev Agent daemon** in `agent/` and also by the in-backend `GitHubService` for metadata lookups.

- **Service:** [`backend/src/services/integrations/github.service.ts`](../../backend/src/services/integrations/github.service.ts)
- **Setup doc:** [`backend/docs/github-setup.md`](../../backend/docs/github-setup.md)
- **Env vars:**
  ```bash
  GITHUB_TOKEN=ghp_...                # or a GitHub App installation token
  GITHUB_DEFAULT_OWNER=your-org
  GITHUB_DEFAULT_REPO=your-repo
  ```

## Google Chat

Posts brief status updates, approval requests, and daily digests to a Google Chat space via its incoming webhook URL.

- **Service:** [`backend/src/services/integrations/gchat.service.ts`](../../backend/src/services/integrations/gchat.service.ts)
- **Webhook handler (inbound):** [`backend/src/routes/webhooks/gchat-webhook.handler.ts`](../../backend/src/routes/webhooks/gchat-webhook.handler.ts)
- **Setup doc:** [`backend/docs/google-chat-setup.md`](../../backend/docs/google-chat-setup.md)
- **Env vars:**
  ```bash
  GCHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/...
  GCHAT_WEBHOOK_TOKEN=...   # optional bearer for inbound verification
  ```

## Google Docs

Saves approved briefs as Google Docs in a shared folder.

- **Service:** [`backend/src/services/integrations/gdocs.service.ts`](../../backend/src/services/integrations/gdocs.service.ts)
- **Setup doc:** [`backend/docs/google-docs-setup.md`](../../backend/docs/google-docs-setup.md)
- **Env vars:**
  ```bash
  GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'
  GOOGLE_DRIVE_FOLDER_ID=1Abc...
  ```

## Google Drive

Watches a Drive folder for new Meet recordings and auto-ingests them as meetings.

- **Webhook route:** [`backend/src/routes/webhooks/google-drive.webhook.ts`](../../backend/src/routes/webhooks/google-drive.webhook.ts)
- **Setup doc:** [`backend/docs/google-drive-setup.md`](../../backend/docs/google-drive-setup.md)
- Uses the same service account key as Google Docs.

## Google Meet

User-OAuth-based flow (one click, no service account). Detects new Meet recordings in the user's Drive and transcribes them.

- **Service:** [`backend/src/services/integrations/google-oauth.service.ts`](../../backend/src/services/integrations/google-oauth.service.ts)
- **Routes:** [`backend/src/routes/google-integration.routes.ts`](../../backend/src/routes/google-integration.routes.ts)
- **Setup doc:** [`backend/docs/google-meet-setup.md`](../../backend/docs/google-meet-setup.md)
- **Env vars:**
  ```bash
  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...
  GOOGLE_REDIRECT_URI=https://your-instance.com/api/integrations/google/callback
  ```

## Twilio

Dial-in voice bot — users call a Twilio number and talk to the AI product manager live via Gemini Live API + Twilio Media Streams.

- **Service:** [`backend/src/services/voice/twilio-voice.service.ts`](../../backend/src/services/voice/twilio-voice.service.ts)
- **Media handler:** [`backend/src/services/voice/twilio-media-handler.ts`](../../backend/src/services/voice/twilio-media-handler.ts)
- **Routes:** [`backend/src/routes/twilio.routes.ts`](../../backend/src/routes/twilio.routes.ts)
- **Setup doc:** [`backend/docs/twilio-voice-bot.md`](../../backend/docs/twilio-voice-bot.md)
- **Env vars:**
  ```bash
  TWILIO_ACCOUNT_SID=AC...
  TWILIO_AUTH_TOKEN=...
  TWILIO_PHONE_NUMBER=+1...
  ```

## SendGrid (Email)

Outbound email — notifications, daily digests, approval requests with reply-to-approve support.

- **Service:** [`backend/src/services/communication/channels/email.channel.ts`](../../backend/src/services/communication/channels/email.channel.ts)
- **Digest service:** [`backend/src/services/communication/email-digest.service.ts`](../../backend/src/services/communication/email-digest.service.ts)
- **Inbound reply handler:** [`backend/src/routes/webhooks/email-reply.handler.ts`](../../backend/src/routes/webhooks/email-reply.handler.ts)
- **Env vars:**
  ```bash
  SENDGRID_API_KEY=SG...
  EMAIL_FROM=notifications@yourcompany.com
  EMAIL_WEBHOOK_SECRET=...   # for the inbound reply route
  ```

## Microsoft Teams

Outbound brief updates and approval requests via incoming webhook.

- **Channel:** [`backend/src/services/communication/channels/teams.channel.ts`](../../backend/src/services/communication/channels/teams.channel.ts)
- **Env var:** `TEAMS_WEBHOOK_URL`

## SMS / WhatsApp

Both run through Twilio as SMS or WhatsApp Business API. Uses the same Twilio credentials as the voice bot.

### Outbound
- **Channels:** [`backend/src/services/communication/channels/sms.channel.ts`](../../backend/src/services/communication/channels/sms.channel.ts), [`whatsapp.channel.ts`](../../backend/src/services/communication/channels/whatsapp.channel.ts)

### Inbound — reply-to-approve
Replying `APPROVE <token>` / `A <token>` / `REJECT <token>` / `R <token> <reason>` to a WhatsApp (or SMS) message from Workforce0 applies the decision server-side and sends a confirmation back via TwiML. Same flow email already has; same token pool (`approval-token:<12 hex>` in Redis, 7-day TTL) via `ApprovalFanoutService.applyReplyAction`.

### Inbound — ask-an-agent (`@mention`)
Any WhatsApp/SMS message that doesn't contain an approval token but does contain an `@mention` of an agent (`@ba`, `@dev`, `@qa`, `@architect`, `@supervisor`, `@help`) is routed through `AgentDispatcherService`. The agent runs a read-only DB query (no LLM for tier-1 responses) and replies via TwiML. See [`docs/plans/tier-3-autonomous-multi-agent-chat.md`](../plans/tier-3-autonomous-multi-agent-chat.md) for the fully autonomous vision.

- **Webhook handler:** [`backend/src/routes/webhooks/twilio-whatsapp.handler.ts`](../../backend/src/routes/webhooks/twilio-whatsapp.handler.ts)
- **Tests:** [`backend/src/routes/webhooks/__tests__/twilio-whatsapp.handler.test.ts`](../../backend/src/routes/webhooks/__tests__/twilio-whatsapp.handler.test.ts) — 14 tests covering every APPROVE/REJECT variant, reason capture, and rejection of bad tokens.
- **Auth:** X-Twilio-Signature (HMAC-SHA1 of URL + sorted form params using `TWILIO_AUTH_TOKEN`). In non-production only, a missing token logs loudly and skips verification for local testing.
- **Twilio webhook URL to configure:**
  - WhatsApp: `https://<your-instance>/webhooks/twilio/whatsapp`
  - SMS: same URL — Twilio sends the same payload shape; the handler does not care whether the sender is `whatsapp:+…` or a plain `+…`.

## Linear

Creates Linear issues from approved briefs. BYOK personal API key; each tenant picks a default team after connecting. Issues carry the brief context, a back-link, and optional section-to-label mapping.

- **Service:** [`backend/src/services/integrations/linear.service.ts`](../../backend/src/services/integrations/linear.service.ts)
- **Tests:** [`backend/src/services/integrations/__tests__/linear.service.test.ts`](../../backend/src/services/integrations/__tests__/linear.service.test.ts) — 24 tests covering config gating, GraphQL errors, user resolution, team defaulting, and priority mapping.
- **Setup doc:** [`backend/docs/linear-setup.md`](../../backend/docs/linear-setup.md)
- **Credentials** (BYOK, entered via Settings → Integrations → Linear):
  - `apiKey` — personal API key from Linear; must start with `lin_api_`
  - `defaultTeamId` — Linear team UUID, picked after Connect resolves the list
  - `labelMapping` — optional `{ briefSection: labelName }` map
- **Transport quirk:** personal API keys are sent in the `Authorization` header **without** a `Bearer ` prefix ([Linear docs](https://developers.linear.app/docs/graphql/working-with-the-graphql-api/authentication)). Enforced in `linear.service.ts` and covered by a test.
- **Rate limit:** 1,500 req/hr per key. Callers retry on 429.

## Notion

Saves approved briefs as Notion pages — either as rows in a database (preferred, typed) or as sub-pages under a shared parent page. Each brief carries the summary, requirements, and a back-link to Workforce0.

- **Service:** [`backend/src/services/integrations/notion.service.ts`](../../backend/src/services/integrations/notion.service.ts)
- **Tests:** [`backend/src/services/integrations/__tests__/notion.service.test.ts`](../../backend/src/services/integrations/__tests__/notion.service.test.ts) — 20 tests covering config gating, auth errors, the "no shared targets yet" hint, database vs page parent selection, version header presence, and the markdown-to-blocks converter.
- **Setup doc:** [`backend/docs/notion-setup.md`](../../backend/docs/notion-setup.md)
- **Credentials** (BYOK, entered via Settings → Integrations → Notion):
  - `apiKey` — internal integration secret; must start with `secret_` or newer `ntn_`
  - `defaultTarget` — `{ type: 'database' | 'page', id, title }`, picked after Connect resolves the accessible list
- **Quirks:**
  - Required header `Notion-Version: 2022-06-28` on every request. Hard-coded in the service; covered by a test.
  - Per-page sharing model — the integration only sees pages/databases explicitly shared with it via Notion UI. `test()` surfaces a friendly hint when zero targets are shared yet.
- **Rate limit:** ~3 req/sec per integration. Callers retry on 429.

## WorkOS SSO

SAML + OIDC single sign-on via WorkOS.

- **Service:** [`backend/src/services/auth/workos.service.ts`](../../backend/src/services/auth/workos.service.ts)
- **Routes:** auth.routes.ts `/api/auth/sso/*`
- **Env vars:**
  ```bash
  WORKOS_API_KEY=sk_...
  WORKOS_CLIENT_ID=client_...
  ```

## Meeting storage

Where Workforce0 keeps meeting audio/video so the transcription worker can
pick it up asynchronously. Two drivers are available, picked by env:

**Default: local filesystem** — zero cloud dependency. Files are written
under `STORAGE_ROOT` and served via short-lived JWT URLs from
`/api/storage/{upload,download}/:token`. Works out of the box on every
self-host; no AWS account needed.

- **Service:** [`backend/src/services/storage/local-file-storage.service.ts`](../../backend/src/services/storage/local-file-storage.service.ts)
- **Env vars:**
  ```bash
  STORAGE_ROOT=./data/uploads     # where uploaded files land
  # STORAGE_DRIVER=local           # optional; auto-picked when AWS_S3_BUCKET is unset
  ```
- **Docker:** `docker-compose.prod.yml` mounts a named volume
  (`backend_uploads:/app/data/uploads`) so uploads survive container
  restarts.
- **Retention:** this driver doesn't reap on its own. Teams that want a
  retention window add a cron that runs
  `find $STORAGE_ROOT/meetings -mtime +N -delete`.

**Opt-in: AWS S3** — switch to S3 when you want off-box storage,
cross-region durability, or lifecycle rules. Enabled automatically when
`AWS_S3_BUCKET` is set (or force it with `STORAGE_DRIVER=s3`).

- **Service:** [`backend/src/services/storage/s3.service.ts`](../../backend/src/services/storage/s3.service.ts)
- **Env vars:**
  ```bash
  STORAGE_DRIVER=s3               # optional; auto-picked when AWS_S3_BUCKET is set
  AWS_S3_BUCKET=my-meetings
  AWS_S3_REGION=us-east-1
  AWS_ACCESS_KEY_ID=AKIA...
  AWS_SECRET_ACCESS_KEY=...
  ```

Both drivers implement the same `StorageService` interface
(`backend/src/services/storage/storage.types.ts`), so switching is a
single env-var flip — product code never sees the driver choice.

---

## How to add a new integration

Every integration needs **five artifacts**. Copy an existing one (Jira is the most complete reference) and adapt:

### 1. Service — `backend/src/services/integrations/<name>.service.ts`

```ts
// Skeleton
export class MyService {
  constructor(private readonly config: MyServiceConfig | null) {}

  isConfigured(): boolean { return this.config !== null; }

  async test(): Promise<{ ok: boolean; error?: string }> { /* ping the API */ }

  async doThing(input: X): Promise<Y> {
    if (!this.isConfigured()) {
      throw new ServiceNotConfiguredError('myservice');
    }
    // …
  }
}
```

**Rules:**
- `isConfigured()` must never throw. Missing keys → `false`.
- Never crash the backend on startup if keys are absent. Every method either short-circuits or throws a typed `ServiceNotConfiguredError` the routes can catch and turn into a user-friendly 400.

### 2. Route — either extend `backend/src/routes/integrations.routes.ts` or add a new route module

Endpoints every integration should expose:
- `GET /api/integrations` — list all connection states for the tenant
- `POST /api/integrations/:name/connect` — save credentials (encrypt)
- `POST /api/integrations/:name/test` — call `.test()` and return ok/error
- `DELETE /api/integrations/:name` — disconnect

### 3. UI wizard — `frontend/src/components/integration-wizard.tsx`

Add your integration's slug to the `IntegrationName` union and teach the wizard how to render your step. The wizard is intentionally executive-friendly: no raw JSON, no code blocks, always a "Get API Key" button linking to the provider's console.

### 4. Setup doc — `backend/docs/<name>-setup.md`

Step-by-step screenshots of where to find keys inside the provider's console. This is the single most-read doc for non-technical users. Write it for someone who has never seen an API key before.

### 5. Tests

At minimum:
- Unit test that verifies `isConfigured()` returns false when any required config is missing.
- Unit test that `.test()` returns `{ ok: true }` on a happy-path mock.
- One integration test that exercises the route (`connect → test → disconnect`).

Templates live next to each existing service (e.g. `backend/src/services/integrations/__tests__/jira.service.test.ts`).

### 6. Add your integration to this catalog

Append a new row to the index table and a new section below. A PR without a catalog entry will be sent back for a doc-only update.
