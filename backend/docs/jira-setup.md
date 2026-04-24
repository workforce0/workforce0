# Jira Setup Guide

## What this does

Once you link up Jira, Workforce0 turns your approved briefs into real Jira tickets automatically. Every action item in a brief becomes a ticket in the project you pick — with the title, description, and acceptance criteria already filled in. No copy-pasting, no rewriting. You stay in Workforce0, your team stays in Jira.

## What you'll need

- A Jira Cloud account (the one at `yourcompany.atlassian.net`)
- About 5 minutes
- Admin rights on Jira *only* if you need to create a brand-new project to send tickets into — if you already have a project you can write to, you're fine

That's it. No command line, no config files.

---

## Step 1: Find your Jira URL

Your Jira URL is the web address you use every day to open Jira. It looks like this:

```
yourcompany.atlassian.net
```

**Where to find it:** open Jira in your browser and look at the address bar. The part before the first `/` is your URL.

**Examples that work:**
- `acme.atlassian.net`
- `mycompany-team.atlassian.net`

**Common mistakes to avoid:**
- Don't include `https://` — just the address
- Don't include a trailing slash (`/`)
- Don't include anything after `.net` (no `/jira`, no `/projects`, etc.)

Keep that address handy — you'll paste it in Workforce0 in a moment.

---

## Step 2: Create a Jira token

A token is like a special password that lets Workforce0 create tickets for you. You'll make one in Jira, then paste it into Workforce0 once.

**Click here to open the Jira token page:**
[https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)

Then:

1. **Log in** with the same Atlassian account you use for Jira.

   ![](./images/jira-01-create-token.png)

2. Click the **Create API token** button (top right of the page).

   ![](./images/jira-02-create-button.png)

3. A small window pops up asking for a name. Type:

   ```
   Workforce0
   ```

   This name is just a label for you — it helps you recognize this token later if you have several.

   ![](./images/jira-03-name-token.png)

4. Click **Create**.

5. A long string of random letters and numbers appears. Click **Copy** to copy it to your clipboard.

   ![](./images/jira-04-copy.png)

> **Important:** this is the only time Jira will show you this token. If you close the window without copying it, you'll need to make a new one. Don't worry — that takes about 10 seconds.

Leave this browser tab open for now in case you need to paste again.

---

## Step 3: Connect in Workforce0

Back in Workforce0:

1. Click **Settings** (bottom-left of the sidebar).
2. Click **Integrations**.
3. Find **Jira** in the list and click **Connect**.
4. In the connection wizard, paste:
   - **Your Jira URL** — from Step 1 (e.g. `yourcompany.atlassian.net`)
   - **Your email** — the email you use to log in to Jira
   - **Your token** — the one you just copied from Atlassian
5. Click **Test connection**.

You should see a green checkmark and the words **Connected!** within a few seconds.

If something looks off, skip to [Troubleshooting](#troubleshooting) below — the fix is almost always quick.

---

## Step 4: Pick a default project

Right after a successful connection, Workforce0 shows a dropdown labeled **Default project**. This is where your new tickets will land.

- The dropdown shows every Jira project you have access to, by name and project key (like `ACME` or `WEB`).
- Pick one and click **Done**.

**If the dropdown is empty:** that means your Atlassian account doesn't have access to any Jira projects yet. Either:
- Ask a Jira admin at your company to add you to an existing project, or
- If you *are* an admin, open Jira, click **Projects → Create project**, pick the **Scrum** or **Kanban** template, name it (e.g. "Workforce0 Inbox"), and click **Create**. Come back to Workforce0 and click the refresh icon next to the dropdown.

You can change the default project any time from **Settings → Integrations → Jira**.

---

## Troubleshooting

Five things cover almost every issue. If none of these match, click **Need help?** in the wizard and we'll pick it up from there.

### "Can't reach that address"

Workforce0 couldn't find your Jira at the URL you gave it.

- Double-check the address is just `yourcompany.atlassian.net` — no `https://`, no slashes, nothing after `.net`.
- Open that address in your browser directly. If Jira doesn't load there either, the URL is wrong.

### "Token didn't work"

The token was received but Jira rejected it. Two usual causes:

- **Email mismatch** — the email you typed in Workforce0 isn't the one you use to log in to Jira. Use the same email as your Atlassian login.
- **Wrong token pasted** — the clipboard picked up something else. Go back to Atlassian, create a fresh token, copy it carefully, and paste it again.

### "No projects available"

The connection worked, but you don't have write access to any project.

- Ask a Jira admin to add you to a project with **Create issues** permission.
- If you *are* an admin, create a new project in Jira, then click the refresh icon next to the project dropdown in Workforce0.

### "403 on ticket creation"

The connection is healthy but Jira refused when Workforce0 tried to file a specific ticket.

- You have access to the project, but not permission to create tickets *in that project*.
- Ask the project lead to grant you the **Create issues** permission, or pick a different default project in **Settings → Integrations → Jira**.

### "Token expired"

Atlassian tokens can be set to expire. If Workforce0 suddenly can't post to Jira:

1. Go to [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Delete the old **Workforce0** token.
3. Create a new one, copy it.
4. In Workforce0, go to **Settings → Integrations → Jira**, click **Update token**, and paste the new one.

---

## What Workforce0 creates

Once you're linked up, here's exactly what lands in Jira:

- **One ticket per action item** in every brief you approve. Nothing happens until *you* hit approve — Workforce0 never files tickets on its own.
- Each ticket keeps the **title** from the brief (no rewording).
- The **description** includes the full context from the brief so engineers have what they need.
- The **acceptance criteria** are listed as a checklist inside the ticket.
- Tickets land in the default project you picked, as **Task** type, unassigned, with no estimate — your team can triage from there.

You'll see a link to each created ticket inside the brief itself, so you can click through to Jira with one tap.

---

## Revoking the token

If you ever want to cut Workforce0 off from Jira — no hard feelings — here's how:

1. Open [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Find the token labeled **Workforce0**.
3. Click **Revoke** next to it.
4. Come back to Workforce0, open **Settings → Integrations → Jira**, and click **Disconnect**.

That's it. Workforce0 will no longer have any way to touch your Jira.

You can reconnect any time by repeating Step 2 with a fresh token.

---

## A quick note on privacy

Your Jira token is serious business, so we treat it that way:

- It's stored **encrypted** on our side (AES-256-GCM), using a key derived from your server's `JWT_SECRET` — meaning even direct access to the database wouldn't reveal it.
- It's **never sent to any AI provider** (not Gemini, not Claude, not GPT). The AI models see your briefs and action items; they never see your Jira token.
- Only the Workforce0 ticket-creation code ever touches the token, and only at the moment it's filing a ticket you've already approved.

If you're self-hosting Workforce0, this all happens on *your* server — no third party is in the loop.
