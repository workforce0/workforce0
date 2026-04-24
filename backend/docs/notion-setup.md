# Notion Integration Setup Guide

## Overview

Workforce0 saves approved briefs to your Notion workspace and creates action-item pages. Every time your team approves a brief, Workforce0 writes a cleanly formatted page into Notion — summary, decisions, action items, risks — with a back-link so anyone reading in Notion can jump to the original in Workforce0.

This guide walks you through connecting Notion in about 5 minutes. No coding required.

> **Heads up:** Notion uses a per-page permission model, which is a bit unusual. After you create the integration, you have to open each parent page in Notion and explicitly share it with Workforce0. It's the one step that catches everyone — we'll flag it clearly below.

---

## What you'll need

- A Notion workspace (free or paid — both work)
- **Admin access** on that workspace (required to create integrations)
- 5 minutes

That's it. You won't need the command line, a config file, or a developer.

---

## Step 1: Create an internal integration

An "integration" is Notion's name for a connection from an outside tool (like Workforce0) into your workspace.

1. Go to **[https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)**
2. Click **+ New integration**
3. Fill in the form:
   - **Name:** `Workforce0`
   - **Associated workspace:** pick the workspace you want Workforce0 to write into
   - **Type:** Internal (the default)
4. Click **Submit**

   _[Screenshot placeholder: Notion "Create new integration" form]_

5. On the next screen, open the **Capabilities** tab and enable:
   - [x] **Read content**
   - [x] **Update content**
   - [x] **Insert content**
   - [x] **Read user information** — *without* email addresses
6. Click **Save changes**

   _[Screenshot placeholder: Capabilities checkboxes]_

7. Open the **Configuration** tab and find **Internal Integration Secret**.
8. Click **Show** → **Copy**. It starts with `secret_` and is a long string of letters and numbers.

   _[Screenshot placeholder: Internal Integration Secret with copy button highlighted]_

Keep this tab open — you'll paste the secret into Workforce0 in Step 3. Treat it like a password: anyone with this string can write to your Notion.

---

## Step 2: Share the pages with your integration

**This is the step everyone misses.** Notion integrations don't automatically get access to your workspace. You have to open each parent page and share it with the integration, one by one.

A "parent page" is the page under which Workforce0 should create new pages. Usually this is something like "Product Briefs" or "Engineering Action Items".

1. Open the parent page in Notion (the one you want Workforce0 to write into).
2. Click the **…** menu in the top-right corner of the page.
3. Click **+ Add connections**.
4. Start typing `Workforce0` and select it from the list.
5. Notion will ask you to confirm — click **Confirm**.

   _[Screenshot placeholder: Add connections menu with Workforce0 selected]_

**Important:** repeat this for every parent page you want Workforce0 to use. If you want briefs in one page and action items in another, share both. Sub-pages inherit access from their parent, so you only need to share the top-level page.

> If you skip this step, Step 3 will fail with "Unauthorized" — even though your secret is correct. It's not your fault; this is just how Notion works.

---

## Step 3: Connect in Workforce0

1. Open Workforce0 and go to **Settings → Integrations**.
2. Find **Notion** and click **Connect**.
3. Paste your Internal Integration Secret into the box labeled **Notion secret**.
4. Click **Continue**. Workforce0 will fetch the list of pages you've shared with the integration.
5. Pick a **parent page** from the dropdown — this is where new briefs will land.
6. Click **Test connection**. You should see a green checkmark and "Connected!"
7. Click **Save**.

If the test fails, jump to [Troubleshooting](#troubleshooting) below.

---

## Step 4: Pick an output format

Now tell Workforce0 *how* you want briefs to appear in Notion. You can change this anytime in Settings.

### One page per brief (default)

Each approved brief becomes a full Notion page under your parent page. Best for: teams that read briefs end-to-end and want a clean archive.

### Database of briefs

If you have a pre-created Notion database (with columns like Title, Status, Owner, Date), Workforce0 will append a new row for each brief and link out to the full page. Best for: teams that want to filter, sort, or view briefs by status.

To use this option:
1. Create the database in Notion first (add the columns you want).
2. Share the database page with the Workforce0 integration (same as Step 2).
3. In Workforce0 → Settings → Integrations → Notion, pick **Database of briefs** and select the database.

### Both

Workforce0 creates the full page **and** appends a row to the database. Best for: teams that want the database index plus the rich page content.

---

## Troubleshooting

### "Unauthorized"

The integration isn't shared with the parent page. Go back to **Step 2** and make sure you added the Workforce0 connection to the page you selected in Workforce0.

### "Page not found"

The parent page was moved, deleted, or renamed in a way that broke the link. In Workforce0, go to Settings → Integrations → Notion and pick the parent page again.

### "No permission" or pages not showing up in the dropdown

The integration was probably created in a different workspace than the one your pages live in. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations), open Workforce0, and check **Associated workspace**. If it's wrong, delete the integration and start over with Step 1 — but select the right workspace this time.

### Test connection spinner just keeps spinning

Check that your secret starts with `secret_` and has no extra spaces at the start or end. Copy-paste sometimes grabs a trailing newline.

---

## What Workforce0 creates

A typical brief page in Notion looks like this:

- **Page title:** the brief title (e.g. "Q2 Onboarding Redesign")
- **Summary** — 2-3 sentence executive summary
- **Decisions** — bulleted list of what was agreed
- **Action items** — a checklist with owners and due dates
- **Risks** — things to watch out for
- **Source** — a back-link to the original brief in Workforce0

Each section uses proper Notion headings so you can collapse, link, or reference individual parts.

---

## Revoking access

Changed your mind? Removing Workforce0 from Notion is instant:

1. Go to **[https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)**
2. Click **Workforce0**
3. Scroll down and click **Delete integration**
4. Confirm

Workforce0 will immediately stop writing to Notion. Existing pages stay where they are — Notion only revokes *future* access.

You can also disconnect from the Workforce0 side: Settings → Integrations → Notion → **Disconnect**. This clears the secret from Workforce0 but leaves the integration itself in Notion.

---

## Privacy note

Your Internal Integration Secret is encrypted at rest inside Workforce0 using the same key management as every other integration credential. It's never logged, never sent to any AI model, and never shown in plain text after you save it. If you need to rotate it, delete the integration in Notion and repeat Steps 1-3 with a new secret.
