# Workforce0 Design System — "Aperture"

> A single source of truth for colors, typography, motion, and surface treatment across every Workforce0 page. Lives in `frontend/src/app/globals.css`.

---

## Philosophy

**Linear × Raycast × Vercel.** Cool minimalism, glass-forward, motion as meaning.

- **Executive-first, not developer-y.** Calm surfaces, generous whitespace, confident typography. Never crowded, never fussy.
- **Light and dark are equals.** Both themes ship together; no afterthoughts. `html.dark` flips tokens.
- **Indigo is our signature.** Everything else is neutral. One accent carries the brand.
- **Subtle glassmorphism on elevated surfaces only.** Headers, modals, overlays — never on flat dashboard cards.
- **Motion is information.** Enter animations convey hierarchy; state transitions convey cause.

---

## Tokens

All values live in `@theme` blocks in `globals.css`. Use the CSS variables directly (`var(--color-accent)`), not raw hex.

### Color — brand
| Token | Hex | Use |
|---|---|---|
| `--color-accent` | `#6366f1` | Primary CTAs, active states, focus rings |
| `--color-accent-hover` | `#4f46e5` | Hover of primary CTA |
| `--color-accent-active` | `#4338ca` | Active press of primary CTA |
| `--color-accent-subtle` | `rgba(99,102,241,0.08)` | Tinted backgrounds, selected rows |
| `--color-accent-glow` | `rgba(99,102,241,0.45)` | Glow halos on hero CTAs (via `.glow`) |

### Color — neutrals (light)
| Token | Hex | Use |
|---|---|---|
| `--color-canvas` | `#fafafa` | Page background |
| `--color-surface` | `#ffffff` | Cards, modals, raised surfaces |
| `--color-surface-hover` | `#f6f6f7` | Hover state of surfaces |
| `--color-surface-sunken` | `#f2f2f3` | Inputs, skeletons, secondary surfaces |
| `--color-ink` | `#0a0a0c` | Primary text, icons |
| `--color-ink-secondary` | `#424246` | Secondary text, labels |
| `--color-ink-tertiary` | `#8e8e93` | Captions, helper text |
| `--color-ink-faint` | `#c6c6cb` | Disabled text, icon outlines |
| `--color-border` | `rgba(10,10,12,0.07)` | Default borders |
| `--color-border-strong` | `rgba(10,10,12,0.12)` | Hover borders, dividers |

### Color — dark mode

`html.dark` flips every neutral. Canvas becomes `#070708`, surface becomes `#0e0e10`, ink becomes `#fafafa`. Borders move to `rgba(255,255,255,0.07)`. Shadows add a 1px inner white highlight to preserve depth.

### Color — semantic
| Token | Hex | Use |
|---|---|---|
| `--color-emerald` | `#10b981` | Success, confirmed state, live dot |
| `--color-amber` | `#f59e0b` | Warning, action-needed, pending |
| `--color-rose` | `#f43f5e` | Error, destructive action |
| `--color-sky` | `#0ea5e9` | Info, neutral accent |
| `--color-violet` | `#8b5cf6` | Secondary accent (used in gradients) |

Each has a `-light` variant for tinted backgrounds.

### Typography

- **Sans**: Inter (ui-sans-serif fallback). Body, UI chrome.
- **Display**: Inter with `-0.035em` tracking. Headlines, stat numbers.
- **Mono**: JetBrains Mono. Code, kbd chips, tabular figures.
- **Tracking**: `-0.02em` on body (crisp), `-0.035em` on display (confident).
- **Feature settings**: `cv11, ss01, ss03` — Inter's refined glyphs.

Scale (with Tailwind): `text-xs` (12) / `text-sm` (14) / `text-base` (16) / `text-lg` (18) / `text-xl` (20) / `text-2xl` (24) / `text-3xl` (30) / `text-4xl` (36) / `text-5xl` (48).

Utilities:
- `.font-display` — display tracking + ss features
- `.tabular` — `font-variant-numeric: tabular-nums` for data columns

### Radii
`--radius-xs` 4 · `--radius-sm` 8 · `--radius` 10 · `--radius-md` 12 · `--radius-lg` 16 · `--radius-xl` 20 · `--radius-2xl` 28.

