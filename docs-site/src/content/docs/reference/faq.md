---
title: FAQ
description: Questions we answer often.
---

## General

### Is this a SaaS? Can I sign up somewhere?

No SaaS. Workforce0 is software you clone and run. A hosted tier may
come eventually; not yet.

### Do I have to give you any data?

No. We have no backend. Your install talks to your Postgres and the
providers you give it keys for.

### How is this different from `<other AI product>`?

- We don't host. You host.
- We don't mark up tokens. You pay providers directly.
- We optimise for a split audience (installer + exec consumer).
- We ship an audit UI, not a chat UI.

### Is it free?

MIT-licensed software is free. You pay providers for their APIs
(BYOK). Your hardware / hosting too.

### Does it phone home?

No. No telemetry. No "check for updates" hitting a central server.
Zero outbound traffic that isn't a BYOK provider call, a configured
integration, or an update you explicitly install.

## BYOK

### Which provider should I start with?

**Gemini free tier.** Free, generous enough for evaluation, no
credit card. Upgrade to Anthropic or OpenAI once you commit.

### Can I mix providers?

Yes — see [AI Council](/features/ai-council/). Recommended for
production.

### Can I run it on local models only?

Yes — specialists can route to Ollama / vLLM entirely. The planner
is best on a frontier model; local 13B / 70B models produce plans
but often need more revisions. See [Local models](/byok/local-ollama/).

### Will I hit rate limits?

Tier-1 limits on Anthropic / OpenAI are modest. Medium teams should
upgrade to tier 2+. Gemini's free tier has 15 req/min — fine for
small teams.

### Can I run Workforce0 entirely on subscriptions?

Dev / QA tickets can use your Claude Code / Cursor subscription
locally (via the agent daemon). Planner calls cannot — they require
API-level access. Pair a cheap API key (Gemini free tier) with your
local CLI subscription for near-zero spend.

## Deployment

### Can I deploy on one VM?

Yes. `docker compose up`, ~4 GB RAM, Caddy in front. Works for a
single team.

### What's the recommended production shape?

Backend + frontend on a small VM / pair; Postgres + Redis on a
managed service. HTTPS terminator in front (Cloudflare Tunnel is
zero-config).

### Does it work behind a corporate proxy?

Yes — set `HTTP_PROXY` / `HTTPS_PROXY` env vars. All outbound calls
respect them.

### Can I run it air-gapped?

Not fully. BYOK AI calls go to the internet by design. Local models
(Ollama) let you air-gap inference, but transcription (Whisper) and
integrations (Slack, etc) still need network.

### Multi-region?

Sort of — the backend is stateless so you can run replicas in
multiple regions pointing at a central Postgres. Queue (Redis) wants
to be close to the backend. Most teams don't need multi-region.

## Privacy

### Who sees our data?

- **You**: everything.
- **The AI providers you configure**: whatever's in the prompts
  (transcripts, briefs, code context).
- **Your integrations** (Slack, Jira, Drive): whatever the
  integration touches.
- **Us (Workforce0 maintainers)**: nothing. We don't run your instance.

### Can I opt out of provider training?

Anthropic / OpenAI paid tiers don't train on your data by default.
Gemini's free tier MAY — upgrade to paid if this matters. Each
provider's page documents details.

### Does Whisper keep my audio?

OpenAI's Whisper: retention per their policy (minimal). Local
Whisper: nothing beyond your disk.

### Is PII handled specially?

We don't special-case PII detection. Transcripts often contain it;
briefs do too. Treat your install like any system with sensitive data
— access control, encryption at rest, backup encryption.

## Features

### Does it replace my PM / engineer?

No. It decomposes, dispatches, and tracks. Specialists (BA,
architect, dev, QA) do the typing but humans approve and review.

### Can I customize roles?

Yes. **Settings → Roles → (pick) → Edit prompt**. Changes are
tenant-scoped and effective immediately.

### Can I write my own integration?

Yes. See [Adding an integration](/contributing/adding-integration/).

### Does it integrate with `<tool X>`?

Check [Integrations](/integrations/jira/). If not there, write a PR
or open an issue.

### Can I use it for personal task management?

Technically yes. The exec UX is tuned for team-level decision making
— overkill for personal todos. Use Todoist.

## Contributing

### Can I submit a PR?

Yes. See [Contributing](/contributing/development/).

### What PRs are most wanted?

- Language extractors for the project graph (Go, Rust, Java).
- Additional integrations (Linear, Asana, Notion).
- Better docs.
- Bug fixes 🙏.

### How do I get help?

- Open a GitHub issue.
- Join the community Slack (link in the repo README).
- For security issues: `security@workforce0.dev` (PGP key in repo).
