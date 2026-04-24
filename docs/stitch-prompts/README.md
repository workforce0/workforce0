# Stitch prompts for Workforce0 UI

This folder contains ready-to-paste prompts for [Google Stitch](https://stitch.withgoogle.com) — one prompt per key screen of the product.

## How to use

1. Open [stitch.withgoogle.com](https://stitch.withgoogle.com).
2. Start a new project. Pick **Web** (desktop-first).
3. Paste the **Master brand prompt** below into the global style / brief field.
4. For each screen, start a new frame and paste the corresponding prompt from this folder.
5. Iterate — adjust copy, swap components, regenerate.
6. Export PNGs and save them to `docs/assets/` for the README.
7. Export SVG components and drop into `frontend/src/components/` as scaffolding for implementation.

## Master brand prompt (paste once, at project level)

```
Product: Workforce0 — an open-source AI workforce platform for non-technical
product leaders. Meetings go in, structured briefs, Jira tickets, and pull
requests come out. Users are VPs and Directors of Product who are time-poor
and not technical.

Design direction:
- Calm, modern, minimal. Think Linear + Notion + Vercel.
- Off-white background (#FAFAF9), charcoal text (#18181B), single accent
  color: a warm, confident indigo (#4F46E5). Avoid rainbow gradients.
- Typography: Geist or Inter. Tight line-height in headings, generous in body.
- Generous whitespace. Cards with subtle borders (1px, #E4E4E7), no heavy
  shadows.
- Icons: Lucide-style, 1.5px stroke.
- Copy voice: plain language, short sentences, no jargon. Action buttons
  are verbs ("Generate brief", not "Submit").
- Absolutely no cluttered dashboards. No more than 3 primary actions per
  screen.
- Desktop-first but responsive down to tablet.
- Empty states have personality — short friendly copy + a clear next action.
- Skeleton loaders over spinners.
```

## Prompts in this folder

| # | Screen | Prompt file |
|---|---|---|
| 01 | First-run setup wizard | [01-setup-wizard.md](./01-setup-wizard.md) |
| 02 | Login / signup | [02-login-signup.md](./02-login-signup.md) |
| 03 | Main dashboard | [03-dashboard.md](./03-dashboard.md) |
| 04 | Meeting detail + AI brief | [04-meeting-brief.md](./04-meeting-brief.md) |
| 05 | Integration wizard (Jira example) | [05-integration-wizard.md](./05-integration-wizard.md) |
| 06 | Settings / integrations list | [06-settings.md](./06-settings.md) |
| 07 | Approval queue | [07-approval-queue.md](./07-approval-queue.md) |

## After Stitch: implementation flow

1. Download the Stitch export (PNGs + React/HTML if offered).
2. Drop reference PNGs into `docs/assets/` so the README renders them.
3. For each screen, port the layout to `frontend/src/app/...` using our existing
   stack (Next.js 16, Radix UI, Tailwind v4). Follow `AGENTS.md` service layer.
4. Add Playwright test covering the happy path before merging.

## Tips

- Stitch responds best to concrete specs ("three status cards in a row") over
  vague adjectives ("nice dashboard").
- When you don't like a result, tell Stitch what's wrong in the next prompt
  instead of starting over.
- Keep the master brand prompt short — save screen-specific detail for the
  individual frame prompt.
