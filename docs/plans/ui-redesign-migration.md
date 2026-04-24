# UI Redesign Migration Plan

> Follow-on to the Aperture design system rollout (see `docs/design-system.md`). Most pages auto-update because they use tokens. This plan covers the per-page polish that remains.

---

## What already shipped

- `globals.css` rewritten with the Aperture token set (indigo accent, dark-mode parity, glass + mesh utilities)
- `components/ui/card.tsx` — added border, refined radius + shadow
- `components/ui/button.tsx` — refined variants, `accent` gets the shine sweep
- `components/stat-card.tsx` — ghost accent glow on hover, display tracking, tabular numerals
- `app/login/page.tsx` — cinematic left panel redesigned with mesh + grid + display headline

Because every page uses the same tokens (`bg-surface`, `text-ink`, `text-accent`, etc.), all other pages now render with the new indigo accent and border treatment **without any per-page change.**

---

## Priority tiers

### Tier A — ship first (high-visibility)

| Page | Status | Effort | Notes |
|---|---|---|---|
| Login | ✅ Done | — | Cinematic left panel |
| Onboarding / first-run setup wizard | ⬜ Polish | 1h | Swap gradient hero; tighten step progress; add `glow` on primary CTA; ensure dark mode |
| Dashboard | ⬜ Polish | 2h | Replace generic widgets with hero row of upgraded `StatCard`s; add "Needs your approval" banner using `bg-accent-subtle + border-gradient`; activity feed with dot-pulse icons |
| Approvals queue (Stitch 07) | ⬜ Polish | 1.5h | Two-pane layout already right; upgrade confidence pills to tabular + tinted backgrounds; active-row uses accent left border; kbd chips for J/K/A/R in the header |
| Briefs detail (PRD page) | ⬜ Polish | 2h | Display-font title, collapsible sections with chevron icons, sticky footer with glow on primary "Approve" CTA, confidence bar using accent-subtle |

### Tier B — ship next (high-use)

| Page | Status | Effort | Notes |
|---|---|---|---|
| Settings → Integrations grid | ⬜ Polish | 1h | Card grid already matches Stitch 06; apply `border-gradient` to "connected" cards |
| Settings → AI Providers | ⬜ Polish | 30m | Glow on "configured" badge; subtle accent on connected row |
| Settings → Models | ⬜ Refactor | 2h | Preset cards need the `border-gradient` treatment on active preset; per-agent rows should feel quiet |
| Skills admin | ⬜ Polish | 30m | List rows: invoke `/slug` code chip uses `.kbd` styling |
| Schedules admin | ⬜ Polish | 30m | Row state pills use semantic tints; next-run uses tabular numerals |
| Meetings list | ⬜ Polish | 1h | Add search bar with cmd-K affordance; rows use `card-interactive` |
| Meetings detail | ⬜ Polish | 1h | Split-pane with transcript on left (`bg-surface-muted`, mono tokens), brief on right |
| Team | ⬜ Polish | 30m | Channel config section gets the `glass` treatment per row |
| Engagements | ⬜ Polish | 1h | Phase timeline with indigo dot markers |

### Tier C — defer (low-traffic or already fine)

| Page | Status | Notes |
|---|---|---|
| Analytics | ⬜ Defer | Charts need separate chart-style pass (use `--domain chart`) |
| Agent jobs | ⬜ Defer | Dev-centric page; leave until someone complains |
| Audit log | ⬜ Defer | Admin-only; function >> form |
| Webhooks | ⬜ Defer | Admin-only |
| Notifications settings | ⬜ Defer | Simple toggle list |
| Account settings | ⬜ Defer | Simple form |
| Tasks | ⬜ Defer | Legacy view; covered by Approvals in v1 |
| PRDs list | ⬜ Defer | Same pattern as meetings list; update together |
| Forgot password / Reset password | ⬜ Defer | Inherit from login shell |
| Signup | ⬜ Defer | Inherit from login shell |

---

## Suggested order for the next session

1. Onboarding wizard — biggest first impression (1h)
2. Dashboard — where execs land every day (2h)
3. Approvals queue — daily-used inbox (1.5h)
4. Briefs detail — the "money shot" page where users decide (2h)

That's ~6.5h of focused work. Everything else in Tier B/C can land incrementally as PRs.

---

## How to approach each page

1. Read the page file.
2. Identify the hero area (top 1/3). Upgrade first — that's where users form impressions.
3. Swap any `bg-white` / `bg-black` / raw `shadow-lg` for token classes.
4. Ensure the primary CTA is `variant="accent"` and (if hero) gets `.glow`.
5. Replace stat/metric displays with `StatCard` (or pattern-match its treatment).
6. Verify dark mode by flipping `html.dark` class in dev tools.
7. Run `prefers-reduced-motion` check — everything should still read, just without motion.

---

## Inspiration references

- **Linear** — density, keyboard shortcuts, quiet surfaces
- **Raycast** — command palette polish, dark-mode-first
- **Vercel dashboard** — hero numbers, activity feed, deploy previews
- **Stripe dashboard** — form clarity, semantic status pills
- **GitHub desktop** — dense info without clutter

Avoid: rainbow gradients, heavy glassmorphism on flat surfaces, low-contrast gray-on-gray body text, emoji icons.
