# GitHub Integration Setup Guide

## Overview

This lets Workforce0 open pull requests on your behalf. Once connected, your AI Dev Agent can take an approved brief, create a branch in your repository, and open a pull request that your team can review — all without you touching a terminal.

---

## What you'll need

Before you start, make sure you have:

- A **GitHub account** (free or paid — either works)
- **Admin access** to the repository (or repositories) you want Workforce0 to work in
- About **5 minutes**

If the repo lives inside a GitHub organization, you may need the org owner to approve access. We'll flag that at the right step.

---

## Choose your token type

GitHub offers two kinds of access tokens. Pick one before you start.

### Fine-grained token (recommended)

- **Best for:** most users, especially teams and organizations
- Scoped to specific repositories you choose
- Expires on a shorter schedule you control
- Safer — narrower permissions, clearer audit trail

### Classic token

- **Best for:** quick testing, or when fine-grained tokens don't work with your org
- Broader access (all repos your account can see)
- Older format, still fully supported

**Our recommendation:** start with fine-grained. Only fall back to classic if your organization requires it (see Troubleshooting).

---

## Step 1: Create a fine-grained token

1. Go to **[github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)**

   You'll need to re-enter your GitHub password — this is normal.

   ![](./images/gh-01-new-token.png)

2. **Name your token** — type `Workforce0` in the "Token name" box.

   Pick something recognizable. You'll see this name every time you review your tokens.

3. **Set an expiration** — choose **90 days** from the dropdown.

   Shorter expirations are safer. Workforce0 will warn you before the token expires so you can rotate it.

   ![](./images/gh-02-expiration.png)

4. **Choose repository access** — pick **"Only select repositories"**, then use the dropdown to select the repos you want Workforce0 to work in.

   You can add more repos later by editing the token.

   ![](./images/gh-03-repo-access.png)

5. **Set permissions** — scroll to "Repository permissions" and set these three:

   | Permission | Access |
   |------------|--------|
   | **Contents** | Read and write |
   | **Pull requests** | Read and write |
   | **Metadata** | Read (usually auto-enabled) |

   Leave everything else on "No access". Less is safer.

   ![](./images/gh-04-permissions.png)

6. **Click "Generate token"** at the bottom of the page.

7. **Copy the token now** — it starts with `github_pat_...` and you'll only see it once.

   GitHub won't show it again. If you lose it, you'll need to make a new one.

   ![](./images/gh-05-copy-token.png)

---

## Step 2: Connect in Workforce0

1. Open Workforce0 and go to **Settings** → **Integrations**
2. Find **GitHub** in the list and click **Connect**
3. Paste the token you just copied into the "Token" field
4. Click **Test connection**

You'll see a green checkmark if it worked:

> **Connected!** We can see 3 repositories.

If you see a red error, jump to the Troubleshooting section below.

---

## Step 3: Pick a default repository

After the connection test succeeds, you'll see a dropdown listing every repo your token can access.

1. Choose the repository where you want Workforce0 to open pull requests by default
2. Click **Save**

You can change this later, or override it on individual briefs.

---

## Optional: Install GitHub CLI on your agent host

If you're running the Workforce0 agent on your own machine (self-hosted), installing the GitHub CLI lets the agent push branches and open PRs locally.

**On macOS:**

```bash
brew install gh
```

**On Ubuntu / Debian:**

```bash
sudo apt install gh
```

**Then sign in with the same token:**

```bash
gh auth login
```

When prompted, choose **"Paste an authentication token"** and paste the same `github_pat_...` token you created above.

You only need to do this once per machine.

---

## Troubleshooting

### "Token rejected" or "401 Unauthorized"

- Double-check you pasted the full token (they're long — easy to miss a character)
- Make sure the token hasn't expired (check on [github.com/settings/tokens](https://github.com/settings/tokens))
- Regenerate the token and try again

### "Can't push to branch" or "403 Forbidden"

- Your fine-grained token is likely missing **Contents: write** permission
- Edit the token in GitHub settings, re-check the permissions table above, and save

### "No repositories visible" in the dropdown

- If the repo is inside an organization, your org admin may need to approve the token
- Go to your org's **Settings → Personal access tokens → Pending requests** and approve it
- Or ask your admin to approve it for you

### Fine-grained token doesn't work, but classic token does

- This usually means your organization requires **SAML SSO** on fine-grained tokens
- Either ask your admin to approve SSO for the fine-grained token, or use a classic token instead
- For a classic token: [github.com/settings/tokens/new](https://github.com/settings/tokens/new) — pick scopes `repo` and `read:org`

---

## What Workforce0 creates in your repo

When the AI Dev Agent works on an approved brief, it will:

- Create a branch named `workforce0/<brief-id>` (for example, `workforce0/brief-a1b2c3`)
- Commit changes with descriptive messages
- Open a pull request with the brief's description as the PR body, linking back to the brief in Workforce0

Your team reviews and merges the PR like any other — Workforce0 never merges for you.

---

## Revoking access

You can disconnect at any time.

1. Go to **[github.com/settings/tokens](https://github.com/settings/tokens)** (or personal-access-tokens for fine-grained)
2. Find the token named **Workforce0**
3. Click **Revoke**

The token stops working immediately. You can also remove it from Workforce0 via **Settings → Integrations → GitHub → Disconnect**.

---

## Privacy note

Your token is **encrypted at rest** in Workforce0's database and is only decrypted in memory when the agent needs to clone a repo or push a branch. It never leaves your server and is never sent to any AI model.

If you self-host Workforce0, the token lives on your own infrastructure — we never see it.
