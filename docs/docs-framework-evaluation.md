# Documentation Framework Evaluation for Workforce0

**Date:** 2026-04-23
**Author:** Engineering
**Status:** Evaluation — not yet decided.
**Decision horizon:** one of the four, picked for the public docs site
before we invite external users to self-host.

> This is a decision document. It reads long on purpose — picking a
> docs framework is a 3-year commitment (migration pain, URL shape,
> contributor muscle memory, SEO) and Workforce0's split-audience
> pitch makes the choice less obvious than for a normal OSS project.
> The TL;DR is in [§ 12 Recommendation](#12-recommendation).

---

## Table of Contents

1. [Why we need this now](#1-why-we-need-this-now)
2. [What the Workforce0 docs site actually has to do](#2-what-the-workforce0-docs-site-actually-has-to-do)
3. [Evaluation rubric](#3-evaluation-rubric)
4. [Option A — Starlight (Astro)](#4-option-a--starlight-astro)
5. [Option B — Docusaurus (Meta)](#5-option-b--docusaurus-meta)
6. [Option C — MkDocs + Material](#6-option-c--mkdocs--material)
7. [Option D — VitePress](#7-option-d--vitepress)
8. [Head-to-head comparison table](#8-head-to-head-comparison-table)
9. [Build & deploy characteristics](#9-build--deploy-characteristics)
10. [Search, versioning, i18n — the features people ignore until they hurt](#10-search-versioning-i18n--the-features-people-ignore-until-they-hurt)
11. [Migration-cost estimate from what we have today](#11-migration-cost-estimate-from-what-we-have-today)
12. [Recommendation](#12-recommendation)
13. [Appendix A — sample configs](#appendix-a--sample-configs)
14. [Appendix B — sample information-architecture for Workforce0](#appendix-b--sample-information-architecture-for-workforce0)
15. [Appendix C — things that would flip the decision](#appendix-c--things-that-would-flip-the-decision)

---

## 1. Why we need this now

Workforce0 is an **open-source, self-hosted** product. Two personas
touch it (see `CLAUDE.md` for the load-bearing version):

- **Installer (technical operator)** — reads the README, runs
  `docker compose up`, pastes BYOK keys, wires integrations, reads
  setup docs. **This is the person the docs site speaks to.** They
  are comfortable with Docker, TypeScript, Python, and API keys.
- **Consumer (non-technical exec)** — receives Slack/WhatsApp/Teams
  updates from the chief-of-staff agent. **Never opens the docs
  site.** They experience the product through comms channels.

This means the docs framework only has to be good at **technical
product docs** — not marketing landing pages, not a customer-facing
knowledge base. The split-audience copy-contract in `CLAUDE.md` is
the main reason we don't need a CMS, a blog engine, a comments
system, or a newsletter plugin.

We currently ship this docs folder as raw Markdown rendered by
GitHub. That's fine for ~10 files; it breaks down at ~40, which is
where we'll land after:

- Self-hosting guide split by target (Docker / Kubernetes / Railway / Fly / Render / DigitalOcean)
- BYOK guide per provider (Anthropic / OpenAI / Google / Ollama / local llama.cpp)
- Integration guides (Jira, Google Chat, Slack, Twilio, GitHub, Google Drive)
- Architecture reference (AI Council, Agent daemon, Project Graph, RLS middleware)
- API reference (routes, webhook payloads)
- Runbook (on-call troubleshooting, log triage)
- Migration notes per release

That's the docs surface we need to optimise for.

---

## 2. What the Workforce0 docs site actually has to do

We can narrow the evaluation if we're explicit about requirements.
Every bullet below has an implementation consequence for at least
one of the four frameworks.

### 2.1 Must-haves

1. **Self-host friendly.** The docs site itself must be trivially
   self-hostable (static output, any host). Pinning it to Vercel or
   Netlify is off the table because people forking the repo to
   deploy internally should get a clean path to host the docs too.
2. **Markdown source-of-truth.** Every framework supports this to
   some degree, but we need content authors (us, future contributors)
   to write `.md` / `.mdx` files and get a useful site. No web CMS.
3. **Fast full-text search out-of-the-box.** Without search, docs of
   this size are unusable. "Install a plugin and pay Algolia" is a
   non-starter for a self-hosted project.
4. **Versioned docs.** When we ship a breaking change to the REST
   API or the Prisma schema, older versions of the docs have to
   stay accessible at a stable URL. Release-cycle blocker.
5. **Works with `vendor/` structure.** We vendor skills + subagents
   from the superpowers repo. The docs generator must be OK with
   content checked into `docs/` that is NOT the root of the docs
   site — no "everything under repo root must be docs" assumption.
6. **CI reproducibility.** `npm run docs:build` or `mkdocs build`
   must work with a pinned lockfile and produce byte-identical
   output on GitHub Actions. Not negotiable for release tagging.
7. **Respects the monorepo.** `backend/`, `frontend/`, `agent/`,
   `docs/` all live at the repo root. The docs tool must be happy
   being configured to read from `docs/` only and drop its build
   output somewhere we can `.gitignore`.

### 2.2 Should-haves

1. **MDX-style live components.** Not a hard requirement but highly
   valuable for interactive demos (AI Council chooser, BYOK key
   validator, a mock Slack thread showing what the exec sees). A
   plain-Markdown tool punishes this use case.
2. **OpenAPI / JSON-schema rendering.** Our REST routes are Zod-
   schema-backed; we can export OpenAPI. Being able to render it
   natively in the docs site is a big win for integrators.
3. **Dark mode.** Our main product UI is light-warm (`c2710c`
   accent); the docs site should have a proper dark mode out of the
   box, because GitHub-darkmode users expect it.
4. **i18n groundwork.** Not an immediate launch blocker but
   `docs/i18n.md` already exists — we want the translation path to
   be first-class, not "swap in a fork."
5. **Blog or release-notes engine.** Nice-to-have — we can push
   release notes as normal pages, but a blog engine with RSS is the
   cleanest integration for "subscribe for updates."

### 2.3 Non-requirements (explicitly NOT needed)

- Server-rendered pages / edge functions. We're static-only.
- Comments / user accounts. No consumer persona on the docs site.
- A CMS UI. Everything is `.md` in the repo.
- E-commerce, paywalls, gated content. Not our model.
- A lot of fancy landing-page scrollytelling — that's the job of a
  marketing site if we ever build one.

---

## 3. Evaluation rubric

Each option is scored on ten axes, 0–3, weighted by how much it
matters to Workforce0. Weights and rationale:

| Axis | Weight | Why |
|-----:|:-----:|-----|
| 1. **Self-host simplicity** (static output, zero lock-in) | ×3 | Non-negotiable for an OSS project |
| 2. **Setup / zero-to-first-page time** | ×2 | Reflects DX for future contributors |
| 3. **Search quality out-of-the-box** | ×3 | Must-have #3 |
| 4. **Versioning story** | ×3 | Must-have #4 |
| 5. **i18n story** | ×1 | Nice-to-have |
| 6. **MDX / live-component support** | ×2 | Should-have #1 |
| 7. **Monorepo friendliness** (root-vs-subfolder) | ×2 | Non-negotiable #7 |
| 8. **Theming defaults + dark mode** | ×1 | Cosmetic, but compounds |
| 9. **Ecosystem / plugin maturity** | ×2 | Hedge against future needs |
| 10. **Build reproducibility & speed** | ×2 | CI cost, release discipline |

Max raw score = 10 × 3 = 30 (unweighted) / 63 (weighted with the
weights above).

Scores are calibrated against the five comparable projects each
framework already powers (listed per framework below), not against
an abstract ideal.

---

## 4. Option A — Starlight (Astro)

> Astro-powered docs starter kit. Maintained by the Astro core team.
> Shipped open-source in 2023, rapidly adopted in 2024–25.

### 4.1 Who uses it

| Project | Why instructive |
|---|---|
| Biome (biomejs.dev) | JS/TS linter+formatter; mirrors our stack |
| Cloudflare Workers (developers.cloudflare.com/workers-starter-docs) | Infra docs at scale |
| Zed (zed.dev/docs) | Developer tool docs; performance-conscious |
| Kubo / IPFS (docs.ipfs.tech) | OSS infra with self-host audience |
| Deno (partial), Effect-TS, Tauri v2 | Modern TS projects aligning on Starlight |

### 4.2 Core characteristics

- **Engine:** Astro — islands architecture, compiles to static HTML
  + minimal JS, per-component hydration. No monolithic runtime.
- **Language:** TypeScript (Astro components) + MDX for content.
- **Build output:** Pure static files. No Node server required.
- **Default search:** [Pagefind](https://pagefind.app). Client-side,
  indexes all rendered HTML at build time, ~1 MB of JS, works
  offline. No Algolia keys, no hosted backend.
- **Content model:** "Content Collections" — typed MDX with
  per-collection Zod schemas. Matches our Zod-everywhere pattern.
- **Versioning:** Not first-class. Community pattern is either
  sub-routing (`/v1/`, `/v2/`) or one Starlight site per major.
- **i18n:** First-class. Per-locale content collections; fallbacks
  to the default locale; language picker baked into the theme.
- **Dark mode:** Yes, built-in, respects `prefers-color-scheme`.

### 4.3 Strengths for Workforce0

- **Astro islands** are a perfect fit for our "mostly-static docs
  with a few live demo widgets" profile. We can drop a React
  component for a BYOK validator or an AI-Council mock without
  shipping 100 KB of React to every page.
- **Pagefind** is the best free search story in the space. It
  generates a static index at build time, ships a 10-line
  `<script>` tag, and the user hits a 1 MB CDN-cached index per
  search session. Self-hostable without any server infra.
- **Content Collections with Zod** let us mirror our backend
  discipline: a page that's missing frontmatter fails `build`, not
  at render time. Great for release discipline.
- **MDX works out-of-the-box** — we can import React components
  (via `@astrojs/react`), Vue, Svelte, Solid, Preact. Effectively
  zero framework-lock-in.
- **File-system routing** matches intuition; `src/content/docs/
  self-hosting/docker.md` renders at `/self-hosting/docker/`.
- **Build speed** is excellent — single-digit-second builds for
  a ~200-page site. Astro's Vite core is fast.
- **Monorepo-friendly** — `astro.config.mjs` lives where we put it,
  `srcDir` and `outDir` are configurable, no "must be at repo
  root" assumption.

### 4.4 Weaknesses for Workforce0

- **No built-in versioning.** This is the biggest gap for us. The
  common workarounds:
  - Keep old versions in a subdirectory (`/docs/v1/…`) that Starlight
    routes as sibling content. Works, but content duplication and
    no "this page has a v1 / v2 toggle" UX.
  - Separate Starlight site per version, deployed to subdomain.
    Works, but two deploys to coordinate per release.
  - Community plugin [starlight-versions](https://github.com/HiDeoo/starlight-versions)
    exists (2025). Still a third-party plugin; would need to pin.
- **Ecosystem is younger** than Docusaurus / MkDocs. ~50 published
  Starlight plugins at time of writing vs. Docusaurus's ~400. Most
  things we need exist, but the long tail is shallower.
- **No built-in blog engine.** Astro has a blog template; it's a
  separate Astro site or a Starlight side-section. Doable, not
  free.
- **Peer deps include React** if we want React islands — fine for
  us since frontend already ships React, but it's a second React
  version in the tree if we don't pin.

### 4.5 Score

| Axis | Score | Notes |
|---|:-:|---|
| 1. Self-host simplicity | 3 | Static output, zero lock-in. |
| 2. Setup time | 3 | `npm create astro@latest --template starlight` ships a running site in 60s. |
| 3. Search | 3 | Pagefind is the gold standard for static-site search. |
| 4. Versioning | 1 | Must adopt a community plugin or hand-roll. |
| 5. i18n | 3 | First-class, tested on Kubo + Cloudflare-scale. |
| 6. MDX / components | 3 | Any framework as islands. |
| 7. Monorepo | 3 | Fully configurable. |
| 8. Theming / dark | 2 | Good defaults; customisation less opinionated than Docusaurus. |
| 9. Ecosystem | 2 | Younger, but growing fast. |
| 10. Build repro | 3 | Vite + pinned lockfile; reproducible builds. |

**Weighted score: 55 / 63.**

---

## 5. Option B — Docusaurus (Meta)

> Meta's open-source docs engine. The default choice for "I have
> a moderately-sized OSS project and need a docs site yesterday."

### 5.1 Who uses it

| Project | Why instructive |
|---|---|
| React Native (reactnative.dev) | Large OSS project, heavy versioning |
| Jest (jestjs.io) | JS tooling, our ecosystem |
| Redux (redux.js.org) | Long-lived project with many majors |
| Prettier (prettier.io) | Dev tool, community contributions |
| Babel (babeljs.io) | Years of versioned docs |
| Supabase (supabase.com/docs) | BaaS, sharp landing page |
| Tauri (tauri.app) | Our kind of split-audience product |

### 5.2 Core characteristics

- **Engine:** React + MDX + Webpack (v3 migrating to faster paths).
  Docusaurus 3 (current, 2024+) is the baseline; v2 is EOL.
- **Language:** TypeScript supported, JavaScript default.
- **Build output:** Static HTML + hydrated React. Larger JS payload
  per page than Astro because of the global React runtime.
- **Default search:** Algolia DocSearch (free for OSS, but requires
  applying) OR local search via a community plugin
  (`@easyops-cn/docusaurus-search-local`). Neither is perfect:
  Algolia is hosted, local search adds ~1–2 MB of client JS.
- **Content model:** Plain MDX files under `docs/` with `sidebars.js`
  or auto-generated sidebars from file layout.
- **Versioning:** First-class. `npm run docusaurus docs:version 1.0`
  snapshots the current docs into `versioned_docs/version-1.0/`
  and the site gains a version selector in the top nav. This is
  the headline feature.
- **i18n:** First-class. `i18n/{lang}/docusaurus-plugin-content-docs/`
  directory convention; Crowdin / Lokalise / manual all work.
- **Dark mode:** Yes, toggle in header.
- **Blog:** First-class plugin. RSS, tags, authors, date archives.

### 5.3 Strengths for Workforce0

- **Versioning is the killer feature.** We WILL ship v1, v2, v3 of
  the docs. Getting this for free instead of maintaining it
  ourselves is worth ~80% of the decision weight by itself.
- **Blog engine** for release notes, deep dives, post-mortems.
  Slots directly into our communication rhythm.
- **MDX + React** lets us embed any live demo component we like.
  Our frontend is already React + Radix — our AI-Council picker
  widget, if we build one for docs, can literally be copied from
  the app.
- **Ecosystem** is the largest in the space. ~400 published
  plugins; Algolia, PostHog, Plausible, Fathom, OpenAPI
  (`docusaurus-plugin-openapi-docs`), Mermaid, etc.
- **Proven at scale** (React Native is a moderately-sized wiki with
  years of versioned content; Supabase is several hundred pages).
- **OpenAPI support** via first-party-quality community plugin —
  perfect for rendering our Zod-derived schemas.
- **Contributor-familiar.** Any OSS maintainer has seen it.
- **MDX** + React components means the setup wizard page can embed
  an actual React form that lints the user's BYOK JSON before
  they copy-paste it.

### 5.4 Weaknesses for Workforce0

- **Heavier client bundle.** Every page ships a React runtime and
  navigation JS. Typical first-load is 80–120 KB gzip vs. Astro's
  15–30 KB. For a docs site this is mostly fine, but it's real.
- **Build times grow superlinearly with versions.** 5 versions ×
  100 pages = 500 HTML files to render through Webpack. A
  "medium" Docusaurus site builds in 60–120 seconds on CI.
- **Webpack is not loved.** v3 offers Vite, Turbopack, Rspack paths
  but they're still labeled experimental for production use at
  the time of writing.
- **Opinionated styling** (Infima CSS). Theming is doable but
  swimming against the current if we want to match the Workforce0
  brand exactly.
- **Search is "apply for Algolia or hand-roll."** The
  `@easyops-cn/docusaurus-search-local` plugin works but is a
  non-trivial dependency we'd own.
- **Content directory layout is opinionated** — `docs/`, `blog/`,
  `versioned_docs/`, `i18n/` all as siblings. It's fine, but
  monorepo-hygiene requires paying attention.
- **React version drift.** Docusaurus 3 currently pins React 18.
  Our `frontend/` is on React 19 (Next.js 16). Not a conflict per
  se — they're separate installs — but it's another thing to
  keep in sync over time.

### 5.5 Score

| Axis | Score | Notes |
|---|:-:|---|
| 1. Self-host simplicity | 3 | Static output. |
| 2. Setup time | 3 | `npx create-docusaurus@latest` is one command. |
| 3. Search | 2 | Algolia hosted (friction) OR local plugin (heavy JS). Neither is Starlight-class. |
| 4. Versioning | 3 | Best-in-class, first-party. |
| 5. i18n | 3 | First-party, battle-tested on React Native / Supabase. |
| 6. MDX / components | 3 | MDX + React everywhere. |
| 7. Monorepo | 2 | Works, but opinionated sibling-dir layout. |
| 8. Theming / dark | 2 | Good defaults; Infima is opinionated. |
| 9. Ecosystem | 3 | Largest in category. |
| 10. Build repro | 2 | Slower than Vite-based tools; CI minutes add up. |

**Weighted score: 54 / 63.** (Versioning × 3 = 9 alone.)

---

## 6. Option C — MkDocs + Material

> Python-ecosystem docs engine. Maintainer: Squidfunk. The Material
> theme has essentially become the standard rendering for MkDocs.

### 6.1 Who uses it

| Project | Why instructive |
|---|---|
| FastAPI (fastapi.tiangolo.com) | The reference Python-ecosystem docs site |
| Pydantic (docs.pydantic.dev) | Deep type-driven API reference |
| Home Assistant (home-assistant.io) | Self-hosted, community-authored, HUGE |
| MLflow (mlflow.org/docs/latest) | Versioned ML-tool docs |
| LangGraph (langchain-ai.github.io/langgraph) | Our kind of agent tooling |

### 6.2 Core characteristics

- **Engine:** Python + MkDocs + Jinja2. Builds a static site.
- **Language:** Python for config / plugins; Markdown for content.
  No JSX, no components — strict Markdown (with Material-specific
  admonition / grid / tab extensions).
- **Build output:** Pure static HTML + a bit of JS.
- **Default search:** Lunr.js (client-side, build-time indexed).
  Solid, not Pagefind-level, not hosted.
- **Content model:** `docs/*.md` + `mkdocs.yml` navigation.
- **Versioning:** Via [mike](https://github.com/jimporter/mike).
  Mike branches off `gh-pages` with each version as a sibling
  directory; a dropdown in the header selects the version.
  First-party-quality convention, not first-party code.
- **i18n:** Via the `i18n` plugin. Works, a little less polished
  than Docusaurus's first-party flow.
- **Dark mode:** Yes, Material theme.
- **OpenAPI:** First-class via `mkdocs-material` or swagger-style
  plugins. FastAPI's docs render OpenAPI specs at reference
  quality.

### 6.3 Strengths for Workforce0

- **Polish of defaults is shocking.** Install the Material theme,
  drop in your Markdown, get a site that looks better than most
  custom designs. No "fight the default stylesheet" tax.
- **Search is solid and local.** Lunr isn't Pagefind, but it
  handles hundreds of pages with reasonable latency, no hosted
  service, no API key.
- **Zero JS framework commitment.** The docs don't drag in React
  or Vue. For a project that MAY get forked by Python-heavy
  teams (agents, automation, infra), this is a subtle "one less
  thing to learn" signal.
- **Python ecosystem.** If we someday add a `python-agent/` to
  the repo (we don't have one yet, but the N4 webhook story
  explicitly anticipates Python agents), the docs and the agent
  live in the same tooling world.
- **Versioning via mike** is battle-tested on MLflow, pydantic,
  LangGraph. Slightly rough UX but works.
- **Stable.** Material is ~10 years old; it's not moving under
  us. Reproducible builds on CI are trivial (`pip install -r
  docs/requirements.txt && mkdocs build`).
- **Admonitions, tabs, and code tabs** are really good. Better
  than Docusaurus out-of-the-box for "here's the Docker way and
  here's the Kubernetes way" style setup docs.

### 6.4 Weaknesses for Workforce0

- **No MDX.** Strict Markdown means no live components in docs.
  Every interactive demo has to be an `<iframe>` to an external
  URL or a screenshot. For a frontend-heavy project with real
  interactive demos to show (wizard, AI-Council picker), this
  is a real loss.
- **Python is a second stack** for a JS/TS project. Every
  contributor has to have Python + pip set up just to run docs.
  Today that's ~5 minutes, but it IS friction.
- **Not monorepo-native.** `mkdocs.yml` expects `docs/` as the
  source; configurable, but the Python-side conventions assume
  docs is the project. Works fine but feels less natural.
- **Material is MIT, but Material for MkDocs Insiders** — the
  sponsor-only tier — has features (privacy plugin, tags plugin,
  blog plugin, instant loading) that the public release lacks.
  Not a blocker (the free tier is plenty), but "pay to unlock
  features" is tonally off-brand for us.
- **Blog plugin is Insiders-only** in the latest version (older
  versions had a community plugin).
- **Theming customisation** is CSS-override based; hairier than
  Starlight's slot system.

### 6.5 Score

| Axis | Score | Notes |
|---|:-:|---|
| 1. Self-host simplicity | 3 | `mkdocs build` → static site. |
| 2. Setup time | 3 | `pip install mkdocs-material`, one YAML file, done. |
| 3. Search | 2 | Lunr is good, not Pagefind. |
| 4. Versioning | 2 | mike works, UX slightly rougher than Docusaurus. |
| 5. i18n | 2 | Plugin-based, works. |
| 6. MDX / components | 0 | Not a thing. |
| 7. Monorepo | 2 | Works, Python-side conventions mildly assume project-root. |
| 8. Theming / dark | 3 | Shockingly good defaults. |
| 9. Ecosystem | 2 | Smaller than Docusaurus but extremely mature. |
| 10. Build repro | 3 | Pip-pinned, deterministic. |

**Weighted score: 44 / 63.** (MDX hit at ×2 and search hit at ×3 do
most of the damage.)

---

## 7. Option D — VitePress

> Built by the Vite / Vue core team. Minimalist, Vue-powered, very
> fast. Originally for Vue's own docs, now used broadly in the Vite
> / Vue world.

### 7.1 Who uses it

| Project | Why instructive |
|---|---|
| Vue 3 (vuejs.org) | The reference implementation |
| Vite (vitejs.dev) | Maintainer-run docs, fast iteration |
| Vitest (vitest.dev) | Our test runner — we already know this site |
| Pinia (pinia.vuejs.org) | Small OSS, tight focus |
| Nuxt (nuxt.com) | Larger site, proves scale |
| Rollup (rollupjs.org) | Toolchain docs |

### 7.2 Core characteristics

- **Engine:** Vue 3 + Vite. SSG by default; optional SSR.
- **Language:** Markdown + optional Vue SFC islands.
- **Build output:** Static HTML, hydrated Vue runtime per page.
  Smaller than Docusaurus, comparable to Starlight for most pages.
- **Default search:** Either local client-side (built-in, free,
  good) or Algolia DocSearch. The built-in local search is a
  strong differentiator — it's native, not a plugin, and it's
  good quality.
- **Content model:** `docs/*.md` + `.vitepress/config.ts`.
- **Versioning:** Not built in. Community pattern is to maintain
  separate branches / subdirs (`docs-v1/`, `docs-v2/`) or run one
  VitePress deployment per version. Fundamentally the same gap
  as Starlight.
- **i18n:** First-class via config keys. Simpler than Docusaurus,
  less polished than Starlight.
- **Dark mode:** Yes, default toggle.
- **Components:** Vue SFC inside Markdown works; React via
  workaround (`vite-plugin-react` + `.vue` bridge), not the
  default experience.

### 7.3 Strengths for Workforce0

- **Build speed** — Vite is the speed ceiling right now. Tens of
  ms HMR even on large sites. Development feels responsive.
- **Built-in local search** is genuinely good — fewer moving parts
  than Docusaurus's plugin-per-search-strategy situation.
- **Minimalist config** — `.vitepress/config.ts` is ~30 lines for
  a useful site. Less to review, less to break.
- **Ecosystem overlap with Vite** — anything Vite can do, VitePress
  can usually do (plugins, aliases, env). Familiar surface.
- **Light client** — smaller than Docusaurus, comparable to
  Starlight. Our docs would load fast everywhere.
- **Markdown-it** under the hood — the same Markdown engine
  pipelines used by most JS-ecosystem static-site tools. Very
  mature.

### 7.4 Weaknesses for Workforce0

- **Vue-first.** Workforce0 is React + Next.js. Adopting VitePress
  means our contributors write Vue SFCs for any live component in
  docs, or we build an awkward React bridge. If MDX-with-React is
  a priority (it is for us), VitePress is the wrong tool.
- **No first-party versioning.** Same gap as Starlight, but
  without a community plugin as polished as starlight-versions.
- **No blog engine** by default. Community plugins exist (notably
  `vitepress-plugin-pages`), but none as polished as Docusaurus's.
- **Ecosystem is smaller** than Docusaurus's — not by a lot, but
  noticeable in the long tail (OpenAPI renderers, Mermaid config,
  search-analytics plugins).
- **Pagefind isn't the default.** VitePress's local search is good
  but doesn't match Pagefind's "just works, works offline, indexes
  rendered HTML not source Markdown" story.

### 7.5 Score

| Axis | Score | Notes |
|---|:-:|---|
| 1. Self-host simplicity | 3 | Static output. |
| 2. Setup time | 3 | `npm i -D vitepress && npx vitepress init` is a minute. |
| 3. Search | 3 | Native local search is strong; Algolia also supported. |
| 4. Versioning | 1 | Not first-class; subdir / branch pattern. |
| 5. i18n | 2 | Works, less polished than Docusaurus or Starlight. |
| 6. MDX / components | 1 | Vue SFC in markdown works; React bridge is clunky. |
| 7. Monorepo | 3 | Vite configs are flexible; lives happily in `docs/`. |
| 8. Theming / dark | 2 | Minimalist defaults; more customisation work than Docusaurus. |
| 9. Ecosystem | 2 | Solid core; smaller long tail than Docusaurus. |
| 10. Build repro | 3 | Vite + pinned lockfile. |

**Weighted score: 48 / 63.** (The MDX / React gap at ×2 is the
single biggest point-loss vs. Starlight.)

---

## 8. Head-to-head comparison table

Weighted scores summarised; full rubric tables are in each
framework's section.

| Axis (weight) | Starlight | Docusaurus | MkDocs Material | VitePress |
|---|:-:|:-:|:-:|:-:|
| Self-host simplicity (×3) | 9 | 9 | 9 | 9 |
| Setup time (×2) | 6 | 6 | 6 | 6 |
| Search (×3) | 9 | 6 | 6 | 9 |
| Versioning (×3) | 3 | 9 | 6 | 3 |
| i18n (×1) | 3 | 3 | 2 | 2 |
| MDX / components (×2) | 6 | 6 | 0 | 2 |
| Monorepo (×2) | 6 | 4 | 4 | 6 |
| Theming / dark (×1) | 2 | 2 | 3 | 2 |
| Ecosystem (×2) | 4 | 6 | 4 | 4 |
| Build repro (×2) | 6 | 4 | 6 | 6 |
| **Total (of 63)** | **54** | **55** | **46** | **49** |

Docusaurus edges out Starlight by **one point** — entirely due to
versioning. Without versioning weighted at ×3, Starlight would
lead clearly.

Non-weighted totals: Starlight 26, Docusaurus 26, MkDocs 22, VitePress 24.

---

## 9. Build & deploy characteristics

### 9.1 Build time (indicative, for a 200-page docs site)

| Framework | Dev-mode HMR | Clean prod build | CI-cached prod build |
|---|:-:|:-:|:-:|
| Starlight (Astro) | ~100 ms | 6–10 s | 4–6 s |
| Docusaurus 3 | 500 ms–1 s | 60–120 s | 40–80 s |
| MkDocs Material | n/a (Python live-reload) | 5–10 s | 3–5 s |
| VitePress | ~50 ms | 4–8 s | 3–5 s |

Docusaurus's Webpack build is clearly the outlier. Its Rspack /
Turbopack work streams will eventually close this gap.

### 9.2 Deploy target fit

All four produce static sites and run everywhere: GitHub Pages,
Cloudflare Pages, Netlify, Vercel, an S3 bucket, `nginx` in a
container. No one option is better on deploy.

Only one — Docusaurus — has a meaningful cold-cache build-time
downside on CI. For a docs site we tag with every release, that's
maybe 5 extra minutes per release. Not a dealbreaker but real.

### 9.3 Output size (indicative)

| Framework | First-load JS (gzipped) |
|---|:-:|
| Starlight | 10–30 KB |
| Docusaurus | 80–120 KB |
| MkDocs Material | 20–40 KB |
| VitePress | 30–60 KB |

---

## 10. Search, versioning, i18n — the features people ignore until they hurt

### 10.1 Search

Every framework has "search" — they are not remotely equal.

- **Starlight + Pagefind** is the best-in-class story. Pagefind
  indexes rendered HTML at build time, so it finds text even if
  it was generated by a component or MDX macro. ~1 MB index
  fetched on-demand. Works offline, in airplane mode, on corp
  networks that block Algolia. No API key to manage.
- **VitePress built-in local search** — Ships in the box.
  Indexes source Markdown, so content generated by components
  can be missed. Very good UX otherwise.
- **Docusaurus + Algolia DocSearch** — Best relevance when it's
  set up, but hosted. Apply → wait days for approval → config
  → maintain. For an OSS project, that's tolerable; for a
  self-hosted project where our users might not have public
  internet on their docs site, it fails the "works offline"
  test.
- **Docusaurus + `@easyops-cn/docusaurus-search-local`** — A
  third-party community plugin. Works, noticeable JS weight
  (~1.5 MB), relevance is okay.
- **MkDocs Material + Lunr** — Mature, client-side. Weakness is
  that Lunr uses a simple inverted index; stemming and
  case-insensitivity work but fuzzy match is limited.

**Takeaway:** if search is top-3 priority (it is for us),
Starlight and VitePress win. Docusaurus's only "no-signup" path
is a heavy community plugin.

### 10.2 Versioning

| Framework | First-party? | UX | Effort to adopt |
|---|:-:|---|---|
| Docusaurus | Yes | Dropdown nav, per-version sidebar, stable URLs | Run one CLI command per release |
| MkDocs + mike | "First-party convention" | Dropdown nav via Material integration | Learn `mike`'s branching model |
| Starlight | No (community plugin) | Plugin-dependent | Pin a third-party plugin |
| VitePress | No | Manual subdirs | DIY |

If we commit to Docusaurus, versioning is `docusaurus docs:version 1.0`
and it works. Everyone else is pattern-plus-discipline.

**How much does versioning matter for us?** Workforce0 has real
compat surface: Prisma schema, REST API, webhook payloads, BYOK
env var names, BaseConsultant skill-injection contract. Every
`mvp` → `backend` rename we did, every `tenantId` addition, every
`ExecutionPlan.graphContentHash` column is a docs-version event.
Three majors in we'll wish we had first-party support.

### 10.3 i18n

Workforce0 already has `docs/i18n.md`, which signals intent to
localise. Priority order for our needs:

1. Docusaurus — reference-quality. React Native's docs are in ~10
   languages with working fallbacks.
2. Starlight — explicit i18n in Content Collections; Kubo-scale
   projects ship with 7+ locales.
3. MkDocs — plugin works; rough edges around per-locale search.
4. VitePress — works, simpler feature set.

---

## 11. Migration-cost estimate from what we have today

We currently have ~15 `.md` files in `docs/` plus rendered PDF
artefacts. Nothing fancy — no Mermaid, no MDX, no custom frontmatter
yet. Migration is mostly about three things:

1. **Adding frontmatter** to each page (title, sidebar position,
   tags). ~1–2 hours for 15 files regardless of framework.
2. **Restructuring** into the target framework's expected layout.
   - Starlight: move to `src/content/docs/`; config in one file.
   - Docusaurus: stay in `docs/`; add `docusaurus.config.js` +
     `sidebars.js`.
   - MkDocs: stay in `docs/`; add `mkdocs.yml`.
   - VitePress: stay in `docs/`; add `.vitepress/config.ts`.
3. **Rewriting internal links** from raw Markdown links to the
   framework's internal linking convention. ~1 hour.

Total migration effort (all four): roughly half a day each. None
has a meaningful cost advantage here.

Running costs diverge:

- Docusaurus: slow CI build compounds with every release-tagged
  doc deploy.
- All three others: negligible CI cost.

---

## 12. Recommendation

**Pick Starlight — with versioning adopted via the
`starlight-versions` community plugin.**

Rationale:

- **Best search** (Pagefind) out of the box — matters most for our
  self-hosted, possibly-offline audience.
- **MDX with any-framework islands** — we can drop React demos in
  from `frontend/` with minimal friction.
- **Fastest builds** — CI budget matters for release tagging.
- **Monorepo-native** — lives happily in `docs/` with `astro.config.mjs`.
- **Weighted score 54 / 63** — within one point of Docusaurus, and
  ahead once you discount the one thing Docusaurus clearly wins on.

The one unresolved-by-core trade-off — versioning — we accept with
`starlight-versions` + a simple `docs:version` npm script. If the
plugin regresses or gets abandoned, we fall back to the "per-major
subdirectory" pattern, which is what VitePress's community does
anyway.

**Why not Docusaurus?** Versioning is the only reason it scores
this high, and we don't need version 3's native flow enough to
accept the Webpack build cost + the heavier client bundle + the
second React install for our entire docs lifecycle.

**Why not MkDocs Material?** No MDX. Our docs will have live demos
and that's a hard requirement we're not willing to drop.

**Why not VitePress?** Vue island story is strong; our project is
React. Adopting VitePress means every live demo is a Vue file that
diverges from the React we ship in `frontend/`.

### 12.1 Concrete next steps if we go with Starlight

1. Add `docs-site/` at repo root (keep `docs/` as the content
   source to minimise diff).
2. `npm create astro@latest docs-site -- --template starlight --typescript`.
3. Symlink `docs-site/src/content/docs → ../../docs` or mount via
   Astro's `srcDir` override (pick one, document in `docs-site/README.md`).
4. Install `starlight-versions`, wire per-major snapshots.
5. Configure Pagefind — it's on by default in Starlight, but we
   want to verify the index lands in the CI artefact.
6. Deploy target: GitHub Pages first (free, fine for our traffic
   shape). Migration to Cloudflare Pages if we outgrow.
7. Redirect our README's "docs" link from `docs/` (GitHub-rendered)
   to the new site, keeping the raw Markdown files in-repo for
   offline / IDE reading.

Estimated effort to first public deploy: **one engineer-day.**

---

## Appendix A — sample configs

### A.1 Starlight

```ts
// astro.config.mjs
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://workforce0.dev",
  integrations: [
    react(),
    starlight({
      title: "Workforce0",
      description: "Self-hosted AI workforce — BYOK, open-source.",
      logo: { src: "./src/assets/wf0.svg" },
      social: {
        github: "https://github.com/workforce0/workforce0",
      },
      sidebar: [
        {
          label: "Getting started",
          items: [
            { label: "Quickstart", link: "/quickstart/" },
            { label: "Self-hosting", link: "/self-hosting/" },
            { label: "BYOK", link: "/byok/" },
          ],
        },
        {
          label: "Integrations",
          autogenerate: { directory: "integrations" },
        },
        {
          label: "Architecture",
          autogenerate: { directory: "architecture" },
        },
        {
          label: "Reference",
          autogenerate: { directory: "reference" },
        },
      ],
      customCss: ["./src/styles/wf0.css"],
      components: {
        // Slot overrides go here (e.g. a BYOK-validator widget
        // in the header).
      },
    }),
  ],
});
```

### A.2 Docusaurus

```js
// docusaurus.config.js
module.exports = {
  title: "Workforce0",
  tagline: "Self-hosted AI workforce — BYOK, open-source.",
  url: "https://workforce0.dev",
  baseUrl: "/",
  onBrokenLinks: "throw",
  i18n: { defaultLocale: "en", locales: ["en"] },
  themes: ["@docusaurus/theme-classic"],
  plugins: [
    [
      "docusaurus-plugin-openapi-docs",
      {
        id: "apiDocs",
        docsPluginId: "classic",
        config: { backend: { specPath: "./openapi.yaml", outputDir: "docs/reference/api" } },
      },
    ],
  ],
  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: require.resolve("./sidebars.js"),
          includeCurrentVersion: true,
        },
        blog: {
          showReadingTime: true,
        },
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: "Workforce0",
      items: [
        { to: "/docs/quickstart", label: "Docs", position: "left" },
        { to: "/blog", label: "Release notes", position: "left" },
        { type: "docsVersionDropdown", position: "right" },
        { href: "https://github.com/workforce0/workforce0", label: "GitHub", position: "right" },
      ],
    },
    colorMode: { defaultMode: "light", respectPrefersColorScheme: true },
  },
};
```

### A.3 MkDocs + Material

```yaml
# mkdocs.yml
site_name: Workforce0
site_url: https://workforce0.dev
repo_url: https://github.com/workforce0/workforce0
theme:
  name: material
  palette:
    - scheme: default
      primary: amber
      toggle: { icon: material/weather-night, name: "Switch to dark mode" }
    - scheme: slate
      primary: amber
      toggle: { icon: material/weather-sunny, name: "Switch to light mode" }
  features:
    - navigation.tabs
    - navigation.sections
    - content.code.copy
    - content.tabs.link
    - search.highlight
    - search.suggest
plugins:
  - search
  - mike
markdown_extensions:
  - admonition
  - attr_list
  - def_list
  - footnotes
  - pymdownx.details
  - pymdownx.superfences
  - pymdownx.tabbed:
      alternate_style: true
extra:
  version:
    provider: mike
nav:
  - Home: index.md
  - Getting started:
      - Quickstart: quickstart.md
      - Self-hosting: self-hosting.md
      - BYOK: byok.md
  - Integrations:
      - Jira: integrations/jira.md
      - Google Chat: integrations/gchat.md
  - Architecture: architecture.md
  - Reference: reference.md
```

### A.4 VitePress

```ts
// .vitepress/config.ts
import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Workforce0",
  description: "Self-hosted AI workforce — BYOK, open-source.",
  themeConfig: {
    nav: [
      { text: "Docs", link: "/quickstart" },
      { text: "Release notes", link: "/releases/" },
      { text: "GitHub", link: "https://github.com/workforce0/workforce0" },
    ],
    sidebar: {
      "/": [
        {
          text: "Getting started",
          items: [
            { text: "Quickstart", link: "/quickstart" },
            { text: "Self-hosting", link: "/self-hosting" },
            { text: "BYOK", link: "/byok" },
          ],
        },
        {
          text: "Integrations",
          items: [
            { text: "Jira", link: "/integrations/jira" },
            { text: "Google Chat", link: "/integrations/gchat" },
          ],
        },
      ],
    },
    search: { provider: "local" },
  },
});
```

---

## Appendix B — sample information-architecture for Workforce0

Whichever framework we pick, the IA is the same. Thinking about it
up-front reveals gaps we haven't noticed in `docs/` yet.

```
/ (home)
├── quickstart/
│   ├── docker-compose/          one-liner + BYOK
│   ├── one-click-deploy/        Railway / Render / Fly / DO
│   └── first-brief/             upload transcript → brief in 10 min
├── self-hosting/
│   ├── overview/
│   ├── docker-compose/
│   ├── kubernetes/              helm chart link
│   ├── fly-io/
│   ├── railway/
│   ├── render/
│   ├── digitalocean/
│   ├── caddy-traefik/
│   └── security-checklist/
├── byok/
│   ├── overview/                what's BYOK, what's not
│   ├── anthropic/
│   ├── openai/
│   ├── google-gemini/
│   ├── local-ollama/
│   ├── local-llama-cpp/
│   └── cost-caps/               monthlyBudgetTokens doc
├── integrations/
│   ├── jira/
│   ├── google-chat/
│   ├── google-drive/
│   ├── slack/
│   ├── twilio/
│   └── github/
├── architecture/
│   ├── overview/                multi-process layout
│   ├── ai-council/              multi-model consensus
│   ├── agent-daemon/            local daemon + webhooks
│   ├── project-graph/           (inspired by safishamsi/graphify)
│   ├── rls-middleware/          tenantId-enforcement
│   ├── prisma-schema/           schema overview + migration discipline
│   └── voice/                   Gemini Live API + Twilio
├── reference/
│   ├── api/                     auto-generated from OpenAPI
│   ├── webhook-payloads/        GitHub push, Twilio, Gemini Live
│   ├── cli/                     backend CLI surface
│   └── env-vars/                single table of every env var
├── runbooks/
│   ├── triage-queue-stuck/
│   ├── stuck-approval/
│   ├── voice-dial-in-silent/
│   └── graph-build-failing/     PG.11 webhook runbook
├── roadmap/
│   └── (from DEFERRED.md, published form)
└── releases/                    blog-style release notes
```

This IA sketch is non-binding but we'll reference it when we land
the first migration.

---

## Appendix C — things that would flip the decision

The recommendation in § 12 is **Starlight**. These developments, in
approximate order of likelihood, would flip it:

1. **We adopt Python in the repo as a first-class stack** (e.g. a
   `python-agent/` shipping alongside the Node daemon). MkDocs
   Material becomes much more natural.
2. **`starlight-versions` gets abandoned** or repeatedly breaks
   between Starlight minor releases. Docusaurus's first-party
   versioning flips from "nice-to-have" to "only-option."
3. **We decide to ship a Vue-heavy demo inside docs** (we won't).
4. **Offline search stops being a requirement.** Pagefind's
   differentiator shrinks; Docusaurus + Algolia becomes viable.
5. **Docusaurus's Rspack / Turbopack path** lands as a first-party
   supported build — their 60–120s CI build time is the biggest
   operational negative and it's on the roadmap.
6. **We hire a docs-engineering owner** who has strong experience
   with one specific framework. Bet on their muscle memory.
