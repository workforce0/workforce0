---
title: GitHub
description: Code context for engineering briefs. Auto-refresh the project graph on push.
---

## What it does

Two separate features, both optional:

1. **Project graph source.** Point Workforce0 at a repo checkout; the
   project graph service extracts files / classes / functions / call
   edges. God-nodes feed the planner's prompt so engineering briefs
   target the parts of the repo that actually matter.
2. **Push-webhook auto-refresh.** When a merge to the default branch
   lands on GitHub, the graph rebuilds automatically.

## Project graph setup (first build)

1. Clone the target repo to a path on the Workforce0 host:
   ```bash
   git clone git@github.com:acme/mobile-app /srv/repos/mobile-app
   ```
2. In Workforce0 UI → **Code Graph → Build graph**.
3. Paste the path (`/srv/repos/mobile-app`) and the repo label
   (`acme/mobile-app` — must match the GitHub `owner/name` form).
4. Click **Build now**. First build on a 100k-line repo takes ~20
   seconds.

See [Project Graph](/features/project-graph/) for what the graph
contains.

## Push-webhook auto-refresh setup

1. **GitHub side**
   - Repo → **Settings → Webhooks → Add webhook**.
   - Payload URL: `https://your-workforce0/api/webhooks/github`.
   - Content type: `application/json`.
   - Secret: paste the value of `GITHUB_WEBHOOK_SECRET` from your
     `.env` (generate with `openssl rand -hex 32` if unset).
   - Events: **Just the push event**.

2. **Workforce0 side**
   - `.env`: `GITHUB_WEBHOOK_SECRET=<match>`.
   - Restart backend.
   - Merge a PR; check that **Code Graph** shows a fresh **Last
     built** timestamp.

Only merges to the default branch trigger rebuilds (feature branches
would thrash the graph).

## Private vs public repos

The project graph build reads the local checkout. The host's filesystem
permissions are the only thing that matters — we never make API calls
to GitHub for code content. Private repos work out-of-the-box as long
as the clone is up-to-date.

## Multiple repos per project

A Workforce0 project can own multiple repo graphs. Each graph is keyed
on `(tenantId, projectId, repoLabel)`. Fan out as many as you like;
god-nodes are aggregated across repos when the planner reads them.

## GitHub App (roadmap, not yet shipped)

A GitHub App (vs webhook-only) would give us:

- Auto-clone on first setup.
- PR review comments.
- Issue sync similar to Jira.

Not yet shipped. Track issue
[#gh-app](https://github.com/workforce0/workforce0/issues).

## Troubleshooting

| Symptom                            | Fix                                             |
| ---------------------------------- | ----------------------------------------------- |
| Webhook rebuild fires, nothing updates | `repoLabel` on the ProjectGraph row doesn't match the GitHub `owner/name`. |
| Webhook 401 / bad signature        | `GITHUB_WEBHOOK_SECRET` on both sides doesn't match. |
| First build hangs > 1 minute       | Large repo + slow disk. Usually finishes; watch `backend` logs. |
| Graph is empty                     | Extractors only know TS/JS/Python today. See [Project Graph](/features/project-graph/). |
