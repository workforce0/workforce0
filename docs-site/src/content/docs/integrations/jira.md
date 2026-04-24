---
title: Jira
description: Sync decomposed tickets into Atlassian Jira.
---

## What it does

When the chief-of-staff decomposes a brief into child tickets, those
tickets sync to a Jira project. Team members work in Jira as normal;
status updates flow back into Workforce0's audit log.

## Setup

1. **Jira side**
   - Atlassian → **Profile → Security → Create and manage API tokens
     → Create API token**.
   - Copy the token.
   - Note your Jira base URL (e.g. `https://acme.atlassian.net`).
   - Identify the target project's key (e.g. `ACME`).

2. **Workforce0 side**
   - **Integrations → Jira → Connect.**
   - Paste Base URL, email, API token, project key.
   - Click **Test connection**. A green check = good to go.

## What syncs

| Workforce0 concept   | Jira equivalent       |
| -------------------- | --------------------- |
| Brief (approved)     | Epic                  |
| Ticket (child)       | Task (or Subtask under the Epic) |
| Role (`dev_agent`)   | Label `wf0:dev_agent` |
| Skills               | Labels `wf0:skill:…`  |
| Chief-of-staff summary | Epic description    |
| Replan reason        | Epic comment          |

## Workflow mapping

Workforce0's ticket statuses map to Jira statuses:

- `pending` → Jira **To Do**
- `in_progress` → Jira **In Progress**
- `done` → Jira **Done**
- `failed` → Jira **Blocked** (custom status — requires one-time setup)

If your Jira workflow doesn't have a **Blocked** status, failures map
to **To Do** with a `wf0:failed` label instead.

## One-way vs two-way

By default the sync is **two-way**:

- Workforce0 → Jira: new tickets, status transitions, chief-of-staff
  comments.
- Jira → Workforce0: status transitions (polled every 60 seconds),
  comments (webhook).

For one-way, set `JIRA_SYNC_DIRECTION=outbound` to disable the inbound
path.

## Webhook setup (for real-time inbound)

Without a webhook, Workforce0 polls Jira every 60s (tunable via
`JIRA_POLL_INTERVAL_SECONDS`). Real-time sync requires a webhook:

1. Atlassian → **System → WebHooks → Create webhook**.
2. URL: `https://your-workforce0/api/webhooks/jira`.
3. Events: `Issue: updated`, `Comment: created`.
4. JQL: `project = ACME AND labels in (wf0)`. Prevents unrelated
   updates from firing.
5. Save.

Workforce0 verifies the webhook signature on every event.

## Common failure modes

### 401 on every call

API token is wrong or expired. Re-paste it.

### 403 on create

Your user doesn't have **Create issue** permission on the target
project. Ask a Jira admin.

### Labels not sticking

Your project's issue type doesn't have the `labels` field in its
default screen. Add it in **Project settings → Screens → Default
screen**.

### Workflow status mismatches

If your custom Jira workflow has different status names, map them in
`.env`:

```bash
JIRA_STATUS_PENDING=Backlog
JIRA_STATUS_IN_PROGRESS=Doing
JIRA_STATUS_DONE=Shipped
JIRA_STATUS_FAILED=Blocked
```

## Uninstalling

**Integrations → Jira → Disconnect.** Jira tickets remain — we don't
delete them. Future child tickets simply don't sync.
