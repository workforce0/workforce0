# Contributor Catalog

> Every pluggable piece of Workforce0, one index per domain. If you want to **use**, **extend**, or **replace** something, start here.

| Catalog | What's inside | Typical contributor |
|---|---|---|
| [**Integrations**](./integrations.md) | Every third-party connector — Jira, Slack, GitHub, Google, Twilio, etc. Wiring, env vars, file paths, and "how to add a new one". | Building a new connector. Fixing one that drifted. |
| [**AI providers**](./ai-providers.md) | Every AI model/provider wired through `ModelRegistryService`. How to plug in a new one (Mistral? Groq? local Ollama?) without touching a single agent. | Adding a model. Swapping defaults. BYOK UI work. |
| [**Agents**](./agents.md) | Every AI agent (BA, Architect, Dev, QA, Supervisor, Memory Optimizer, Meeting Brain). What it does, what tools it has, how to extend it. | Adding an agent step. Changing prompts. Adding tools. |

## Ground rules for all three

1. **Never import a provider SDK directly in product code.** Go through `ModelRegistryService` (AI) or the integration service layer. This keeps Workforce0 provider-agnostic.
2. **Graceful degradation is mandatory.** Every integration must disable cleanly when the required keys/env are absent. No crashes. No red error banners on the dashboard.
3. **BYOK first.** Credentials live in the backend's AES-256-GCM-encrypted credential pool (`backend/src/services/model-registry/credential-pool.ts`) or in `IntegrationConnection` rows — never in code.
4. **Tests are required for every new pluggable piece.** Service-level unit tests + at least one integration test. See existing tests as templates.

## Repo map for plug points

```
backend/src/services/
├── model-registry/            ← AI providers register here
│   ├── model-registry.service.ts
│   ├── model-catalog.ts       ← catalog of supported models
│   ├── credential-pool.ts     ← encrypted BYOK keys per tenant
│   └── default-models.ts      ← which provider/model each agent uses
├── agent-runtime/clients/     ← provider-specific SDK wrappers
│   ├── anthropic-client.ts
│   ├── google-client.ts
│   └── openai-client.ts
├── agents/                    ← one folder per agent
│   ├── ba/                    ← BA agent (brief generation)
│   ├── dev/                   ← Dev agent (code generation via Dev tools)
│   ├── qa/                    ← QA agent
│   ├── supervisor/
│   ├── meeting-brain/
│   ├── memory-optimizer/
│   └── skills/                ← shared foundation skills
├── agent/
│   ├── architect.service.ts   ← Architect agent (design from PRD)
│   └── ba-agent.service.ts    ← legacy BA entry point (kept for compat)
├── integrations/              ← third-party API connectors
│   ├── jira.service.ts
│   ├── gchat.service.ts
│   ├── gdocs.service.ts
│   ├── github.service.ts
│   ├── google-oauth.service.ts
│   └── integration-connection.service.ts
├── communication/channels/    ← outbound message channels
│   ├── email.channel.ts
│   ├── slack.channel.ts
│   ├── sms.channel.ts
│   ├── teams.channel.ts
│   └── whatsapp.channel.ts
├── voice/                     ← Twilio + Gemini Live voice bot
│   ├── twilio-voice.service.ts
│   └── twilio-media-handler.ts
├── auth/workos.service.ts     ← SSO
└── storage/s3.service.ts      ← meeting audio uploads
```

---

## When in doubt

- Search the existing tests — they're the clearest spec for every service.
- Ask in [Discussions](https://github.com/workforce0/workforce0/discussions) before writing a new catalog entry.
- Open a draft PR early. Reviewers can redirect design before you've written 500 lines.
