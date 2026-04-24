# Stitch prompt: Main dashboard

**Purpose:** Home base for execs. Shows the state of their AI workforce at a glance. **Not** a developer dashboard with logs and metrics.

**User goal:** Know in 5 seconds "what needs my attention right now?"

---

## Paste this into Stitch

```
Design the main dashboard for Workforce0. Target user is a busy VP of
Product who opens this once in the morning and once after lunch. No
developer jargon.

Layout:
- Left sidebar (240px): Workforce0 wordmark top, nav items (Dashboard,
  Meetings, Approvals [with red dot badge when count > 0], Integrations,
  Team, Settings), user avatar + workspace name at bottom.
- Main area: topbar (64px) with greeting "Good morning, Priya" + a
  primary action button "New meeting" (indigo) on the right.

Main content — three sections, stacked:

1. "Needs your approval" banner
   - Full-width indigo-tinted card with a left border accent.
   - Shows count ("3 items waiting for review"), and a button "Review now".
   - If zero: collapses to a single muted line "All caught up — nothing
     needs your approval right now."

2. Three summary cards in a row:
   - "Meetings this week" — big number (e.g., 12), tiny sparkline, small
     delta pill vs last week ("+3 vs last week").
   - "Hours saved" — big number with unit (e.g., "14 hrs"), tiny icon, one
     line caption: "Based on 20 min per manual brief."
   - "Active integrations" — big number (e.g., 4), small row of connected
     tool logos below.

3. "Recent activity" feed
   - Vertical list of items, each row: colored dot by type (meeting /
     brief / ticket / PR), one-line description, timestamp, avatar of the
     person or agent that acted, hover reveals a "View" link.
   - Examples: "Brief generated from 'Q3 Planning' meeting — 12 min ago",
     "Jira ticket PROD-421 created from approved brief", "PR #87 opened
     by Dev Agent — 1 hour ago".
   - 8 items max, then "Show more" link at bottom.

Empty state for entire dashboard (brand new install):
- Replace everything below the topbar with a single friendly card:
  "Let's turn your first meeting into finished work. Paste a transcript,
  upload a recording, or dial in." — three big action buttons.

Style: calm, minimal, clear hierarchy. No line charts. No pie charts. No
financial-dashboard look. Numbers are big and readable. Plenty of
whitespace.
```

---

## Expected outputs

- Full dashboard with data
- Empty state (brand new install)
- "Approval banner zero" state

## Implementation notes

- The "Needs your approval" banner is the single most important thing on this screen — make it visually loud
- Sparklines: keep them small and abstract, not precise data viz
- Activity feed subscribes to SSE (`mvp/src/routes/sse.routes.ts`) for real-time updates
