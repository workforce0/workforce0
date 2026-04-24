---
title: Frontend — Next.js + React 19
description: The audit UI. Consumer-first dashboard with strong theming.
---

## Stack

- **Next.js 16** — app router, server components where useful.
- **React 19** — the latest stable.
- **Radix UI** — headless primitives.
- **Tailwind v4** — utility-first with our "Aperture" design token
  system.
- **Plus Jakarta Sans** — display font (via `next/font/google`).
- **Lucide** — icon set.
- **Vitest** + **Playwright** — unit + e2e.

## Layout

```
frontend/
├── public/             # favicons, images
└── src/
    ├── app/            # app router
    │   ├── (dashboard)/ # authenticated routes
    │   ├── (onboarding)/ # setup wizard
    │   ├── login/
    │   ├── signup/
    │   └── page.tsx    # public landing page
    ├── components/     # reusable UI
    │   └── ui/         # primitives (Button, Card, Input...)
    └── lib/            # api client, auth helpers, project context
```

## Route groups

- `(dashboard)` — authenticated. Sidebar + project switcher + main content.
  All routes under here require `isAuthenticated()`.
- `(onboarding)` — post-signup setup wizard.
- Public routes — landing page, login, signup, password reset.

## API client

`lib/api.ts` is a typed client wrapping every backend route. All
methods:

- Attach the JWT from `localStorage.wf0_token` as a fallback to the
  httpOnly cookie.
- Attach `X-Project-Id` for project-scoped endpoints.
- Throw `ApiError` on non-2xx responses with the backend's structured
  error shape.
- Return the envelope `{ success, data, error }`.

## Project scope

`lib/project-context.tsx` provides a React context with:

- `projects: Project[]`
- `current: Project | null`
- `setCurrent(id)` — persists to localStorage; broadcasts a
  `projectchange` CustomEvent for non-context subscribers.

List pages subscribe to project changes and refetch.

## Authentication

- Login flow hits `/api/auth/login` and sets an httpOnly JWT cookie.
- `lib/auth.ts` has `isAuthenticated()` — checks `localStorage` for a
  fallback token reference (the actual JWT is in the cookie we
  can't read client-side).
- Logout clears both the cookie and the localStorage marker and
  redirects to `/login`.

## Design system: "Aperture"

All tokens live in `src/app/globals.css`:

- **Accent**: indigo-600 `#4f46e5` with hover/active/ring/glow
  shades.
- **Ink**: `#050509` → `#a8a8af` scale for text.
- **Surface**: white / near-white for cards; inverse for sidebars.
- **Semantic colors**: emerald / amber / rose / sky / violet with
  `-light` variants for backgrounds.
- **Radii**: `4`, `8`, `10`, `12`, `16`, `20`, `28`.
- **Shadows**: xs / card / card-hover / float / overlay / glow.
- **Motion**: `ease-spring` / `ease-smooth` / `ease-bounce` / `ease-anticip`;
  `dur-instant` / `dur-fast` / `dur` / `dur-slow`.

Dark mode: same tokens, dark values behind `html.dark`. The layout
wrapper can toggle the class.

## Page patterns

Every authenticated page follows:

```tsx
"use client";

export default function MyPage() {
  const { current } = useProjectContext();

  useEffect(() => { load() }, [current]);

  return (
    <div className="min-h-screen">
      <Header title="..." />
      <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
        {/* page content */}
      </div>
    </div>
  );
}
```

Consistency matters more than novelty; the sidebar + header are
present on every authenticated route.

## Accessibility

- **Skip link** at the top of every layout.
- **Focus rings** (`focus-visible:ring-2 focus-visible:ring-accent/40`)
  on every interactive element.
- **aria-label** on icon-only buttons.
- **Semantic landmarks**: `header`, `main`, `footer`, `nav`, `aside`.
- **Keyboard navigation** tested via Playwright e2e.
- **Dynamic Type** — no truncation as text scales.
- **Reduced motion** — `prefers-reduced-motion` respected for hover
  scale / fade transitions.

## Performance notes

- Next.js 16 with Turbopack dev builds. Production build uses the
  stable compiler.
- First-load JS for the dashboard: ~120 KB gzipped.
- Images: Next's `<Image>` with auto WebP / AVIF.
- List virtualization where needed (e.g. long meeting lists).

## Testing

- Vitest for components (`src/components/__tests__/`).
- Playwright for e2e flows (`e2e/`).

## Frontend ↔ backend contract

- Same repo so types can drift but errors surface fast at PR time
  via `npm run typecheck`.
- The `api.ts` client re-exports the types the backend uses (`Project`,
  `ExecutionPlan`, `GraphNode`, etc). Updates flow through that file
  when the backend ships.
