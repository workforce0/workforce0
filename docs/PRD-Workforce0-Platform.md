# Product Requirements Document
## Workforce0: Open-Source AI Workforce Platform

| Field | Value |
|-------|-------|
| **Document Version** | 3.0 (OSS pivot) |
| **Date** | 2026-04-18 |
| **Status** | Living document |
| **License** | MIT |

> This PRD replaces the v2.9 SaaS-era PRD. The earlier document planned for multi-tenant SaaS with billing tiers; this one describes Workforce0 as an open-source, self-hosted product.

---

## 1. Executive Summary

**Workforce0 turns meetings into finished work.** You paste a transcript (or dial in by phone), AI generates a brief, you approve it, and downstream work — Jira tickets, pull requests, follow-ups — executes automatically.

It is **open source under the MIT license** and **self-hosted**. Users `git clone`, supply their own AI provider keys (BYOK: Gemini, Claude, GPT), and run the stack on their own infrastructure via Docker Compose or a one-click deploy.

The target user is a **non-technical executive** — typically a VP/Director of Product. The OSS pivot does not relax that target; it raises the bar, because non-dev users now reach the product through one-click deploys and in-app wizards rather than a signup form.

---

## 2. Problem

Product leaders spend 60–70% of their time on communication overhead: summarizing meetings, writing briefs, assigning work, following up, checking status. Existing tools either:

- **Record meetings** (Otter, Fireflies) — but stop at the transcript.
- **Manage tickets** (Jira, Linear) — but require the brief to already exist.
- **Generate briefs** (proprietary AI tools) — but lock data into their cloud and bill per token.

None of them close the loop from conversation to shipped work without a human acting as translator.

---

## 3. Vision

A small product team runs a 30-minute meeting on Friday morning. By the end of the weekend:

1. A structured brief has been generated and approved.
2. Jira tickets have been created and assigned.
3. A draft pull request exists, written by the Dev Agent using the team's codebase conventions.
4. An AI QA review has flagged one edge case in the PR.
5. Follow-ups have been scheduled in Google Chat for the owners.

The human did nothing except approve.

---

## 4. Design principles

1. **Executive-first UX, even though it's OSS.** No config file editing after initial setup. Every integration has an in-app wizard.
2. **BYOK, always.** Never hold the user's AI credentials. Never bill per token. No platform margin on inference.
3. **Approval-first.** Nothing ships without a human click. Every brief, ticket, and PR is reviewed.
4. **Graceful degradation.** Any integration the user hasn't configured disables cleanly. No crashes, no cryptic errors.
5. **Multi-model independence.** All AI calls route through `ModelRegistryService`. Swap providers freely.
6. **Self-hosted by default.** Single-org mode is the default. Multi-tenant code exists but is not exposed.

---

## 5. Target users

### Primary — Product leaders at small-to-mid teams

- VP/Director of Product at 10–200-person companies
- Non-technical, time-poor
- Has an IT/dev teammate who can do the initial install (or uses a one-click deploy)
- Owns the approval decisions

### Secondary — Operators and team leads

- Engineering managers triaging inbound work
- Ops leaders running Gemba walks, safety reviews
- Founder-CEOs of early-stage companies who wear multiple hats

### Tertiary — Self-hosters and hackers

- Open-source enthusiasts who install for fun
- Teams that fork Workforce0 to customize it

---

## 6. Non-goals

- **No SaaS tier.** We will not host paid instances for customers.
- **No proprietary integrations.** If it can't be done with public APIs, we don't build it.
- **No per-token pricing.** Users bring their own keys.
- **No lock-in.** MIT license, Postgres-exportable data, OpenAPI spec.
- **No enterprise SSO as a gate.** SSO support can exist, but the core product must work with password auth out of the box.

---

## 7. Core capabilities

| Capability | v1 scope |
|---|---|
| Meeting ingestion | Paste transcript, upload file (.vtt/.srt/.txt), Google Meet connect, Twilio voice dial-in |
| AI brief generation | Multi-model Council, 20-second target, streaming UI |
| Approval queue | Keyboard-navigable review of briefs, tickets, PRs |
| Integrations | Jira, Google Chat, Google Drive, GitHub, Twilio — all via in-app wizards |
| Local agent | Optional Docker daemon on user's machine, uses their Claude Code / Cursor / Codex subscription |
| BYOK | Gemini (required), Claude + OpenAI (optional) |
| Self-hosted deploy | Docker Compose, Railway/Render/Fly templates |

