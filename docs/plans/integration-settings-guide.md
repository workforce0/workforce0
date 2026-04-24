# Integration Settings Guide

## Overview

This guide covers how customers configure their tool preferences in Workforce0. The integration settings system allows customers to choose which SaaS tools they want agents to use (e.g., Zoom vs Google Meet, Slack vs Google Chat).

Settings are stored per-tenant and drive the behavior of the **Connectors (CASB) namespace**, which routes all agent requests to the appropriate SaaS provider.

---

## 1. Admin Dashboard (Settings → Integrations)

Customers configure integrations through the web dashboard:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Settings > Integrations                                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  📹 MEETINGS                                                            │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  Primary Provider:  ○ Google Meet  ● Zoom  ○ Teams  ○ Webex       │ │
│  │  Record meetings:   [✓] Enabled                                   │ │
│  │  Auto-transcribe:   [✓] Enabled                                   │ │
│  │  Bot display name:  [Workforce0 Assistant    ]                    │ │
│  │  Join before host:  [ ] Disabled                                  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  💬 COMMUNICATION                                                       │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  Primary channel:       ○ Google Chat  ● Slack  ○ Teams           │ │
│  │  Agent notifications:   [#workforce0-alerts    ]                  │ │
│  │  Approval requests:     [#workforce0-approvals ]                  │ │
│  │  Daily briefings:       [#workforce0-daily     ]                  │ │
│  │  Mention on urgent:     [✓] Enabled                               │ │
│  │  Thread replies:        [✓] Enabled                               │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  📋 PROJECT MANAGEMENT                                                  │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  Task tracking:     ○ Jira  ● Linear  ○ Asana  ○ Monday           │ │
│  │  Default project:   [WF0                       ]                  │ │
│  │  Auto-create tasks: [✓] Enabled                                   │ │
│  │                                                                   │ │
│  │  Documentation:     ○ Confluence  ● Notion  ○ Coda                │ │
│  │  Workspace:         [Engineering Docs          ]                  │ │
│  │  Auto-sync PRDs:    [✓] Enabled                                   │ │
│  │                                                                   │ │
│  │  Code repos:        ● GitHub  ○ GitLab  ○ Bitbucket               │ │
│  │  Default org:       [acme-corp                 ]                  │ │
│  │  Branch protection: [✓] Require reviews                           │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  📧 EMAIL & CALENDAR                                                    │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  Email/Calendar:    ● Google Workspace  ○ Microsoft 365           │ │
│  │  Send as user:      [ ] Disabled (agents send from their account) │ │
│  │  Auto-schedule:     [✓] Enabled                                   │ │
│  │  Working hours:     [09:00] to [18:00]  TZ: [America/New_York ▼]  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  💼 CRM & SALES                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  CRM provider:      ● Salesforce  ○ HubSpot  ○ Pipedrive          │ │
│  │  Auto-log calls:    [✓] Enabled                                   │ │
│  │  Sync opportunities:[✓] Enabled                                   │ │
│  │  Contact matching:  [✓] Auto-match by email                       │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│                                             [Cancel]  [Save Changes]   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Config-as-Code

Enterprise customers can manage integrations via `.workforce0/integrations.yaml` in their repo:

```yaml
# .workforce0/integrations.yaml
# Integration preferences for Workforce0 agents

integrations:

  # ═══════════════════════════════════════════════════════════════════
  # MEETINGS
  # ═══════════════════════════════════════════════════════════════════
  meetings:
    provider: "zoom"              # google_meet | zoom | teams | webex
    settings:
      auto_join: true             # Bot joins automatically
      recording: true             # Record meetings
      transcription: true         # Real-time transcription
      bot_display_name: "Workforce0 Assistant"
      join_before_host: false
      waiting_room_bypass: false

    # Fallback for unsupported platforms (e.g., if customer uses Zoom
    # but joins a Google Meet, use Recall.ai universal bot)
    fallback:
      provider: "recall_ai"       # Universal meeting bot API
      enabled: true

  # ═══════════════════════════════════════════════════════════════════
  # COMMUNICATION
  # ═══════════════════════════════════════════════════════════════════
  communication:
    provider: "slack"             # slack | google_chat | teams
    channels:
      notifications: "#workforce0-alerts"
      approvals: "#workforce0-approvals"
      briefings: "#workforce0-daily"
    settings:
      mention_on_urgent: true     # @mention users for urgent items
      thread_replies: true        # Reply in threads, not channel
      emoji_reactions: true       # React with ✅ when task complete

  # ═══════════════════════════════════════════════════════════════════
  # PROJECT MANAGEMENT
  # ═══════════════════════════════════════════════════════════════════
  project_management:

    # Task/Issue tracking
    tasks:
      provider: "linear"          # jira | linear | asana | monday
      default_project: "WF0"      # Default project for new issues
      auto_create_issues: true    # Auto-create from PRD items
      labels:
        ai_generated: "ai-generated"
        needs_review: "needs-review"

    # Documentation
    documentation:
      provider: "notion"          # confluence | notion | coda
      workspace_id: "abc123"
      auto_sync_prd: true         # Sync PRDs to docs
      templates:
        prd: "PRD Template"
        meeting_notes: "Meeting Notes Template"

    # Code repositories
    code:
      provider: "github"          # github | gitlab | bitbucket
      default_org: "acme-corp"
      branch_protection: true
      auto_create_pr: true
      require_reviews: 1

  # ═══════════════════════════════════════════════════════════════════
  # EMAIL & CALENDAR
  # ═══════════════════════════════════════════════════════════════════
  productivity:
    email:
      provider: "google_workspace"  # google_workspace | microsoft_365
      send_as_user: false           # false = send from agent account
      signature: "Sent by Workforce0 AI"

    calendar:
      provider: "google_calendar"   # google_calendar | outlook
      auto_schedule: true           # Auto-find meeting times
      working_hours:
        start: "09:00"
        end: "18:00"
        timezone: "America/New_York"
      buffer_between_meetings: 15   # minutes

  # ═══════════════════════════════════════════════════════════════════
  # CRM & SALES
  # ═══════════════════════════════════════════════════════════════════
  sales:
    crm:
      provider: "salesforce"        # salesforce | hubspot | pipedrive
      auto_log_calls: true          # Log meeting summaries to CRM
      opportunity_sync: true        # Sync deal updates
      contact_matching: "email"     # Match contacts by email

    outreach:
      provider: null                # outreach | salesloft | apollo
      auto_sequences: false
```

### Config Precedence

1. **Dashboard settings** - Default for all users
2. **Config file** - Overrides dashboard for that repo
3. **Environment variables** - Override for CI/CD pipelines

```yaml
# Precedence example
# Dashboard: meetings.provider = "google_meet"
# Config file: meetings.provider = "zoom"
# Result: Zoom is used for this project
```

---

## 3. Database Schema

```sql
-- Main integration settings table
CREATE TABLE tenant_integrations (
    tenant_id               UUID PRIMARY KEY REFERENCES tenants(id),

    -- Meeting settings
    meeting_provider        VARCHAR(50) DEFAULT 'google_meet',
    meeting_settings        JSONB DEFAULT '{}',

    -- Communication settings
    communication_provider  VARCHAR(50) DEFAULT 'google_chat',
    communication_channels  JSONB DEFAULT '{}',
    communication_settings  JSONB DEFAULT '{}',

    -- Project management
    task_provider           VARCHAR(50) DEFAULT 'jira',
    task_settings           JSONB DEFAULT '{}',
    doc_provider            VARCHAR(50) DEFAULT 'confluence',
    doc_settings            JSONB DEFAULT '{}',
    code_provider           VARCHAR(50) DEFAULT 'github',
    code_settings           JSONB DEFAULT '{}',

    -- Productivity
    email_provider          VARCHAR(50) DEFAULT 'google_workspace',
    email_settings          JSONB DEFAULT '{}',
    calendar_provider       VARCHAR(50) DEFAULT 'google_calendar',
    calendar_settings       JSONB DEFAULT '{}',

    -- CRM
    crm_provider            VARCHAR(50),
    crm_settings            JSONB DEFAULT '{}',

    -- Metadata
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW(),
    updated_by              UUID REFERENCES users(id)
);

-- Index for fast lookups
CREATE INDEX idx_tenant_integrations_tenant ON tenant_integrations(tenant_id);

-- Audit trail for setting changes
CREATE TABLE tenant_integration_audit (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID REFERENCES tenants(id),
    changed_by              UUID REFERENCES users(id),
    changed_at              TIMESTAMP DEFAULT NOW(),
    field_changed           VARCHAR(100),
    old_value               JSONB,
    new_value               JSONB,
    change_reason           TEXT
);
```

### Example Data

```sql
-- Insert example tenant integration settings
INSERT INTO tenant_integrations (
    tenant_id,
    meeting_provider,
    meeting_settings,
    communication_provider,
    communication_channels,
    task_provider,
    doc_provider,
    code_provider,
    crm_provider
) VALUES (
    'tenant-acme-123',
    'zoom',
    '{"auto_join": true, "recording": true, "bot_display_name": "ACME Assistant"}',
    'slack',
    '{"notifications": "#acme-alerts", "approvals": "#acme-approvals"}',
    'linear',
    'notion',
    'github',
    'salesforce'
);
```

---

## 4. Connector Routing Logic

The **Connectors (CASB) namespace** uses these settings to route agent requests:

```python
from dataclasses import dataclass
from typing import Optional
import httpx

@dataclass
class TenantIntegrations:
    """Tenant integration preferences loaded from DB"""
    tenant_id: str
    meeting_provider: str
    communication_provider: str
    task_provider: str
    doc_provider: str
    code_provider: str
    crm_provider: Optional[str]
    settings: dict

class ConnectorRouter:
    """
    Routes agent requests to the correct SaaS provider based on tenant settings.

    This is the core of the CASB (Cloud Access Security Broker) pattern.
    All agents call this router - they never call SaaS APIs directly.
    """

    def __init__(self, db_pool, vault_client):
        self.db = db_pool
        self.vault = vault_client
        self._integrations_cache = {}  # tenant_id -> (settings, expiry)

    async def get_tenant_integrations(self, tenant_id: str) -> TenantIntegrations:
        """Get tenant's integration settings with caching"""
        # Check cache first (5 min TTL)
        if tenant_id in self._integrations_cache:
            settings, expiry = self._integrations_cache[tenant_id]
            if time.time() < expiry:
                return settings

        # Fetch from database
        row = await self.db.fetchrow(
            "SELECT * FROM tenant_integrations WHERE tenant_id = $1",
            tenant_id
        )

        settings = TenantIntegrations(
            tenant_id=tenant_id,
            meeting_provider=row['meeting_provider'],
            communication_provider=row['communication_provider'],
            task_provider=row['task_provider'],
            doc_provider=row['doc_provider'],
            code_provider=row['code_provider'],
            crm_provider=row['crm_provider'],
            settings={
                'meeting': row['meeting_settings'],
                'communication': row['communication_channels'],
                'task': row['task_settings'],
            }
        )

        # Cache for 5 minutes
        self._integrations_cache[tenant_id] = (settings, time.time() + 300)
        return settings

    # ═══════════════════════════════════════════════════════════════════
    # NOTIFICATION ROUTING
    # ═══════════════════════════════════════════════════════════════════

    async def send_notification(
        self,
        tenant_id: str,
        message: str,
        channel_type: str = "notifications",  # notifications | approvals | briefings
        urgent: bool = False
    ):
        """Send notification to tenant's configured communication channel"""

        settings = await self.get_tenant_integrations(tenant_id)
        provider = settings.communication_provider
        channels = settings.settings.get('communication', {})
        channel = channels.get(channel_type, channels.get('notifications'))

        # Get OAuth token from Vault
        token = await self.vault.get_oauth_token(tenant_id, provider)

        # Route to correct provider
        if provider == "slack":
            return await self._send_slack(token, channel, message, urgent)
        elif provider == "google_chat":
            return await self._send_gchat(token, channel, message, urgent)
        elif provider == "teams":
            return await self._send_teams(token, channel, message, urgent)
        else:
            raise ValueError(f"Unknown communication provider: {provider}")

    async def _send_slack(self, token: str, channel: str, message: str, urgent: bool):
        """Send message via Slack API"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://slack.com/api/chat.postMessage",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "channel": channel,
                    "text": message,
                    "unfurl_links": False,
                }
            )
            return response.json()

    async def _send_gchat(self, token: str, space: str, message: str, urgent: bool):
        """Send message via Google Chat API"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://chat.googleapis.com/v1/{space}/messages",
                headers={"Authorization": f"Bearer {token}"},
                json={"text": message}
            )
            return response.json()

    # ═══════════════════════════════════════════════════════════════════
    # MEETING ROUTING
    # ═══════════════════════════════════════════════════════════════════

    async def join_meeting(self, tenant_id: str, meeting_url: str):
        """Join a meeting using tenant's configured provider"""

        settings = await self.get_tenant_integrations(tenant_id)
        preferred_provider = settings.meeting_provider

        # Detect meeting type from URL
        detected_provider = self._detect_meeting_provider(meeting_url)

        if detected_provider == preferred_provider:
            # Native integration - use tenant's configured bot
            return await self._native_join(preferred_provider, tenant_id, meeting_url)
        else:
            # Cross-platform - use Recall.ai universal bot
            return await self._fallback_join(tenant_id, meeting_url)

    def _detect_meeting_provider(self, url: str) -> str:
        """Detect meeting provider from URL"""
        if "meet.google.com" in url:
            return "google_meet"
        elif "zoom.us" in url:
            return "zoom"
        elif "teams.microsoft.com" in url:
            return "teams"
        elif "webex.com" in url:
            return "webex"
        return "unknown"

    # ═══════════════════════════════════════════════════════════════════
    # TASK CREATION ROUTING
    # ═══════════════════════════════════════════════════════════════════

    async def create_task(
        self,
        tenant_id: str,
        title: str,
        description: str,
        labels: list[str] = None,
        assignee: str = None
    ):
        """Create task in tenant's configured project management tool"""

        settings = await self.get_tenant_integrations(tenant_id)
        provider = settings.task_provider
        task_settings = settings.settings.get('task', {})

        token = await self.vault.get_oauth_token(tenant_id, provider)

        if provider == "jira":
            return await self._create_jira_issue(token, task_settings, title, description)
        elif provider == "linear":
            return await self._create_linear_issue(token, task_settings, title, description)
        elif provider == "asana":
            return await self._create_asana_task(token, task_settings, title, description)
        elif provider == "monday":
            return await self._create_monday_item(token, task_settings, title, description)

    # ═══════════════════════════════════════════════════════════════════
    # CRM ROUTING
    # ═══════════════════════════════════════════════════════════════════

    async def log_meeting_to_crm(
        self,
        tenant_id: str,
        meeting_summary: str,
        attendees: list[str],
        outcomes: list[str]
    ):
        """Log meeting summary to tenant's CRM"""

        settings = await self.get_tenant_integrations(tenant_id)
        provider = settings.crm_provider

        if not provider:
            return None  # No CRM configured

        token = await self.vault.get_oauth_token(tenant_id, provider)

        if provider == "salesforce":
            return await self._log_to_salesforce(token, meeting_summary, attendees)
        elif provider == "hubspot":
            return await self._log_to_hubspot(token, meeting_summary, attendees)
        elif provider == "pipedrive":
            return await self._log_to_pipedrive(token, meeting_summary, attendees)
```

---

## 5. Supported Integrations Matrix

| Category | Provider | Status | OAuth | Notes |
|----------|----------|--------|-------|-------|
| **Meetings** | | | | |
| | Google Meet | ✅ Supported | Google OAuth 2.0 | Native bot + transcription |
| | Zoom | ✅ Supported | Zoom OAuth 2.0 | Native bot + transcription |
| | Microsoft Teams | ✅ Supported | Azure AD OAuth | Native bot + transcription |
| | Webex | 🔄 Planned | Webex OAuth | Q2 2026 |
| | *Fallback* | ✅ Supported | Recall.ai | Universal bot for any platform |
| **Communication** | | | | |
| | Slack | ✅ Supported | Slack OAuth 2.0 | Full API access |
| | Google Chat | ✅ Supported | Google OAuth 2.0 | Spaces + DMs |
| | Microsoft Teams | ✅ Supported | Azure AD OAuth | Channels + Chat |
| | Discord | 🔄 Planned | Discord OAuth | Q3 2026 |
| **Project Management** | | | | |
| | Jira | ✅ Supported | Atlassian OAuth 2.0 | Issues, epics, sprints |
| | Linear | ✅ Supported | Linear OAuth | Issues, projects, cycles |
| | Asana | ✅ Supported | Asana OAuth | Tasks, projects, portfolios |
| | Monday.com | 🔄 Planned | Monday OAuth | Q2 2026 |
| | Trello | 🔄 Planned | Atlassian OAuth | Q3 2026 |
| **Documentation** | | | | |
| | Confluence | ✅ Supported | Atlassian OAuth 2.0 | Pages, spaces |
| | Notion | ✅ Supported | Notion OAuth | Pages, databases |
| | Coda | 🔄 Planned | Coda OAuth | Q2 2026 |
| | Google Docs | ✅ Supported | Google OAuth 2.0 | Documents, folders |
| **Code Repositories** | | | | |
| | GitHub | ✅ Supported | GitHub OAuth | Repos, PRs, Actions |
| | GitLab | ✅ Supported | GitLab OAuth | Repos, MRs, CI/CD |
| | Bitbucket | 🔄 Planned | Atlassian OAuth | Q2 2026 |
| **Email & Calendar** | | | | |
| | Google Workspace | ✅ Supported | Google OAuth 2.0 | Gmail, Calendar, Drive |
| | Microsoft 365 | ✅ Supported | Azure AD OAuth | Outlook, Calendar, OneDrive |
| **CRM** | | | | |
| | Salesforce | ✅ Supported | Salesforce OAuth | Contacts, Opps, Activities |
| | HubSpot | ✅ Supported | HubSpot OAuth | CRM, Marketing, Sales |
| | Pipedrive | 🔄 Planned | Pipedrive OAuth | Q2 2026 |

---

## 6. Adding New Integrations

### Steps to Add a New Integration

1. **Add provider to enum**
```python
# connectors/providers.py
class CommunicationProvider(Enum):
    SLACK = "slack"
    GOOGLE_CHAT = "google_chat"
    TEAMS = "teams"
    DISCORD = "discord"  # New provider
```

2. **Create connector class**
```python
# connectors/discord_connector.py
class DiscordConnector(BaseConnector):
    async def send_message(self, channel_id: str, message: str):
        ...

    async def create_thread(self, channel_id: str, name: str):
        ...
```

3. **Add OAuth configuration**
```python
# auth/oauth_configs.py
OAUTH_CONFIGS = {
    "discord": {
        "auth_url": "https://discord.com/api/oauth2/authorize",
        "token_url": "https://discord.com/api/oauth2/token",
        "scopes": ["identify", "guilds", "messages.write"],
    }
}
```

4. **Update router**
```python
# connectors/router.py
async def send_notification(self, tenant_id, message, ...):
    ...
    elif provider == "discord":
        return await self._send_discord(token, channel, message)
```

5. **Add to dashboard**
```typescript
// frontend/src/components/IntegrationSettings.tsx
const communicationProviders = [
  { id: 'slack', name: 'Slack', icon: SlackIcon },
  { id: 'google_chat', name: 'Google Chat', icon: GoogleChatIcon },
  { id: 'teams', name: 'Microsoft Teams', icon: TeamsIcon },
  { id: 'discord', name: 'Discord', icon: DiscordIcon },  // New
];
```

6. **Update documentation**

---

## 7. Default Settings by Plan Tier

| Setting | Starter | Professional | Enterprise |
|---------|---------|--------------|------------|
| Meeting providers | Google Meet only | All supported | All + custom |
| Communication | Google Chat only | All supported | All + custom |
| Project mgmt | 1 provider | All supported | All + custom |
| CRM | Not included | All supported | All + custom |
| Custom MCPs | Not included | 2 per tenant | Unlimited |
| Config-as-Code | Not included | ✅ | ✅ |
| SSO/SAML | Not included | Not included | ✅ |
| Dedicated support | Not included | Email | 24/7 + Slack |

---

## 8. Settings API

### Get Integration Settings
```http
GET /api/v1/tenants/{tenant_id}/integrations
Authorization: Bearer {token}
```

Response:
```json
{
  "tenant_id": "tenant-acme-123",
  "integrations": {
    "meetings": {
      "provider": "zoom",
      "settings": {
        "auto_join": true,
        "recording": true
      }
    },
    "communication": {
      "provider": "slack",
      "channels": {
        "notifications": "#alerts",
        "approvals": "#approvals"
      }
    }
  },
  "updated_at": "2026-01-24T10:00:00Z"
}
```

### Update Integration Settings
```http
PATCH /api/v1/tenants/{tenant_id}/integrations
Authorization: Bearer {token}
Content-Type: application/json

{
  "meetings": {
    "provider": "teams"
  }
}
```

### Connect New Integration (OAuth Flow)
```http
POST /api/v1/tenants/{tenant_id}/integrations/{provider}/connect
Authorization: Bearer {token}

# Returns OAuth redirect URL
{
  "redirect_url": "https://accounts.google.com/o/oauth2/auth?..."
}
```

---

## 9. Integration Flow Diagram

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Admin Dashboard │      │  Config File    │      │  API            │
│  (UI Settings)   │      │  (.workforce0/) │      │  (Programmatic) │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Settings Service                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │ Validation  │  │ Merge Logic │  │ Audit Log   │                  │
│  └─────────────┘  └─────────────┘  └─────────────┘                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PostgreSQL (tenant_integrations)                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ Read on each request
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Connectors (CASB) Namespace                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │ Slack       │  │ Google      │  │ Jira        │  │ Salesforce │ │
│  │ Connector   │  │ Connector   │  │ Connector   │  │ Connector  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
│                                                                      │
│     X-Tenant-ID header → Lookup settings → Route to provider         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [Agent Implementation Guide](./agent-implementation-guide.md) - How agents use these settings
- [Secrets Storage](./agent-implementation-guide.md#9-secrets--customer-keys-storage) - OAuth token management
- [Cost Estimation Guide](./cost-estimation-guide.md) - Pricing for integrations
