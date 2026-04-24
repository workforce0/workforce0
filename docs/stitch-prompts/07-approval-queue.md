# Stitch prompt: Approval queue

**Purpose:** The exec's "inbox" for AI-generated work. Fast triage — approve, reject, or edit, one after another.

**User goal:** Clear the queue in under 10 minutes a day.

---

## Paste this into Stitch

```
Design the approval queue for Workforce0 — the page where a product
leader reviews every AI-generated output before it ships.

Layout: two-pane split, 35/65.

Top header (spans both panes):
- Page title "Approvals" with a count badge ("3 waiting").
- Right: filter chips — All · Briefs · Tickets · Pull requests · Documents.
- "Approve all safe (1)" button, muted — shows when AI marks items
  confidence ≥ 0.95, letting user batch-approve the no-brainers.

Left pane (35%) — Queue list:
- Stack of cards, each showing:
  - Type icon (brief / ticket / PR / doc) in a colored rounded square.
  - One-line title (e.g., "Q3 Planning — Product Brief").
  - Secondary line: source ("from 'Q3 Planning' meeting • 2 hrs ago").
  - Confidence pill on the right: green ≥0.9, amber 0.7–0.89, red <0.7.
- Active card has an indigo left border and slightly darker background.
- Keyboard shortcuts visible as small badges near the top: "J/K to navigate,
  A to approve, R to reject, E to edit".

Right pane (65%) — Active item preview:
- Title of the item at top, with source breadcrumb.
- Preview of the content:
  - If brief → formatted brief sections (reuse from screen 04).
  - If ticket → rendered as a Jira-style ticket card preview.
  - If PR → file tree + diff summary + description.
- Sticky footer with three actions, big and clear:
  - "Reject" (ghost, left).
  - "Edit" (ghost, middle).
  - "Approve" (primary indigo, right, with a small keyboard shortcut "A"
    badge).
- Above the footer: "What happens if I approve?" small accordion,
  collapsed by default. When expanded: a plain-English list like
  "• A new Jira ticket will be created in project PROD."
  "• The Jira ticket will be assigned to David."
  "• A Google Chat notification will be sent to #product-team."

Empty state:
- Huge checkmark illustration, headline "All clear", subtitle "Your AI
  workforce is caught up. Enjoy the break."

Rejection flow:
- Clicking Reject opens a small popover asking "Why reject?" with 4
  preset chips (Wrong audience, Missing context, Inaccurate, Not now)
  and a free-text field. Primary button "Send back to AI" — the AI
  regenerates with the feedback.

Batch approval flow ("Approve all safe (N)"):
- Shows a modal listing the safe items, each with a tiny toggle so
  the user can deselect anything before confirming.
```

---

## Expected outputs

- Full queue with 3+ items
- Empty state
- Rejection popover
- Batch-approve modal
- Mobile reflow (single pane, swipe between items)

## Implementation notes

- Route: `frontend/src/app/(dashboard)/approvals/page.tsx`
- Queue lives in `approval_queue` table; items come from brief / ticket / PR generation pipelines
- Keyboard shortcuts wired via `useHotkeys` — match what's shown in the UI
- "What happens if I approve?" resolves dynamically based on which integrations are connected (no Jira connected → hide that line)
- Approvals emit an audit log entry (`mvp/src/services/audit/`)