---

## 8. User journey (first 5 minutes)

1. User clicks a **one-click deploy button** on the GitHub README.
2. Their platform (Railway/Render/Fly) provisions Postgres, Redis, backend, frontend.
3. User gets a URL, clicks **Sign up**, creates the admin account.
4. First-run setup wizard asks: workspace name → AI provider key → first integration.
5. User lands on the dashboard, clicks **Paste transcript**, drops a meeting in.
6. Twenty seconds later, a structured brief appears. User approves.
7. If Jira was connected in step 4, tickets are created automatically.

---

## 9. Key screens (see `docs/stitch-prompts/` for design prompts)

1. Login / signup
2. First-run setup wizard
3. Dashboard (approval banner, meeting counts, activity feed)
4. Meeting detail + AI brief
5. Integration wizard (Jira / Slack / Google Chat / GitHub / etc.)
6. Settings — integrations list
7. Approval queue

---

## 10. Architecture

See [`Workforce0-Technical-Architecture.md`](./Workforce0-Technical-Architecture.md) for the full diagram and request flow.

Summary:
- **Backend:** Fastify + TypeScript + Prisma 7 + PostgreSQL + Redis
- **Frontend:** Next.js 16 + Radix UI + Tailwind v4
- **AI layer:** `ModelRegistryService` routes to Gemini / Claude / OpenAI (BYOK)
- **Agent:** Local Docker daemon, WebSocket-connected to the hosted backend, uses user's own CLI subscriptions
- **Deploy:** Single `docker-compose.prod.yml` for self-host; platform-specific templates for one-click deploys

---

## 11. Success metrics

For the project (OSS health):
- GitHub stars (north-star for "trending" status)
- Weekly Docker image pulls
- Number of external contributors per release
- Issues closed / opened ratio

For the product (user outcomes):
- Time from meeting to approved brief (target: < 2 minutes)
- First-pass brief approval rate (target: > 90%)
- Active integrations per install (target: > 2 median)
- Weekly active users per install (target: > 3 median)

---

## 12. Release plan

### v1.0 — OSS launch (target: Q2 2026)

- [ ] Strip billing routes and Stripe references from `mvp/`
- [ ] Rewrite settings UI to route through in-app integration wizards
- [ ] First-run setup wizard (steps 1–4 per Stitch prompt 01)
- [ ] One-click deploy templates for Railway, Render, Fly published
- [ ] `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE` (all done)
- [ ] CI green on `main`
- [ ] Stitch-designed UI shipped for login, dashboard, meeting brief, integrations

### v1.1

- [ ] Slack integration (parity with Google Chat)
- [ ] Notion and Linear integrations
- [ ] Approval queue polish (Stitch prompt 07)
- [ ] Mobile-friendly responsive pass

### v1.2

- [ ] i18n scaffolding (English + one translation as reference)
- [ ] Granular role-based access control
- [ ] Backup/restore CLI

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| "OSS repo, but scary to install" | One-click deploys, 5-minute quickstart, polished README |
| Non-dev execs can't self-host | Explicit targeting of "have your IT friend install once" + one-click paths |
| BYOK adds friction | Free Gemini tier means most users need zero payment to start |
| Community support burden on maintainers | Discord + Discussions + issue templates to channel requests |
| Forks fragment the ecosystem | MIT license accepts this; keep core small so forks stay compatible |

---

## 14. Open questions

- Do we offer a managed "demo" cloud that's wiped daily, for execs to try before self-hosting?
- How do we handle upgrades for users who deployed via one-click buttons (auto-redeploy vs. manual)?
- Should we publish an "awesome-workforce0" list of community integrations?

---

## 15. Changelog

- **v3.0 (2026-04-18):** Pivoted from SaaS to OSS. Removed billing, tier structure, multi-tenant-as-default, revenue model, legal/liability section. Added BYOK, self-hosting, one-click deploy sections. Docs now reference `docs/stitch-prompts/` for UI design.
- **v2.9 (2026-01-25):** Final SaaS-era PRD. Archived at git tag `prd-v2.9-saas` (if preserved).
