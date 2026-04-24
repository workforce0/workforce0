# Contributing to Workforce0

First — thank you. Workforce0 is open source because the best teams we know build in the open. Every issue, PR, and idea moves us forward.

## Ways to contribute

- **Build an integration.** Slack, Notion, Linear, Asana, Salesforce — if your tool has an API, we want to wire it up.
- **Polish the UI.** Our target user is a non-technical executive. If you see a rough edge, file an issue or open a PR.
- **Fix a bug.** Check [open issues](https://github.com/workforce0/workforce0/issues) labeled `good first issue`.
- **Improve the docs.** Clear docs are the difference between a 5-minute setup and a 50-minute one.
- **Translate.** We're building toward i18n — new locales welcome.

## Before you start

Please read:
- [`AGENTS.md`](./AGENTS.md) — architecture rules, coding standards, service-layer pattern
- [`CLAUDE.md`](./CLAUDE.md) — product direction (executive-first, even though repo is OSS)
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — be excellent to each other

### Catalogs (the contributor's index)

Every pluggable piece of Workforce0 has a catalog entry. Read the right one **before** writing code — it tells you the existing pattern, the required tests, and the documentation you'll need to ship:

- [`docs/catalog/integrations.md`](./docs/catalog/integrations.md) — Jira, Slack, GitHub, Google*, Twilio, SendGrid, Teams, Linear, Notion, WorkOS, S3. How to add a new one.
- [`docs/catalog/ai-providers.md`](./docs/catalog/ai-providers.md) — Gemini, Claude, OpenAI via `ModelRegistryService`. How to add a new provider (Mistral, Groq, local Ollama…) without touching a single agent.
- [`docs/catalog/agents.md`](./docs/catalog/agents.md) — BA, Architect, Dev, QA, Supervisor, Memory Optimizer, Meeting Brain. How they're wired, what tools they call, how to extend.

## Local setup

```bash
git clone https://github.com/workforce0/workforce0.git
cd workforce0
cp backend/.env.example .env
# Paste your Gemini key — everything else is optional
docker compose -f docker-compose.prod.yml up -d postgres redis
cd backend && npm install && npm run db:migrate && npm run dev
# in another terminal
cd frontend && npm install && npm run dev
```

Visit **http://localhost:3001**.

## Development workflow

1. **Open an issue first** for anything larger than a typo. It saves you from building something we'd rather ship differently.
2. **Fork and branch.** Name branches `feat/<short>`, `fix/<short>`, `docs/<short>`.
3. **Write tests.** 80%+ coverage is the bar. TDD if you can.
4. **Match the style.** ESLint + Prettier run in CI. `npm run lint` before pushing.
5. **Small PRs.** Under 500 lines changed is ideal. Split bigger changes into stacked PRs.

## Commit format

```
<type>: <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

Example: `feat: add Slack integration wizard`

## Adding a new integration, AI provider, or agent

Full walkthroughs with code templates live in the catalogs — don't skip them:

- **New integration** (Notion, Linear, Asana, etc.) → [`docs/catalog/integrations.md#how-to-add-a-new-integration`](./docs/catalog/integrations.md#how-to-add-a-new-integration)
- **New AI provider** (Mistral, Groq, Ollama, etc.) → [`docs/catalog/ai-providers.md#how-to-add-a-new-ai-provider`](./docs/catalog/ai-providers.md#how-to-add-a-new-ai-provider)
- **New agent** (rare) → [`docs/catalog/agents.md#how-to-add-a-new-agent`](./docs/catalog/agents.md#how-to-add-a-new-agent)

Each walkthrough lists the exact artifacts you need to ship (service, route, UI wizard, setup doc, tests, catalog entry). Start from an existing one (`jira` for integrations, `ba` for agents) as a template — copy its folder layout and adapt.

## PR review

- CI must pass (lint, typecheck, tests)
- At least one maintainer review required
- We use [semantic versioning](https://semver.org) — breaking changes need a note in `CHANGELOG.md`

## Questions?

- [GitHub Discussions](https://github.com/workforce0/workforce0/discussions) for ideas and questions
- [Discord](#) for real-time chat
- Tag issues with `help wanted` if you want to pick them up

Welcome aboard.
