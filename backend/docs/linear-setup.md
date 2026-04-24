# Linear Integration Setup Guide

## Overview

Workforce0 creates Linear issues from approved briefs. Once connected, every action item in an approved brief becomes a tracked issue in your team's Linear workspace — no copy-paste, no manual ticket creation.

This guide takes about 5 minutes. You'll create an API key in Linear, paste it into Workforce0, and pick a default team.

---

## What you'll need

- A Linear workspace (free or paid plan — both work)
- Admin access to create personal API keys in Linear
- A Workforce0 account with Integrations permission

If your Linear workspace restricts API key creation, ask your workspace admin to generate one on your behalf.

---

## Step 1: Create a Linear API key

1. Sign in to Linear and open [https://linear.app/settings/api](https://linear.app/settings/api)
2. Click **Create key**

   ![](./images/linear-01-new-key.png)

3. Name the key `Workforce0` so you can identify it later
4. Click **Create**
5. Copy the key that appears — it starts with `lin_api_` followed by a long string

   ![](./images/linear-02-copy-key.png)

> **Important:** Linear only shows the key once. Copy it now and paste it into Workforce0 in the next step. If you lose it, delete the key and create a new one.

---

## Step 2: Connect in Workforce0

1. Open Workforce0 and go to **Settings → Integrations**
2. Find the **Linear** card and click **Connect**

   ![](./images/linear-03-integrations.png)

3. Paste your API key into the **API Key** field
4. Click **Test Connection**
   - Green check: Workforce0 can talk to Linear
   - Red error: see [Troubleshooting](#troubleshooting) below
5. Click **Save**

---

## Step 3: Pick a default team

After a successful connection, Workforce0 pulls the list of teams you have access to in Linear.

1. Open the **Default Team** dropdown
2. Select the team where new issues should be created (e.g., `Product`, `Engineering`)
3. Click **Save**

All issues created from briefs will land in this team unless you override it on a per-brief basis.

---

## Step 4 (Optional): Map brief sections to Linear labels

Briefs have sections like *Risks*, *Dependencies*, *Open Questions*. You can auto-apply Linear labels based on the section an action item came from.

1. Under the Linear integration, click **Label Mapping**
2. For each brief section, pick a matching Linear label. Examples:
   - Brief section `Risks` → Linear label `risk`
   - Brief section `Dependencies` → Linear label `blocked`
   - Brief section `Open Questions` → Linear label `needs-clarification`
3. Click **Save**

Labels must already exist in Linear. If a mapped label is missing, Workforce0 skips it silently.

---

## Troubleshooting

**"Invalid auth token"**
Your key was revoked, mistyped, or doesn't start with `lin_api_`. Create a new key in Linear and paste it again. Make sure there's no leading/trailing whitespace.

**"No teams visible"**
You're connected, but your Linear user isn't a member of any team. Ask your workspace admin to add you to at least one team, then click **Refresh Teams** in Workforce0.

**"Can't create issue"**
Some teams in Linear require issues to use a template. Either (a) disable the template requirement for the team, or (b) pick a different default team that allows free-form issues.

**"Rate limited"**
Linear's API allows 1,500 requests/hour per key. If you hit this during a large brief, Workforce0 will retry automatically after a short backoff.

---

## What Workforce0 creates

For each action item in an approved brief, Workforce0 creates **one Linear issue**:

| Linear field | Source |
|---|---|
| Title | The action item text |
| Description | The surrounding brief context + link back to the brief |
| Team | Your default team (or override) |
| Assignee | The owner named in the brief, matched by email to a Linear user |
| Priority | Mapped from brief urgency (High → Urgent, Medium → High, Low → Medium) |
| Labels | From your section-to-label mapping |

If no owner is matched, the issue is created unassigned and flagged in the brief's activity log.

---

## Revoking access

To disconnect Linear from Workforce0:

1. **In Linear:** Go to [https://linear.app/settings/api](https://linear.app/settings/api), find the `Workforce0` key, and click **Delete**
2. **In Workforce0:** Go to **Settings → Integrations → Linear** and click **Disconnect**

Revoking the key in Linear immediately blocks Workforce0 from creating any new issues. Existing issues are not affected.

---

## Privacy note

Your Linear API key is encrypted at rest using AES-256 before it's written to the Workforce0 database. It is never logged, never sent to third-party AI models, and never exposed through the API. Only you and other admins in your Workforce0 organization can view or rotate the key.
