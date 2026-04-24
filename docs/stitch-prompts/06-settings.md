# Stitch prompt: Settings / Integrations list

**Purpose:** At-a-glance view of what's connected, what isn't, and easy entry to every wizard.

**User goal:** "Is everything working?" → "Yes." → back to work.

---

## Paste this into Stitch

```
Design the Integrations settings page for Workforce0.

Layout:
- Use the standard dashboard shell (left sidebar, topbar).
- Page heading "Integrations" with a subtitle "Connect Workforce0 to the
  tools your team already uses."
- Right-aligned small button: "Request a new integration" (ghost style).

Below the heading — filter tabs:
- All · Connected · Available · Coming soon

Main content — grid of integration cards, 3 per row on desktop:

Each card (uniform size):
- Top row: tool logo (32px), tool name (16px bold), status pill.
  Status pills: "Connected" (green dot), "Not connected" (gray dot),
  "Action needed" (amber dot — when a token has expired, for example),
  "Coming soon" (neutral, italic).
- Middle: one-line description of what this integration does for the
  user. Plain English. Example: "Turn approved briefs into Jira tickets
  automatically."
- Bottom: single action button.
  - If connected: "Manage" (ghost).
  - If not connected: "Connect" (primary indigo).
  - If coming soon: "Get notified" (ghost).

Integrations to show (rows 1 to 3):
Row 1 (connected): Jira, Google Chat, Google Drive.
Row 2 (available): Slack, GitHub, Linear.
Row 3 (coming soon): Notion, Asana, Salesforce.

Below grid — "Looking for something else?" callout:
- Muted banner with copy: "Workforce0 is open source. Build your own
  integration and open a PR — we'll help you."
- Button: "See the contributor guide" (opens CONTRIBUTING.md in a new tab).

Detail drawer (when user clicks "Manage" on a connected card):
- Slide-in from the right, 480px wide.
- Shows: connection status, connected account email, last-used timestamp,
  permissions granted (as a human-readable list, not JSON), recent
  activity (last 5 events).
- Footer has two buttons: "Reconnect" (ghost) and "Disconnect" (destructive,
  red outline).

Tone: reassuring and clear. Never show raw error blobs — errors become
"Action needed" pills with a clear next step.
```

---

## Expected outputs

- Full grid with mix of connected / available / coming soon
- "Manage" drawer for a connected integration
- "Action needed" state (expired token example)
- Empty state (brand new install — all cards show "Connect")

## Implementation notes

- Route: `frontend/src/app/(dashboard)/settings/integrations/page.tsx`
- Each card pulls status from `/api/integrations` — show optimistic states during connect/disconnect
- "Action needed" should deep-link straight into the wizard at the right step, prefilled with existing values
- The "Looking for something else?" card is a deliberate OSS nudge — it's one of the few places in the UI where we lean into the project being open source