### Elevation
Four stops: `--shadow-xs` (hairline), `--shadow-card`, `--shadow-card-hover`, `--shadow-float` (popovers), `--shadow-overlay` (modals/drawers), `--shadow-glow` (hero CTAs).

Dark mode shadows always carry a 1px inner white highlight so cards read as lit.

### Motion

Durations: `--dur-instant` 80ms · `--dur-fast` 160ms · `--dur` 220ms · `--dur-slow` 420ms.

Easing:
- `--ease-spring` — default for enter animations
- `--ease-smooth` — default for state transitions
- `--ease-bounce` — scale pops
- `--ease-anticip` — playful exits

**Rules:**
- Micro-interactions 150–300ms. Nothing longer than 500ms.
- Exit animations ≤ 70% of enter duration.
- Every transition uses `transform` or `opacity` only.
- `prefers-reduced-motion` cuts durations to 0.01ms.

---

## Utilities (defined in globals.css)

- `.glass` — frosted card for headers / hovering panels
- `.glass-strong` — stronger blur for modals / menus
- `.glass-dark` — dark-panel glass (login splash, command palettes)
- `.bg-mesh-cool` — signature page backdrop (three radial glows)
- `.bg-mesh-warm` — legacy alias, now the cool mesh
- `.bg-grid` — subtle engineering grid with radial mask
- `.bg-noise` — very subtle film grain overlay
- `.border-gradient` — 1px gradient stroke (accent → violet)
- `.card-interactive` — hover-lift + press-depress
- `.glow` — accent halo shadow
- `.shine` — Vercel-style diagonal shine sweep on hover
- `.kbd` / `<kbd>` — keyboard shortcut chip
- `.dot-pulse` — live-indicator ring
- `.skeleton` — shimmer placeholder
- `.tabular` — tabular numerals
- `.font-display` — display tracking

---

## Component patterns

### Buttons
Variants: `default` (ink/dark), `accent` (indigo, with shine), `outline`, `ghost`, `secondary`, `success`, `destructive`, `link`. Sizes `sm` / `default` / `lg` / `icon`. All honor focus-ring and reduced motion.

### Cards
Default `Card` now has `border + radius-lg + shadow-card`. Combine with `card-interactive` for hover-lift. Stats use the upgraded `StatCard` component with a ghost accent glow on hover.

### Inputs / Selects
Use native-feel: `bg-surface-sunken` in light, `bg-surface-hover` in dark. Height 40px (`h-10`). Focus ring uses `--color-accent`. Never placeholder-as-label.

### Modals / Sheets
Use `Dialog` from Radix. Overlay is `bg-black/40 backdrop-blur-sm` (light) or `bg-black/60` (dark). Content uses `glass-strong + shadow-overlay`.

### Sidebar
Fixed dark panel (`--color-sidebar-bg` = `#0a0a0c`) both in light and dark mode. Items use `--color-sidebar-hover` / `--color-sidebar-active`. Consistent across themes so users never lose orientation.

### Empty states
Always: large icon in a sunken square, one-line headline, one-line support copy, one primary CTA. Never "No data." alone.

### Skeletons
`.skeleton` shimmer placeholder. Use them instead of spinners for > 300ms loads. Reserve space (`h-20`, `h-10`) to prevent CLS.

---

## Don'ts

- No raw hex in components — always token.
- No `bg-white` / `bg-black` — always `bg-surface` / `bg-ink`.
- No emoji as structural icons — Lucide only.
- No `shadow-lg` — use the named elevations.
- No transitions on `width` / `height` / layout properties.
- No placeholders doubling as labels.
- No generic "AI-slop" aesthetics: rainbow gradients, glassmorphism applied to everything, low-contrast gray-on-gray text.

---

## Migration map (which pages are on Aperture, which need work)

See [`docs/plans/ui-redesign-migration.md`](./plans/ui-redesign-migration.md) for the prioritized per-page migration list. Everything driven by tokens means most pages update automatically — per-page work is mostly about upgrading hero areas, hierarchy, and empty states, not rewriting.
